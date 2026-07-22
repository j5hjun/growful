import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { hashAuditSubject, hashAuditValue } from "../src/audit/audit-event.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"
import { InvalidOAuthStateError, OAuthService } from "../src/oauth/oauth-service.js"
import { PostgresPrivacyDeletion } from "../src/privacy/postgres-privacy-deletion.js"
import { generateGrowfulToken, hashGrowfulToken } from "../src/security/growful-token.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { oauthAuthorization, testDisclosures } from "./fixtures/oauth-access.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const installedAppId = InstalledAppIdSchema.parse(`privacy-race-${randomUUID()}`)
const postDeletionInstalledAppId = InstalledAppIdSchema.parse(`privacy-new-oauth-${randomUUID()}`)
const supportReference = hashAuditSubject(installedAppId)
const oauthStore = new PostgresOAuthStore({
  database,
  encryptionKeyBase64: Buffer.alloc(32, 73).toString("base64"),
})
const privacyDeletion = new PostgresPrivacyDeletion({ database })

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database
    .deleteFrom("smartThingsConnections")
    .where("installedAppId", "in", [installedAppId, postDeletionInstalledAppId])
    .execute()
  await database
    .deleteFrom("privacyDeletionEpochs")
    .where("subjectHash", "in", [supportReference, hashAuditSubject(postDeletionInstalledAppId)])
    .execute()
  await database.destroy()
})

describe("privacy deletion and OAuth completion concurrency", () => {
  it("does not recreate credentials when a pre-deletion completion resumes after deletion commits", async () => {
    // Given
    const authorizationStartedAt = new Date("2026-07-23T00:00:00.000Z")
    await oauthStore.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"]),
      grant: {
        accessToken: "privacy-race-existing-access",
        expiresInSeconds: 3_600,
        installedAppId,
        refreshToken: "privacy-race-existing-refresh",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: authorizationStartedAt,
      growfulTokenHash: hashGrowfulToken(generateGrowfulToken()),
      issuedAt: authorizationStartedAt,
      source: "authorization",
    })
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
      client,
      now: () => authorizationStartedAt,
      refreshBeforeExpiryMs: 3_600_000,
      refreshLeaseMs: 120_000,
      stateGenerator: () => "privacy-deletion-race-state",
      store: oauthStore,
    })
    const authorizationUrl = await service.startAuthorization({
      policyVersion: testDisclosures.policyVersion,
      privateBetaInviteGeneration: null,
      privateBetaUsername: null,
      requestedScopes: ["r:devices:*"],
    })
    const state = authorizationUrl.searchParams.get("state") ?? ""
    const completionOutcome = service.completeAuthorization("privacy-race-code", state).then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    )
    await exchangeStarted.promise

    // When
    const deletionResult = await privacyDeletion.delete({
      actorIdHash: hashAuditValue("privacy-race-operator"),
      supportReference,
      ticketHash: hashAuditValue("PRIVACY-RACE-DELETE"),
    })
    releaseExchange.resolve()
    const outcome = await completionOutcome

    // Then
    expect(deletionResult).toEqual({ affectedCount: 1, outcome: "succeeded" })
    expect(outcome.status).toBe("rejected")
    if (outcome.status === "rejected") {
      expect(outcome.error).toBeInstanceOf(InvalidOAuthStateError)
    }
    await expect(
      database
        .selectFrom("smartThingsConnections")
        .select("installedAppId")
        .where("installedAppId", "=", installedAppId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined()
  })

  it("allows a new OAuth authorization started after privacy deletion commits", async () => {
    // Given
    const now = new Date("2026-07-23T00:00:00.000Z")
    await oauthStore.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"]),
      grant: {
        accessToken: "privacy-new-oauth-existing-access",
        expiresInSeconds: 3_600,
        installedAppId: postDeletionInstalledAppId,
        refreshToken: "privacy-new-oauth-existing-refresh",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: now,
      growfulTokenHash: hashGrowfulToken(generateGrowfulToken()),
      issuedAt: now,
      source: "authorization",
    })
    const deletionResult = await privacyDeletion.delete({
      actorIdHash: hashAuditValue("privacy-new-oauth-operator"),
      supportReference: hashAuditSubject(postDeletionInstalledAppId),
      ticketHash: hashAuditValue("PRIVACY-NEW-OAUTH-DELETE"),
    })
    expect(deletionResult).toEqual({ affectedCount: 1, outcome: "succeeded" })
    const client = new FakeSmartThingsClient()
    client.exchangeGrant = {
      ...client.exchangeGrant,
      installedAppId: postDeletionInstalledAppId,
      scopes: ["r:devices:*"],
    }
    const service = new OAuthService({
      client,
      now: () => now,
      refreshBeforeExpiryMs: 3_600_000,
      refreshLeaseMs: 120_000,
      stateGenerator: () => "privacy-new-oauth-state",
      store: oauthStore,
    })

    // When
    const authorizationUrl = await service.startAuthorization({
      policyVersion: testDisclosures.policyVersion,
      privateBetaInviteGeneration: null,
      privateBetaUsername: null,
      requestedScopes: ["r:devices:*"],
    })
    const completion = await service.completeAuthorization(
      "privacy-new-oauth-code",
      authorizationUrl.searchParams.get("state") ?? "",
    )

    // Then
    expect(completion.connection.connected).toBe(true)
    await expect(oauthStore.getTokens(postDeletionInstalledAppId)).resolves.toMatchObject({
      accessToken: client.exchangeGrant.accessToken,
      refreshToken: client.exchangeGrant.refreshToken,
    })
  })
})
