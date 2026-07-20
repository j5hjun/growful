import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  InstalledAppIdSchema,
  OAuthStateHashSchema,
  RefreshClaimIdSchema,
  StaleRefreshClaimError,
  type TokenGrant,
} from "../src/oauth/contracts.js"
import { GrowfulTokenSchema, hashGrowfulToken } from "../src/security/growful-token.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const store = new PostgresOAuthStore({
  database,
  encryptionKeyBase64: Buffer.alloc(32, 7).toString("base64"),
})
const now = new Date("2026-07-19T00:00:00.000Z")

function grant(index: number): TokenGrant {
  return {
    accessToken: `postgres-access-${index}`,
    expiresInSeconds: 30,
    installedAppId: InstalledAppIdSchema.parse(`postgres-installed-app-${index}`),
    refreshToken: `postgres-refresh-${index}`,
    scopes: ["r:devices:*"],
    tokenType: "bearer",
  }
}

function growfulToken(index: number) {
  return GrowfulTokenSchema.parse(`grw_st_${Buffer.alloc(32, index).toString("base64url")}`)
}

async function saveAuthorization(index: number) {
  const tokenGrant = grant(index)
  await store.saveTokens({
    grant: tokenGrant,
    growfulTokenCreatedAt: now,
    growfulTokenHash: hashGrowfulToken(growfulToken(index)),
    issuedAt: now,
    source: "authorization",
  })
  return tokenGrant
}

beforeAll(async () => {
  await runMigrations(database)
})

beforeEach(async () => {
  await database.deleteFrom("oauthStates").execute()
  await database.deleteFrom("oauthTokens").execute()
  await database.deleteFrom("smartThingsConnections").execute()
})

afterAll(async () => {
  await database.destroy()
})

describe("PostgresOAuthStore", () => {
  it("consumes an OAuth state once with its requested scopes", async () => {
    // Given
    const stateHash = OAuthStateHashSchema.parse("a".repeat(64))
    await store.saveState(stateHash, new Date(now.getTime() + 60_000), ["r:devices:$"])

    // When
    const first = await store.consumeState(stateHash, now)
    const replay = await store.consumeState(stateHash, now)

    // Then
    expect(first).toEqual(["r:devices:$"])
    expect(replay).toBeNull()
  })

  it("clears the legacy singleton connection while keeping its table rollbackable", async () => {
    // Given
    await database
      .insertInto("oauthTokens")
      .values({
        accessTokenCiphertext: "legacy-access",
        expiresAt: now,
        installedAppId: "legacy-installed-app",
        lastRefreshError: null,
        lastRefreshedAt: null,
        refreshClaimedUntil: null,
        refreshClaimId: null,
        refreshTokenCiphertext: "legacy-refresh",
        scope: "r:devices:*",
        tokenType: "bearer",
        updatedAt: now,
      })
      .execute()

    // When
    await runMigrations(database)

    // Then
    await expect(database.selectFrom("oauthTokens").selectAll().execute()).resolves.toEqual([])
  })

  it("stores independent connections with encrypted SmartThings tokens", async () => {
    // Given
    const first = await saveAuthorization(1)
    const second = await saveAuthorization(2)

    // When
    const rows = await database.selectFrom("smartThingsConnections").selectAll().execute()

    // Then
    expect(rows).toHaveLength(2)
    expect(rows[0]?.accessTokenCiphertext).not.toContain(first.accessToken)
    expect(rows[1]?.refreshTokenCiphertext).not.toContain(second.refreshToken)
    await expect(store.authenticate(hashGrowfulToken(growfulToken(1)))).resolves.toBe(
      first.installedAppId,
    )
    await expect(store.getTokens(second.installedAppId)).resolves.toMatchObject({
      accessToken: second.accessToken,
      refreshToken: second.refreshToken,
    })
  })

  it("reauthorizes one installed app without replacing another connection", async () => {
    // Given
    const first = await saveAuthorization(1)
    const second = await saveAuthorization(2)

    // When
    await store.saveTokens({
      grant: { ...first, accessToken: "reauthorized-access", refreshToken: "reauthorized-refresh" },
      growfulTokenCreatedAt: now,
      growfulTokenHash: hashGrowfulToken(growfulToken(3)),
      issuedAt: now,
      source: "authorization",
    })

    // Then
    await expect(store.authenticate(hashGrowfulToken(growfulToken(1)))).resolves.toBeNull()
    await expect(store.authenticate(hashGrowfulToken(growfulToken(3)))).resolves.toBe(
      first.installedAppId,
    )
    await expect(store.getTokens(second.installedAppId)).resolves.toMatchObject({
      accessToken: second.accessToken,
      refreshToken: second.refreshToken,
      scopes: second.scopes,
    })
  })

  it("grants a due refresh lease to one worker per connection", async () => {
    // Given
    await saveAuthorization(1)
    const claim = {
      claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      kind: "due" as const,
      leaseMs: 120_000,
      now,
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
    }

    // When
    const claims = await Promise.all([
      store.claimTokensForRefresh(claim),
      store.claimTokensForRefresh(claim),
    ])

    // Then
    expect(claims.filter((tokens) => tokens !== null)).toHaveLength(1)
  })

  it("forces refresh only for the selected connection and rejected access token", async () => {
    // Given
    const first = await saveAuthorization(1)
    const second = await saveAuthorization(2)

    // When
    const claimed = await store.claimTokensForRefresh({
      claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      expectedAccessToken: second.accessToken,
      installedAppId: second.installedAppId,
      kind: "forced",
      leaseMs: 120_000,
      now,
    })
    const wrongConnection = await store.claimTokensForRefresh({
      claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000002"),
      expectedAccessToken: second.accessToken,
      installedAppId: first.installedAppId,
      kind: "forced",
      leaseMs: 120_000,
      now,
    })

    // Then
    expect(claimed?.installedAppId).toBe(second.installedAppId)
    expect(wrongConnection).toBeNull()
  })

  it("prevents an expired refresh claimant from overwriting a newer claim", async () => {
    // Given
    const tokenGrant = await saveAuthorization(1)
    const firstClaimId = RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000001")
    const secondClaimId = RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000002")
    const dueClaim = {
      kind: "due" as const,
      leaseMs: 120_000,
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
    }
    await store.claimTokensForRefresh({ ...dueClaim, claimId: firstClaimId, now })
    const secondClaimTime = new Date(now.getTime() + 120_001)
    await store.claimTokensForRefresh({
      ...dueClaim,
      claimId: secondClaimId,
      now: secondClaimTime,
    })

    // When
    const staleSave = store.saveTokens({
      claimId: firstClaimId,
      grant: { ...tokenGrant, accessToken: "stale-access", refreshToken: "stale-refresh" },
      issuedAt: secondClaimTime,
      source: "refresh",
    })

    // Then
    await expect(staleSave).rejects.toBeInstanceOf(StaleRefreshClaimError)
    await expect(
      store.saveTokens({
        claimId: secondClaimId,
        grant: { ...tokenGrant, accessToken: "current-access", refreshToken: "current-refresh" },
        issuedAt: secondClaimTime,
        source: "refresh",
      }),
    ).resolves.toMatchObject({ accessToken: "current-access" })
  })

  it("keeps a failed refresh leased until its connection lease expires", async () => {
    // Given
    const tokenGrant = await saveAuthorization(1)
    const leaseMs = 120_000
    const firstClaimId = RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000001")
    await store.claimTokensForRefresh({
      claimId: firstClaimId,
      kind: "due",
      leaseMs,
      now,
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
    })
    await store.recordRefreshFailure({
      claimId: firstClaimId,
      installedAppId: tokenGrant.installedAppId,
      message: "SmartThingsTokenRequestError",
      occurredAt: now,
    })

    // When
    const immediateRetry = await store.claimTokensForRefresh({
      claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000002"),
      kind: "due",
      leaseMs,
      now: new Date(now.getTime() + leaseMs - 1),
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
    })
    const retryAfterLease = await store.claimTokensForRefresh({
      claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000003"),
      kind: "due",
      leaseMs,
      now: new Date(now.getTime() + leaseMs),
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
    })

    // Then
    expect(immediateRetry).toBeNull()
    expect(retryAfterLease?.installedAppId).toBe(tokenGrant.installedAppId)
  })
})
