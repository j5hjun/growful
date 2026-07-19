import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  InstalledAppIdSchema,
  OAuthStateHashSchema,
  RefreshClaimIdSchema,
  StaleRefreshClaimError,
  type TokenGrant,
} from "../src/oauth/contracts.js"
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
const grant: TokenGrant = {
  accessToken: "postgres-access-token",
  expiresInSeconds: 30,
  installedAppId: InstalledAppIdSchema.parse("postgres-installed-app"),
  refreshToken: "postgres-refresh-token",
  scope: "r:devices:*",
  tokenType: "bearer",
}

beforeAll(async () => {
  await runMigrations(database)
})

beforeEach(async () => {
  await database.deleteFrom("oauthStates").execute()
  await database.deleteFrom("oauthTokens").execute()
})

afterAll(async () => {
  await database.destroy()
})

describe("PostgresOAuthStore", () => {
  it("consumes an OAuth state only once", async () => {
    // Given
    const stateHash = OAuthStateHashSchema.parse("a".repeat(64))
    await store.saveState(stateHash, new Date(now.getTime() + 60_000))

    // When
    const firstConsumption = await store.consumeState(stateHash, now)
    const secondConsumption = await store.consumeState(stateHash, now)

    // Then
    expect(firstConsumption).toBe(true)
    expect(secondConsumption).toBe(false)
  })

  it("stores both tokens encrypted at rest", async () => {
    // Given
    await store.saveTokens({ grant, issuedAt: now, source: "authorization" })

    // When
    const rawRow = await database.selectFrom("oauthTokens").selectAll().executeTakeFirstOrThrow()

    // Then
    expect(rawRow.accessTokenCiphertext).not.toContain(grant.accessToken)
    expect(rawRow.refreshTokenCiphertext).not.toContain(grant.refreshToken)
    expect(await store.getTokens()).toMatchObject({
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
    })
  })

  it("keeps one token row when authorizations finish concurrently", async () => {
    const secondGrant: TokenGrant = {
      ...grant,
      accessToken: "second-access-token",
      installedAppId: InstalledAppIdSchema.parse("second-installed-app"),
      refreshToken: "second-refresh-token",
    }

    await Promise.all([
      store.saveTokens({ grant, issuedAt: now, source: "authorization" }),
      store.saveTokens({ grant: secondGrant, issuedAt: now, source: "authorization" }),
    ])

    const rows = await database.selectFrom("oauthTokens").select("installedAppId").execute()
    expect(rows).toHaveLength(1)
    expect([grant.installedAppId, secondGrant.installedAppId]).toContain(rows[0]?.installedAppId)
  })

  it("grants a refresh lease to only one concurrent worker", async () => {
    // Given
    await store.saveTokens({ grant, issuedAt: now, source: "authorization" })
    const claim = {
      claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      leaseMs: 60_000,
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

  it("prevents an expired refresh claimant from overwriting a newer claim", async () => {
    // Given
    await store.saveTokens({ grant, issuedAt: now, source: "authorization" })
    const firstClaimId = RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000001")
    const secondClaimId = RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000002")
    await store.claimTokensForRefresh({
      claimId: firstClaimId,
      leaseMs: 60_000,
      now,
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
    })
    const secondClaimTime = new Date(now.getTime() + 60_001)
    await store.claimTokensForRefresh({
      claimId: secondClaimId,
      leaseMs: 60_000,
      now: secondClaimTime,
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
    })
    const rotatedGrant = {
      ...grant,
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
    }

    // When
    const staleSave = store.saveTokens({
      claimId: firstClaimId,
      grant: rotatedGrant,
      issuedAt: secondClaimTime,
      source: "refresh",
    })

    // Then
    await expect(staleSave).rejects.toBeInstanceOf(StaleRefreshClaimError)
    await store.recordRefreshFailure({
      claimId: firstClaimId,
      installedAppId: grant.installedAppId,
      message: "stale worker",
      occurredAt: secondClaimTime,
    })
    await expect(
      store.saveTokens({
        claimId: secondClaimId,
        grant: rotatedGrant,
        issuedAt: secondClaimTime,
        source: "refresh",
      }),
    ).resolves.toMatchObject({ refreshToken: "rotated-refresh-token" })
  })
})
