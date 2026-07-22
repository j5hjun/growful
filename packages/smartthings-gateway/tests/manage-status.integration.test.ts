import { execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { sql } from "kysely"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { PostgresServiceStatusManager } from "../src/status/postgres-service-status.js"
import { ServiceIncidentIdSchema } from "../src/status/service-status.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const openOutputSchema = z.object({
  action: z.literal("open"),
  incidentId: ServiceIncidentIdSchema,
})
const changeOutputSchema = z.object({
  action: z.enum(["resolve", "update"]),
  changed: z.boolean(),
  incidentId: ServiceIncidentIdSchema,
})
const incidentRowSchema = z.object({
  impact: z.literal("degraded"),
  message: z.string(),
  status: z.literal("investigating"),
  title: z.string(),
})
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const execFileAsync = promisify(execFile)

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

async function runCli(arguments_: readonly string[]) {
  return execFileAsync("pnpm", ["exec", "tsx", "src/manage-status.ts", ...arguments_], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  })
}

async function openSyntheticIncident(suffix: string) {
  const result = await runCli([
    "open",
    "degraded",
    `Synthetic degraded service ${suffix}`,
    `Synthetic investigation ${suffix}`,
    "operator@example.test",
    `STATUS-OPEN-${suffix}`,
  ])
  return openOutputSchema.parse(JSON.parse(result.stdout)).incidentId
}

describe("Service status operator CLI", () => {
  it("returns the newest fifty resolved incidents", async () => {
    // Given
    const rollbackSignal = new Error("rollback service status ordering fixture")
    let didRollback = false

    // When
    try {
      await database.transaction().execute(async (transaction) => {
        await transaction.deleteFrom("serviceIncidentUpdates").execute()
        await transaction.deleteFrom("serviceIncidents").execute()
        const incidents = Array.from({ length: 51 }, (_, index) => {
          const occurredAt = new Date(Date.UTC(2026, 6, 1, 0, 0, index))
          return {
            impact: "degraded" as const,
            incidentId: randomUUID(),
            resolvedAt: occurredAt,
            startedAt: occurredAt,
            title: `Resolved ordering incident ${index.toString().padStart(2, "0")}`,
          }
        })
        await transaction.insertInto("serviceIncidents").values(incidents).execute()
        await transaction
          .insertInto("serviceIncidentUpdates")
          .values(
            incidents.map((incident) => ({
              incidentId: incident.incidentId,
              message: `Resolved ordering update ${incident.title}`,
              occurredAt: incident.resolvedAt,
              status: "resolved" as const,
            })),
          )
          .execute()

        const publicIncidents = await new PostgresServiceStatusManager(
          transaction,
        ).listPublicIncidents()
        expect(publicIncidents).toHaveLength(50)
        expect(publicIncidents[0]?.title).toBe("Resolved ordering incident 50")
        expect(publicIncidents.at(-1)?.title).toBe("Resolved ordering incident 01")
        expect(publicIncidents.map((incident) => incident.title)).not.toContain(
          "Resolved ordering incident 00",
        )
        throw rollbackSignal
      })
    } catch (error) {
      if (error !== rollbackSignal) throw error
      didRollback = true
    }

    // Then
    expect(didRollback).toBe(true)
  })

  it("opens a public incident while hashing operator evidence", async () => {
    // Given
    const suffix = randomUUID()
    const title = `Synthetic degraded service ${suffix}`
    const message = `Synthetic investigation ${suffix}`
    const operatorId = "operator@example.test"
    const ticketId = `STATUS-${suffix}`

    // When
    const result = await runCli(["open", "degraded", title, message, operatorId, ticketId])

    // Then
    const output = openOutputSchema.parse(JSON.parse(result.stdout))
    const incidentRows = await sql`
      select incidents.impact, incidents.title, updates.message, updates.status
      from service_incidents incidents
      join service_incident_updates updates using (incident_id)
      where incidents.incident_id = ${output.incidentId}
    `.execute(database)
    const incident = incidentRowSchema.parse(incidentRows.rows[0])
    expect(incident).toEqual({ impact: "degraded", message, status: "investigating", title })
    const auditEvent = await database
      .selectFrom("auditEvents")
      .select(["actorIdHash", "ticketHash"])
      .where("action", "=", "status.incident_open")
      .where("subjectHash", "=", createHash("sha256").update(output.incidentId).digest("hex"))
      .executeTakeFirstOrThrow()
    expect(auditEvent).toEqual({
      actorIdHash: createHash("sha256").update(operatorId).digest("hex"),
      ticketHash: createHash("sha256").update(ticketId).digest("hex"),
    })
    expect(result.stdout).not.toContain(operatorId)
    expect(result.stdout).not.toContain(ticketId)
  })

  it("adds a monitoring update to an active incident", async () => {
    // Given
    const suffix = randomUUID()
    const incidentId = await openSyntheticIncident(suffix)
    const message = `Synthetic monitoring ${suffix}`

    // When
    const result = await runCli([
      "update",
      incidentId,
      "monitoring",
      message,
      "operator@example.test",
      `STATUS-UPDATE-${suffix}`,
    ])

    // Then
    expect(changeOutputSchema.parse(JSON.parse(result.stdout))).toEqual({
      action: "update",
      changed: true,
      incidentId,
    })
    const latest = await database
      .selectFrom("serviceIncidentUpdates")
      .select(["message", "status"])
      .where("incidentId", "=", incidentId)
      .orderBy("sequence", "desc")
      .executeTakeFirstOrThrow()
    expect(latest).toEqual({ message, status: "monitoring" })
  })

  it("resolves an active incident", async () => {
    // Given
    const suffix = randomUUID()
    const incidentId = await openSyntheticIncident(suffix)
    const message = `Synthetic resolved ${suffix}`

    // When
    const result = await runCli([
      "resolve",
      incidentId,
      message,
      "operator@example.test",
      `STATUS-RESOLVE-${suffix}`,
    ])

    // Then
    expect(changeOutputSchema.parse(JSON.parse(result.stdout))).toEqual({
      action: "resolve",
      changed: true,
      incidentId,
    })
    const incident = await database
      .selectFrom("serviceIncidents")
      .select("resolvedAt")
      .where("incidentId", "=", incidentId)
      .executeTakeFirstOrThrow()
    expect(incident.resolvedAt).toBeInstanceOf(Date)
  })

  it("does not append updates after an incident is resolved", async () => {
    // Given
    const suffix = randomUUID()
    const incidentId = await openSyntheticIncident(suffix)
    await runCli([
      "resolve",
      incidentId,
      `Synthetic resolved ${suffix}`,
      "operator@example.test",
      `STATUS-RESOLVE-${suffix}`,
    ])

    // When
    const result = await runCli([
      "update",
      incidentId,
      "monitoring",
      `Late update ${suffix}`,
      "operator@example.test",
      `STATUS-LATE-${suffix}`,
    ])

    // Then
    expect(changeOutputSchema.parse(JSON.parse(result.stdout))).toEqual({
      action: "update",
      changed: false,
      incidentId,
    })
    const updates = await database
      .selectFrom("serviceIncidentUpdates")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("incidentId", "=", incidentId)
      .executeTakeFirstOrThrow()
    expect(Number(updates.count)).toBe(2)
  })
})
