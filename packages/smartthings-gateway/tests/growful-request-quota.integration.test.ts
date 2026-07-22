import { randomUUID } from "node:crypto"
import { sql } from "kysely"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  GrowfulRequestQuota,
  PostgresGrowfulRequestQuotaStore,
} from "../src/http/growful-request-quota.js"
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
  encryptionKeyBase64: Buffer.alloc(32, 47).toString("base64"),
})

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

describe("PostgreSQL Growful request quota", () => {
  async function seedConnection() {
    const installedAppId = InstalledAppIdSchema.parse(`shared-quota-${randomUUID()}`)
    const now = new Date("2026-07-22T00:00:00.000Z")
    await oauthStore.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"]),
      grant: {
        accessToken: "shared-quota-access-token",
        expiresInSeconds: 3_600,
        installedAppId,
        refreshToken: "shared-quota-refresh-token",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: now,
      growfulTokenHash: hashGrowfulToken(generateGrowfulToken()),
      issuedAt: now,
      source: "authorization",
    })
    return installedAppId
  }

  it("shares one atomic connection window across gateway instances", async () => {
    // Given
    const installedAppId = await seedConnection()
    const now = new Date("2026-07-22T00:00:00.000Z")
    const firstQuota = new GrowfulRequestQuota({
      limit: 2,
      now: () => now,
      store: new PostgresGrowfulRequestQuotaStore({ database }),
      windowMilliseconds: 60_000,
    })
    const secondQuota = new GrowfulRequestQuota({
      limit: 2,
      now: () => now,
      store: new PostgresGrowfulRequestQuotaStore({ database }),
      windowMilliseconds: 60_000,
    })

    // When
    const outcomes = await Promise.all([
      firstQuota.consume(installedAppId),
      secondQuota.consume(installedAppId),
      firstQuota.consume(installedAppId),
    ])

    // Then
    expect(outcomes.sort((left, right) => (left ?? 0) - (right ?? 0))).toEqual([null, null, 60])
  })

  it("uses database time when gateway clocks disagree", async () => {
    // Given
    const installedAppId = await seedConnection()
    const firstQuota = new GrowfulRequestQuota({
      limit: 1,
      now: () => new Date("2026-07-22T00:01:00.000Z"),
      store: new PostgresGrowfulRequestQuotaStore({ database }),
      windowMilliseconds: 60_000,
    })
    const secondQuota = new GrowfulRequestQuota({
      limit: 1,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      store: new PostgresGrowfulRequestQuotaStore({ database }),
      windowMilliseconds: 60_000,
    })
    await firstQuota.consume(installedAppId)

    // When
    const retryAfterSeconds = await secondQuota.consume(installedAppId)

    // Then
    expect(retryAfterSeconds).toBe(60)
  })

  it("persists repeated quota rejections for abuse review", async () => {
    // Given
    const installedAppId = await seedConnection()
    const quota = new GrowfulRequestQuota({
      limit: 1,
      store: new PostgresGrowfulRequestQuotaStore({ database }),
      windowMilliseconds: 60_000,
    })
    await quota.consume(installedAppId)

    // When
    await Promise.all([quota.consume(installedAppId), quota.consume(installedAppId)])

    // Then
    const result = await sql<{
      readonly lastRejectedAt: Date | null
      readonly rejectedCount: number
    }>`
      select
        growful_quota_last_rejected_at as "lastRejectedAt",
        growful_quota_rejected_count as "rejectedCount"
      from smart_things_connections
      where installed_app_id = ${installedAppId}
    `.execute(database)
    expect(result.rows).toEqual([
      {
        lastRejectedAt: expect.any(Date),
        rejectedCount: 2,
      },
    ])
  })
})
