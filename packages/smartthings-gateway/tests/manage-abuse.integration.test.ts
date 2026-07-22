import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { PostgresGrowfulAbuseControl } from "../src/abuse/abuse-control.js"
import { hashAuditSubject } from "../src/audit/audit-event.js"
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
const abuseControl = new PostgresGrowfulAbuseControl({ database })
const oauthStore = new PostgresOAuthStore({
  database,
  encryptionKeyBase64: Buffer.alloc(32, 59).toString("base64"),
})
const execFileAsync = promisify(execFile)
const operatorId = "operator@example.test"
const ticketId = "SEC-1234"

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

async function seedConnection() {
  const installedAppId = InstalledAppIdSchema.parse(`abuse-cli-${randomUUID()}`)
  const now = new Date("2026-07-22T00:00:00.000Z")
  await oauthStore.saveTokens({
    authorization: oauthAuthorization(["r:devices:*"]),
    grant: {
      accessToken: "abuse-cli-access-token",
      expiresInSeconds: 3_600,
      installedAppId,
      refreshToken: "abuse-cli-refresh-token",
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

async function runCli(arguments_: readonly string[]) {
  return execFileAsync("pnpm", ["exec", "tsx", "src/manage-abuse.ts", ...arguments_], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  })
}

describe("Growful abuse operator CLI", () => {
  it("lists repeated violations without exposing a connection identifier", async () => {
    // Given
    const installedAppId = await seedConnection()
    const quota = new GrowfulRequestQuota({
      limit: 1,
      store: new PostgresGrowfulRequestQuotaStore({ database }),
    })
    await quota.consume(installedAppId)
    await quota.consume(installedAppId)

    // When
    const result = await runCli(["list"])

    // Then
    expect(JSON.parse(result.stdout).reviews).toContainEqual({
      blockedAt: null,
      blockReason: null,
      lastRejectedAt: expect.any(String),
      rejectedCount: 1,
      supportReference: hashAuditSubject(installedAppId),
    })
    expect(result.stdout).not.toContain(installedAppId)
  })

  it("blocks by support reference and hashes operator evidence", async () => {
    // Given
    const installedAppId = await seedConnection()
    const supportReference = hashAuditSubject(installedAppId)

    // When
    const result = await runCli([
      "block",
      supportReference,
      "terms_violation",
      operatorId,
      ticketId,
    ])

    // Then
    expect(JSON.parse(result.stdout)).toEqual({ action: "block", changed: true, supportReference })
    expect(await abuseControl.getBlock(installedAppId)).toEqual({
      blockedAt: expect.any(Date),
      reason: "terms_violation",
    })
    const event = await database
      .selectFrom("auditEvents")
      .select(["actorIdHash", "ticketHash"])
      .where("action", "=", "connection.block")
      .where("subjectHash", "=", supportReference)
      .executeTakeFirstOrThrow()
    expect(event).toEqual({
      actorIdHash: createHash("sha256").update(operatorId).digest("hex"),
      ticketHash: createHash("sha256").update(ticketId).digest("hex"),
    })
    expect(JSON.stringify(event)).not.toContain(operatorId)
    expect(JSON.stringify(event)).not.toContain(ticketId)
  })

  it("unblocks by support reference", async () => {
    // Given
    const installedAppId = await seedConnection()
    const supportReference = hashAuditSubject(installedAppId)
    await runCli(["block", supportReference, "quota_abuse", operatorId, ticketId])

    // When
    const result = await runCli(["unblock", supportReference, operatorId, ticketId])

    // Then
    expect(JSON.parse(result.stdout)).toEqual({
      action: "unblock",
      changed: true,
      supportReference,
    })
    expect(await abuseControl.getBlock(installedAppId)).toBeNull()
  })
})
