import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"
import { generateGrowfulToken, hashGrowfulToken } from "../src/security/growful-token.js"
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

beforeAll(async () => {
  await runMigrations(database)
})

beforeEach(async () => {
  await database.deleteFrom("smartThingsConnections").execute()
})

afterAll(async () => {
  await database.deleteFrom("smartThingsConnections").execute()
  await database.destroy()
})

describe("private beta connection policy revocation", () => {
  it("revokes every connection when no invitations remain active", async () => {
    // Given
    const growfulToken = generateGrowfulToken()
    await store.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"], "private-user"),
      grant: {
        accessToken: "private-policy-access",
        expiresInSeconds: 3_600,
        installedAppId: InstalledAppIdSchema.parse("private-policy-installed-app"),
        refreshToken: "private-policy-refresh",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: new Date("2026-07-22T00:00:00.000Z"),
      growfulTokenHash: hashGrowfulToken(growfulToken),
      issuedAt: new Date("2026-07-22T00:00:00.000Z"),
      source: "authorization",
    })

    // When
    const revokedCount = await store.revokeUnauthorizedConnections({
      policyVersion: "test-policy",
      privateBetaUsernames: [],
    })

    // Then
    expect(revokedCount).toBe(1)
    await expect(store.authenticate(hashGrowfulToken(growfulToken))).resolves.toBeNull()
  })
})
