import { randomUUID } from "node:crypto"
import { sql } from "kysely"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  AuditEventHashSchema,
  AuditEventIdSchema,
  createAuditEvent,
  hashAuditSubject,
} from "../src/audit/audit-event.js"
import { verifyPostgresAuditIntegrity } from "../src/audit/postgres-audit-integrity.js"
import { PostgresAuditSink } from "../src/audit/postgres-audit-sink.js"
import { InstalledAppIdSchema, RefreshClaimIdSchema } from "../src/oauth/contracts.js"
import {
  GrowfulTokenSchema,
  generateGrowfulToken,
  hashGrowfulToken,
} from "../src/security/growful-token.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"
import { oauthAuthorization } from "./fixtures/oauth-access.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const sink = new PostgresAuditSink({ database })
const oauthStore = new PostgresOAuthStore({
  database,
  encryptionKeyBase64: Buffer.alloc(32, 7).toString("base64"),
})

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

describe("audit event storage", () => {
  it("creates an append-only audit event table", async () => {
    // Given
    const expectedColumns = [
      "action",
      "actor_id_hash",
      "actor_type",
      "affected_count",
      "event_hash",
      "event_id",
      "occurred_at",
      "outcome",
      "previous_hash",
      "sequence",
      "subject_hash",
      "ticket_hash",
    ]

    // When
    const columns = await sql<{ readonly columnName: string }>`
      select column_name as "columnName"
      from information_schema.columns
      where table_schema = 'public' and table_name = 'audit_events'
      order by column_name
    `.execute(database)

    // Then
    expect(columns.rows.map(({ columnName }) => columnName)).toEqual(expectedColumns)
  })

  it("appends hash-chained events without storing the raw connection identifier", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse(`audit-chain-${randomUUID()}`)
    const subjectHash = hashAuditSubject(installedAppId)
    const occurredAt = new Date("2026-07-22T01:00:00.000Z")

    // When
    await sink.append({
      action: "connection.authorize",
      actorIdHash: null,
      actorType: "gateway_service",
      affectedCount: 1,
      occurredAt,
      outcome: "succeeded",
      subjectHash,
      ticketHash: null,
    })
    await sink.append({
      action: "token.read",
      actorIdHash: null,
      actorType: "gateway_service",
      affectedCount: 1,
      occurredAt: new Date(occurredAt.getTime() + 1),
      outcome: "succeeded",
      subjectHash,
      ticketHash: null,
    })
    const rows = await database
      .selectFrom("auditEvents")
      .selectAll()
      .where("subjectHash", "=", subjectHash)
      .orderBy("sequence")
      .execute()

    // Then
    expect(rows).toHaveLength(2)
    expect(rows[1]?.previousHash).toBe(rows[0]?.eventHash)
    expect(JSON.stringify(rows)).not.toContain(installedAppId)
  })

  it("uses the shared canonical hash for trigger-generated events", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse(`audit-canonical-${randomUUID()}`)
    const subjectHash = hashAuditSubject(installedAppId)

    // When
    await oauthStore.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"]),
      grant: {
        accessToken: "audit-canonical-access-token",
        expiresInSeconds: 3_600,
        installedAppId,
        refreshToken: "audit-canonical-refresh-token",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: new Date("2026-07-22T01:30:00.000Z"),
      growfulTokenHash: hashGrowfulToken(generateGrowfulToken()),
      issuedAt: new Date("2026-07-22T01:30:00.000Z"),
      source: "authorization",
    })
    const row = await database
      .selectFrom("auditEvents")
      .selectAll()
      .where("subjectHash", "=", subjectHash)
      .executeTakeFirstOrThrow()

    // Then
    const expected = createAuditEvent(
      {
        action: "connection.authorize",
        actorIdHash: null,
        actorType: "gateway_service",
        affectedCount: 1,
        occurredAt: row.occurredAt,
        outcome: "succeeded",
        subjectHash,
        ticketHash: null,
      },
      AuditEventIdSchema.parse(row.eventId),
      row.previousHash === null ? null : AuditEventHashSchema.parse(row.previousHash),
    )
    expect(row.eventHash).toBe(expected.eventHash)
  })

  it("verifies the complete audit chain read from PostgreSQL", async () => {
    // Given
    await sink.append({
      action: "connection.access",
      actorIdHash: null,
      actorType: "gateway_service",
      affectedCount: 1,
      occurredAt: new Date("2026-07-22T01:45:00.000Z"),
      outcome: "succeeded",
      subjectHash: null,
      ticketHash: null,
    })

    // When
    const result = await verifyPostgresAuditIntegrity(database)

    // Then
    expect(result.status).toBe("valid")
  })

  it("rejects mutation of an existing audit event", async () => {
    // Given
    const subjectHash = hashAuditSubject(InstalledAppIdSchema.parse("audit-mutation-installed-app"))
    await sink.append({
      action: "connection.disconnect",
      actorIdHash: null,
      actorType: "gateway_service",
      affectedCount: 1,
      occurredAt: new Date("2026-07-22T02:00:00.000Z"),
      outcome: "succeeded",
      subjectHash,
      ticketHash: null,
    })

    // When
    const mutation = database
      .updateTable("auditEvents")
      .set({ outcome: "failed" })
      .where("subjectHash", "=", subjectHash)
      .execute()

    // Then
    await expect(mutation).rejects.toThrow("audit_events is append-only")
  })

  it("audits connection authorization, token rotation, and disconnection atomically", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse(`audit-lifecycle-${randomUUID()}`)
    const subjectHash = hashAuditSubject(installedAppId)
    const firstToken = GrowfulTokenSchema.parse(
      `grw_st_${Buffer.alloc(32, 31).toString("base64url")}`,
    )
    const secondToken = GrowfulTokenSchema.parse(
      `grw_st_${Buffer.alloc(32, 32).toString("base64url")}`,
    )

    // When
    await oauthStore.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"]),
      grant: {
        accessToken: "audit-access-token",
        expiresInSeconds: 3_600,
        installedAppId,
        refreshToken: "audit-refresh-token",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: new Date("2026-07-22T03:00:00.000Z"),
      growfulTokenHash: hashGrowfulToken(firstToken),
      issuedAt: new Date("2026-07-22T03:00:00.000Z"),
      source: "authorization",
    })
    await oauthStore.replaceGrowfulToken(
      installedAppId,
      hashGrowfulToken(secondToken),
      new Date("2026-07-22T03:01:00.000Z"),
    )
    await oauthStore.deleteConnection(installedAppId)
    const events = await database
      .selectFrom("auditEvents")
      .select(["action", "subjectHash"])
      .where("subjectHash", "=", subjectHash)
      .orderBy("sequence")
      .execute()

    // Then
    expect(events).toEqual([
      { action: "connection.authorize", subjectHash },
      { action: "connection.token_rotate", subjectHash },
      { action: "connection.disconnect", subjectHash },
    ])
  })

  it("audits a refresh failure in the same transaction as its failure state", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse(`audit-refresh-${randomUUID()}`)
    const subjectHash = hashAuditSubject(installedAppId)
    const claimId = RefreshClaimIdSchema.parse(randomUUID())
    await oauthStore.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"]),
      grant: {
        accessToken: "audit-failure-access-token",
        expiresInSeconds: 3_600,
        installedAppId,
        refreshToken: "audit-failure-refresh-token",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: new Date("2026-07-22T05:00:00.000Z"),
      growfulTokenHash: hashGrowfulToken(generateGrowfulToken()),
      issuedAt: new Date("2026-07-22T05:00:00.000Z"),
      source: "authorization",
    })
    await oauthStore.claimTokensForRefresh({
      claimId,
      expectedAccessToken: "audit-failure-access-token",
      installedAppId,
      kind: "forced",
      leaseMs: 60_000,
      now: new Date("2026-07-22T05:01:00.000Z"),
    })

    // When
    await oauthStore.recordRefreshFailure({
      claimId,
      installedAppId,
      message: "SmartThingsTokenRequestError",
      occurredAt: new Date("2026-07-22T05:01:00.000Z"),
    })
    const events = await database
      .selectFrom("auditEvents")
      .select(["action", "outcome"])
      .where("subjectHash", "=", subjectHash)
      .orderBy("sequence")
      .execute()

    // Then
    expect(events).toContainEqual({ action: "token.refresh", outcome: "failed" })
  })
})
