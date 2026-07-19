import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  InstalledAppIdSchema,
  OAuthStateHashSchema,
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

  it("grants a refresh lease to only one concurrent worker", async () => {
    // Given
    await store.saveTokens({ grant, issuedAt: now, source: "authorization" })
    const claim = { leaseMs: 60_000, now, refreshBeforeExpiryMs: 60 * 60 * 1_000 }

    // When
    const claims = await Promise.all([
      store.claimTokensForRefresh(claim),
      store.claimTokensForRefresh(claim),
    ])

    // Then
    expect(claims.filter((tokens) => tokens !== null)).toHaveLength(1)
  })
})
