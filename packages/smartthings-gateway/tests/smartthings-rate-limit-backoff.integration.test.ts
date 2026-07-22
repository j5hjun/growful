import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  PostgresSmartThingsRateLimitBackoffStore,
  SmartThingsRateLimitBackoff,
} from "../src/http/smartthings-rate-limit-backoff.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"
import { generateGrowfulToken, hashGrowfulToken } from "../src/security/growful-token.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"
import { oauthAuthorization } from "./fixtures/oauth-access.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const oauthStore = new PostgresOAuthStore({
  database,
  encryptionKeyBase64: Buffer.alloc(32, 43).toString("base64"),
})

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

describe("PostgreSQL SmartThings rate-limit backoff", () => {
  it("shares a Retry-After deadline across gateway instances", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse(`shared-backoff-${randomUUID()}`)
    const now = new Date("2026-07-22T00:00:00.000Z")
    await oauthStore.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"]),
      grant: {
        accessToken: "shared-backoff-access-token",
        expiresInSeconds: 3_600,
        installedAppId,
        refreshToken: "shared-backoff-refresh-token",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: now,
      growfulTokenHash: hashGrowfulToken(generateGrowfulToken()),
      issuedAt: now,
      source: "authorization",
    })
    const firstBackoff = new SmartThingsRateLimitBackoff({
      now: () => now,
      store: new PostgresSmartThingsRateLimitBackoffStore({ database }),
    })
    const secondBackoff = new SmartThingsRateLimitBackoff({
      now: () => now,
      store: new PostgresSmartThingsRateLimitBackoffStore({ database }),
    })

    // When
    await Promise.all([
      firstBackoff.observeResponse(installedAppId, {
        body: Buffer.alloc(0),
        headers: { "retry-after": "17" },
        statusCode: 429,
      }),
      secondBackoff.observeResponse(installedAppId, {
        body: Buffer.alloc(0),
        headers: { "retry-after": "5" },
        statusCode: 429,
      }),
    ])

    // Then
    await expect(secondBackoff.getRetryAfterSeconds(installedAppId)).resolves.toBe(17)
  })
})
