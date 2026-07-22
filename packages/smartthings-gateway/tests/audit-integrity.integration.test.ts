import { randomUUID } from "node:crypto"
import { sql } from "kysely"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  type AuditEvent,
  type AuditEventHash,
  AuditEventHashSchema,
  AuditEventIdSchema,
  createAuditEvent,
} from "../src/audit/audit-event.js"
import { AuditIntegrityMonitor } from "../src/audit/audit-integrity-monitor.js"
import {
  type AuditIntegrityCheckpoint,
  auditIntegrityVerificationPageSize,
  type PostgresAuditIntegrityVerification,
  verifyPostgresAuditIntegrity,
} from "../src/audit/postgres-audit-integrity.js"
import { PostgresReadinessProbe } from "../src/health/postgres-readiness.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const controlDatabase = createDatabase(TEST_DATABASE_URL)
const databaseName = `audit_integrity_${randomUUID().replaceAll("-", "")}`
const databaseUrl = new URL(TEST_DATABASE_URL)
databaseUrl.pathname = `/${databaseName}`
const database = createDatabase(databaseUrl.toString())

beforeAll(async () => {
  await sql`create database ${sql.id(databaseName)}`.execute(controlDatabase)
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
  await sql`drop database ${sql.id(databaseName)}`.execute(controlDatabase)
  await controlDatabase.destroy()
})

async function appendAuditEvents(count: number): Promise<void> {
  const previous = await database
    .selectFrom("auditEvents")
    .select("eventHash")
    .orderBy("sequence", "desc")
    .executeTakeFirst()
  let previousHash: AuditEventHash | null =
    previous === undefined ? null : AuditEventHashSchema.parse(previous.eventHash)
  const events: AuditEvent[] = []
  for (let index = 0; index < count; index += 1) {
    const event = createAuditEvent(
      {
        action: "connection.access",
        actorIdHash: null,
        actorType: "gateway_service",
        affectedCount: 1,
        occurredAt: new Date("2026-07-23T00:00:00.000Z"),
        outcome: "succeeded",
        subjectHash: null,
        ticketHash: null,
      },
      AuditEventIdSchema.parse(randomUUID()),
      previousHash,
    )
    events.push(event)
    previousHash = event.eventHash
  }
  await database.insertInto("auditEvents").values(events).execute()
}

describe("PostgreSQL audit integrity verification", () => {
  it("bounds one verification step when retained history exceeds one page", async () => {
    // Given
    await appendAuditEvents(auditIntegrityVerificationPageSize + 1)

    // When
    const result = await verifyPostgresAuditIntegrity(database)

    // Then
    expect(result.status).toBe("in_progress")
    if (result.status === "in_progress") {
      expect(result.checkpoint.eventCount).toBe(auditIntegrityVerificationPageSize)
    }
  })

  it("resumes from the page checkpoint and verifies the complete snapshot", async () => {
    // Given
    let checkpoint: AuditIntegrityCheckpoint | null = null
    let previousEventCount = 0
    const verifiedPageCounts: number[] = []

    // When
    let result = await verifyPostgresAuditIntegrity(database, checkpoint)
    while (result.status === "in_progress") {
      verifiedPageCounts.push(result.checkpoint.eventCount - previousEventCount)
      previousEventCount = result.checkpoint.eventCount
      checkpoint = result.checkpoint
      result = await verifyPostgresAuditIntegrity(database, checkpoint)
    }

    // Then
    expect(result.status).toBe("valid")
    expect(verifiedPageCounts.every((count) => count <= auditIntegrityVerificationPageSize)).toBe(
      true,
    )
  })

  it("detects tampering in the next bounded page", async () => {
    // Given
    let checkpoint: AuditIntegrityCheckpoint | null = null
    let result = await verifyPostgresAuditIntegrity(database, checkpoint)
    while (result.status === "in_progress") {
      checkpoint = result.checkpoint
      const remaining = await database
        .selectFrom("auditEvents")
        .select(({ fn }) => fn.countAll<string>().as("count"))
        .where("sequence", ">", checkpoint.lastSequence)
        .where("sequence", "<=", checkpoint.targetSequence)
        .executeTakeFirstOrThrow()
      if (Number(remaining.count) <= auditIntegrityVerificationPageSize) {
        break
      }
      result = await verifyPostgresAuditIntegrity(database, checkpoint)
    }
    expect(checkpoint).not.toBeNull()
    if (checkpoint === null) {
      return
    }
    const target = await database
      .selectFrom("auditEvents")
      .select("outcome")
      .where("sequence", "=", checkpoint.targetSequence)
      .executeTakeFirstOrThrow()
    await sql`alter table audit_events disable trigger audit_events_append_only`.execute(database)

    // When
    let tamperedResult: PostgresAuditIntegrityVerification | undefined
    try {
      await database
        .updateTable("auditEvents")
        .set({ outcome: target.outcome === "succeeded" ? "failed" : "succeeded" })
        .where("sequence", "=", checkpoint.targetSequence)
        .execute()
      tamperedResult = await verifyPostgresAuditIntegrity(database, checkpoint)
    } finally {
      await database
        .updateTable("auditEvents")
        .set({ outcome: target.outcome })
        .where("sequence", "=", checkpoint.targetSequence)
        .execute()
      await sql`alter table audit_events enable trigger audit_events_append_only`.execute(database)
    }

    // Then
    expect(tamperedResult).toEqual({
      reason: "event_hash_mismatch",
      sequence: checkpoint.targetSequence,
      status: "invalid",
    })
  })

  it("keeps PostgreSQL readiness unavailable until the startup snapshot is complete", async () => {
    // Given
    const monitor = new AuditIntegrityMonitor((checkpoint) =>
      verifyPostgresAuditIntegrity(database, checkpoint),
    )
    const readiness = new PostgresReadinessProbe({ auditIntegrityProbe: monitor, database })
    const logger = { error() {}, info() {} }

    // When
    await monitor.refresh(logger)
    const firstPageStatus = await readiness.check()
    for (let page = 1; page < 10 && (await readiness.check()) === "unavailable"; page += 1) {
      await monitor.refresh(logger)
    }

    // Then
    expect(firstPageStatus).toBe("unavailable")
    expect(await readiness.check()).toBe("ready")
  })
})
