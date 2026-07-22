import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  type GrowfulAbuseOperatorCommand,
  PostgresGrowfulAbuseControl,
} from "../src/abuse/abuse-control.js"
import { AuditEventHashSchema, hashAuditSubject } from "../src/audit/audit-event.js"
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
  encryptionKeyBase64: Buffer.alloc(32, 53).toString("base64"),
})
const actorIdHash = AuditEventHashSchema.parse("a".repeat(64))
const ticketHash = AuditEventHashSchema.parse("b".repeat(64))

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

async function seedConnection() {
  const installedAppId = InstalledAppIdSchema.parse(`abuse-control-${randomUUID()}`)
  const now = new Date("2026-07-22T00:00:00.000Z")
  await oauthStore.saveTokens({
    authorization: oauthAuthorization(["r:devices:*"]),
    grant: {
      accessToken: "abuse-control-access-token",
      expiresInSeconds: 3_600,
      installedAppId,
      refreshToken: "abuse-control-refresh-token",
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

function operatorCommand(
  supportReference: ReturnType<typeof hashAuditSubject>,
): GrowfulAbuseOperatorCommand {
  return { actorIdHash, supportReference, ticketHash }
}

describe("PostgreSQL Growful abuse control", () => {
  it("lists persistent quota violations by support reference", async () => {
    // Given
    const installedAppId = await seedConnection()
    const quota = new GrowfulRequestQuota({
      limit: 1,
      store: new PostgresGrowfulRequestQuotaStore({ database }),
    })
    await quota.consume(installedAppId)
    await quota.consume(installedAppId)
    await quota.consume(installedAppId)

    // When
    const reviews = await abuseControl.listReviews()

    // Then
    expect(reviews).toContainEqual({
      blockedAt: null,
      blockReason: null,
      lastRejectedAt: expect.any(Date),
      rejectedCount: 2,
      supportReference: hashAuditSubject(installedAppId),
    })
    expect(JSON.stringify(reviews)).not.toContain(installedAppId)
  })

  it("blocks a connection and appends operator evidence atomically", async () => {
    // Given
    const installedAppId = await seedConnection()
    const supportReference = hashAuditSubject(installedAppId)

    // When
    const changed = await abuseControl.block({
      ...operatorCommand(supportReference),
      reason: "quota_abuse",
    })

    // Then
    expect(changed).toBe(true)
    expect(await abuseControl.getBlock(installedAppId)).toEqual({
      blockedAt: expect.any(Date),
      reason: "quota_abuse",
    })
    const auditEvent = await database
      .selectFrom("auditEvents")
      .select(["action", "actorIdHash", "actorType", "subjectHash", "ticketHash"])
      .where("subjectHash", "=", supportReference)
      .where("action", "=", "connection.block")
      .executeTakeFirstOrThrow()
    expect(auditEvent).toEqual({
      action: "connection.block",
      actorIdHash,
      actorType: "operator",
      subjectHash: supportReference,
      ticketHash,
    })
  })

  it("unblocks a blocked connection and appends operator evidence", async () => {
    // Given
    const installedAppId = await seedConnection()
    const supportReference = hashAuditSubject(installedAppId)
    const command = operatorCommand(supportReference)
    await abuseControl.block({ ...command, reason: "security_incident" })

    // When
    const changed = await abuseControl.unblock(command)

    // Then
    expect(changed).toBe(true)
    expect(await abuseControl.getBlock(installedAppId)).toBeNull()
    const event = await database
      .selectFrom("auditEvents")
      .select(["action", "actorIdHash", "ticketHash"])
      .where("subjectHash", "=", supportReference)
      .where("action", "=", "connection.unblock")
      .executeTakeFirstOrThrow()
    expect(event).toEqual({ action: "connection.unblock", actorIdHash, ticketHash })
  })
})
