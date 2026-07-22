import { randomUUID } from "node:crypto"
import { sql } from "kysely"
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

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const scenarioId = randomUUID()
const username = `revocation-race-${scenarioId}`
const installedAppId = InstalledAppIdSchema.parse(`revocation-race-${scenarioId}`)
const revocationPauseLockId = 904_582_301

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function waitingAdvisoryLockCount(): Promise<number> {
  const result = await sql<{ waitingCount: string }>`
    select count(*)::text as "waitingCount"
    from pg_stat_activity
    where datname = current_database()
      and wait_event = 'advisory'
  `.execute(database)
  return Number(result.rows[0]?.waitingCount ?? 0)
}

async function waitForBarrier(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error("concurrency barrier was not reached")
}

async function installRevocationPauseTrigger(): Promise<void> {
  await sql`drop trigger if exists pause_private_beta_revoke_after_connection_delete on smart_things_connections`.execute(
    database,
  )
  await sql`
    create or replace function pause_private_beta_revoke_after_connection_delete()
    returns trigger
    language plpgsql
    as $function$
    begin
      perform pg_advisory_xact_lock(${sql.raw(String(revocationPauseLockId))});
      return null;
    end;
    $function$
  `.execute(database)
  await sql`
    create trigger pause_private_beta_revoke_after_connection_delete
    after delete on smart_things_connections
    for each statement execute function pause_private_beta_revoke_after_connection_delete()
  `.execute(database)
}

async function removeRevocationPauseTrigger(): Promise<void> {
  await sql`drop trigger if exists pause_private_beta_revoke_after_connection_delete on smart_things_connections`.execute(
    database,
  )
  await sql`drop function if exists pause_private_beta_revoke_after_connection_delete()`.execute(
    database,
  )
}

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.deleteFrom("oauthStates").where("privateBetaUsername", "=", username).execute()
  await database
    .deleteFrom("smartThingsConnections")
    .where("privateBetaUsername", "=", username)
    .execute()
  await database.deleteFrom("privateBetaInvites").where("username", "=", username).execute()
  await database.destroy()
})

describe("private beta OAuth and invitation revocation concurrency", () => {
  it("does not retain credentials when revocation overlaps OAuth completion", async () => {
    const manager = new PostgresPrivateBetaInviteManager({ configuredInvites: [], database })
    const issued = await manager.issue({
      actorIdHash: hashAuditValue("race-test-operator"),
      passwordHash: "a".repeat(64),
      ticketHash: hashAuditValue("RACE-ISSUE"),
      username,
    })
    expect(issued).toBe(true)
    const inviteAccess = new PostgresPrivateBetaInviteAccess({ configuredInvites: [], database })
    const exchangeStarted = deferred<void>()
    const releaseExchange = deferred<void>()
    class PausingSmartThingsClient extends FakeSmartThingsClient {
      override async exchangeCode(code: string) {
        exchangeStarted.resolve()
        await releaseExchange.promise
        return super.exchangeCode(code)
      }
    }
    const client = new PausingSmartThingsClient()
    client.exchangeGrant = {
      ...client.exchangeGrant,
      installedAppId,
      scopes: ["r:devices:*"],
    }
    const service = new OAuthService({
      accessPolicy: {
        policyVersion: testDisclosures.policyVersion,
        privateBetaAccess: inviteAccess,
      },
      client,
      refreshBeforeExpiryMs: 3_600_000,
      refreshLeaseMs: 120_000,
      stateGenerator: () => "private-beta-revocation-race-state",
      store: new PostgresOAuthStore({
        database,
        encryptionKeyBase64: Buffer.alloc(32, 9).toString("base64"),
      }),
    })
    const activeInvite = await inviteAccess.resolveActiveInvite(username)
    expect(activeInvite).not.toBeNull()
    const authorizationUrl = await service.startAuthorization({
      policyVersion: testDisclosures.policyVersion,
      privateBetaInviteGeneration: activeInvite?.generation ?? "missing-generation",
      privateBetaUsername: username,
      requestedScopes: ["r:devices:*"],
    })
    const state = authorizationUrl.searchParams.get("state") ?? ""
    const completion = service.completeAuthorization("race-code", state)
    await exchangeStarted.promise
    await installRevocationPauseTrigger()
    const pauseLockAcquired = deferred<void>()
    const releasePauseLock = deferred<void>()
    const pauseLock = database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(${revocationPauseLockId})`.execute(transaction)
      pauseLockAcquired.resolve()
      await releasePauseLock.promise
    })
    await pauseLockAcquired.promise
    let revocationSettled = false
    const revocation = manager
      .revoke({
        actorIdHash: hashAuditValue("race-test-operator"),
        ticketHash: hashAuditValue("RACE-REVOKE"),
        username,
      })
      .finally(() => {
        revocationSettled = true
      })

    try {
      await waitForBarrier(async () => revocationSettled || (await waitingAdvisoryLockCount()) >= 1)
      expect(revocationSettled).toBe(false)
      let completionSettled = false
      const completionOutcomePromise = completion.then(
        () => {
          completionSettled = true
          return { status: "fulfilled" as const }
        },
        (error: unknown) => {
          completionSettled = true
          return { error, status: "rejected" as const }
        },
      )
      releaseExchange.resolve()
      await waitForBarrier(async () => completionSettled || (await waitingAdvisoryLockCount()) >= 2)
      releasePauseLock.resolve()
      await pauseLock
      const [completionOutcome, revokeResult] = await Promise.all([
        completionOutcomePromise,
        revocation,
      ])
      const retainedConnection = await database
        .selectFrom("smartThingsConnections")
        .select("installedAppId")
        .where("installedAppId", "=", installedAppId)
        .executeTakeFirst()

      expect(revokeResult.changed).toBe(true)
      expect(completionOutcome.status).toBe("rejected")
      if (completionOutcome.status === "rejected") {
        expect(completionOutcome.error).toBeInstanceOf(InvalidOAuthStateError)
      }
      expect(retainedConnection).toBeUndefined()
    } finally {
      releaseExchange.resolve()
      releasePauseLock.resolve()
      await pauseLock
      await revocation
      await removeRevocationPauseTrigger()
    }
  })
})
