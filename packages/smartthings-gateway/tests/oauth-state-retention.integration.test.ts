import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { OAuthStateHashSchema } from "../src/oauth/contracts.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"
import { oauthAuthorization } from "./fixtures/oauth-access.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const store = new PostgresOAuthStore({
  database,
  encryptionKeyBase64: Buffer.alloc(32, 7).toString("base64"),
})
const now = new Date("2026-07-22T00:00:00.000Z")

beforeAll(async () => {
  await runMigrations(database)
})

beforeEach(async () => {
  await database.deleteFrom("oauthStates").execute()
})

afterAll(async () => {
  await database.destroy()
})

describe("OAuth state retention", () => {
  it("deletes every expired row while preserving active states", async () => {
    // Given
    const expiredState = OAuthStateHashSchema.parse("a".repeat(64))
    const deadlineState = OAuthStateHashSchema.parse("b".repeat(64))
    const activeState = OAuthStateHashSchema.parse("c".repeat(64))
    await store.saveState(
      expiredState,
      new Date(now.getTime() - 1),
      oauthAuthorization(["r:devices:$"]),
    )
    await store.saveState(deadlineState, now, oauthAuthorization(["r:devices:$"]))
    await store.saveState(
      activeState,
      new Date(now.getTime() + 1),
      oauthAuthorization(["r:devices:$"]),
    )

    // When
    const purgedCount = await store.deleteExpiredStates(now)

    // Then
    expect(purgedCount).toBe(2)
    await expect(database.selectFrom("oauthStates").select("stateHash").execute()).resolves.toEqual(
      [{ stateHash: activeState }],
    )
  })
})
