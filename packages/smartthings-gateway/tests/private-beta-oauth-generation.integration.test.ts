import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { hashAuditValue } from "../src/audit/audit-event.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"
import { InvalidOAuthStateError, OAuthService } from "../src/oauth/oauth-service.js"
import { PostgresPrivateBetaInviteAccess } from "../src/private-beta/invite-access.js"
import { PostgresPrivateBetaInviteManager } from "../src/private-beta/invite-management.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { testDisclosures } from "./fixtures/oauth-access.js"

const { TEST_DATABASE_URL } = z.object({ TEST_DATABASE_URL: z.url() }).parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const scenarioId = randomUUID()
const poolUsername = `revocation-pool-${scenarioId}`
const reissueUsername = `revocation-reissue-${scenarioId}`

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function createService(
  username: string,
  client: FakeSmartThingsClient,
  stateGenerator: () => string,
): { readonly inviteAccess: PostgresPrivateBetaInviteAccess; readonly service: OAuthService } {
  const inviteAccess = new PostgresPrivateBetaInviteAccess({ configuredInvites: [], database })
  const service = new OAuthService({
    accessPolicy: {
      policyVersion: testDisclosures.policyVersion,
      privateBetaAccess: inviteAccess,
    },
    client,
    refreshBeforeExpiryMs: 3_600_000,
    refreshLeaseMs: 120_000,
    stateGenerator,
    store: new PostgresOAuthStore({
      database,
      encryptionKeyBase64: Buffer.alloc(32, username === poolUsername ? 8 : 7).toString("base64"),
    }),
  })
  return { inviteAccess, service }
}

async function removeUsername(username: string): Promise<void> {
  await database.deleteFrom("oauthStates").where("privateBetaUsername", "=", username).execute()
  await database
    .deleteFrom("smartThingsConnections")
    .where("privateBetaUsername", "=", username)
    .execute()
  await database.deleteFrom("privateBetaInvites").where("username", "=", username).execute()
}

beforeAll(async () => runMigrations(database))

afterAll(async () => {
  await removeUsername(poolUsername)
  await removeUsername(reissueUsername)
  await database.destroy()
})

describe("private beta OAuth invitation generations", () => {
  it("does not exhaust the PostgreSQL pool during concurrent completions for one invite", async () => {
    const completionCount = 10
    const manager = new PostgresPrivateBetaInviteManager({ configuredInvites: [], database })
    expect(
      await manager.issue({
        actorIdHash: hashAuditValue("pool-test-operator"),
        passwordHash: "b".repeat(64),
        ticketHash: hashAuditValue("POOL-ISSUE"),
        username: poolUsername,
      }),
    ).toBe(true)
    const allExchangesStarted = deferred<void>()
    const releaseExchanges = deferred<void>()
    let exchangeCount = 0
    class BarrierSmartThingsClient extends FakeSmartThingsClient {
      override async exchangeCode(code: string) {
        exchangeCount += 1
        if (exchangeCount === completionCount) allExchangesStarted.resolve()
        await releaseExchanges.promise
        return {
          ...(await super.exchangeCode(code)),
          installedAppId: InstalledAppIdSchema.parse(`${poolUsername}-${code}`),
        }
      }
    }
    const client = new BarrierSmartThingsClient()
    client.exchangeGrant = { ...client.exchangeGrant, scopes: ["r:devices:*"] }
    const states = Array.from({ length: completionCount }, (_, index) => `pool-state-${index}`)
    let stateIndex = 0
    const { inviteAccess, service } = createService(
      poolUsername,
      client,
      () => states[stateIndex++] ?? "unexpected-pool-state",
    )
    const activeInvite = await inviteAccess.resolveActiveInvite(poolUsername)
    expect(activeInvite).not.toBeNull()
    const authorizationUrls = await Promise.all(
      states.map(() =>
        service.startAuthorization({
          policyVersion: testDisclosures.policyVersion,
          privateBetaInviteGeneration: activeInvite?.generation ?? "missing-generation",
          privateBetaUsername: poolUsername,
          requestedScopes: ["r:devices:*"],
        }),
      ),
    )
    const completions = authorizationUrls.map((authorizationUrl, index) =>
      service.completeAuthorization(
        `pool-code-${index}`,
        authorizationUrl.searchParams.get("state") ?? "",
      ),
    )
    await allExchangesStarted.promise
    releaseExchanges.resolve()

    const outcomes = await Promise.allSettled(completions)
    expect(
      outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [String(outcome.reason)] : [],
      ),
    ).toEqual([])
    const retainedConnections = await database
      .selectFrom("smartThingsConnections")
      .select(({ fn }) => fn.countAll<string>().as("count"))
      .where("privateBetaUsername", "=", poolUsername)
      .executeTakeFirstOrThrow()
    expect(Number(retainedConnections.count)).toBe(completionCount)
  }, 15_000)

  it("rejects an OAuth state created before the same username is revoked and reissued", async () => {
    const manager = new PostgresPrivateBetaInviteManager({ configuredInvites: [], database })
    await manager.issue({
      actorIdHash: hashAuditValue("reissue-test-operator"),
      passwordHash: "c".repeat(64),
      ticketHash: hashAuditValue("REISSUE-OLD"),
      username: reissueUsername,
    })
    const client = new FakeSmartThingsClient()
    client.exchangeGrant = { ...client.exchangeGrant, scopes: ["r:devices:*"] }
    const { inviteAccess, service } = createService(
      reissueUsername,
      client,
      () => "private-beta-reissue-state",
    )
    const activeInvite = await inviteAccess.resolveActiveInvite(reissueUsername)
    expect(activeInvite).not.toBeNull()
    const authorizationUrl = await service.startAuthorization({
      policyVersion: testDisclosures.policyVersion,
      privateBetaInviteGeneration: activeInvite?.generation ?? "missing-generation",
      privateBetaUsername: reissueUsername,
      requestedScopes: ["r:devices:*"],
    })
    await manager.revoke({
      actorIdHash: hashAuditValue("reissue-test-operator"),
      ticketHash: hashAuditValue("REISSUE-REVOKE"),
      username: reissueUsername,
    })
    await manager.issue({
      actorIdHash: hashAuditValue("reissue-test-operator"),
      passwordHash: "d".repeat(64),
      ticketHash: hashAuditValue("REISSUE-NEW"),
      username: reissueUsername,
    })

    await expect(
      service.completeAuthorization(
        "stale-reissue-code",
        authorizationUrl.searchParams.get("state") ?? "",
      ),
    ).rejects.toBeInstanceOf(InvalidOAuthStateError)
    expect(client.exchangedCodes).toEqual([])
  })
})
