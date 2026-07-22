import { randomUUID } from "node:crypto"
import { sql } from "kysely"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { PostgresReadinessProbe } from "../src/health/postgres-readiness.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const readyAuditIntegrityProbe = { check: async () => "ready" as const }

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

describe("PostgreSQL readiness", () => {
  it("reports ready when the connection and required tables are available", async () => {
    // Given
    const probe = new PostgresReadinessProbe({
      auditIntegrityProbe: readyAuditIntegrityProbe,
      database,
    })

    // When
    const status = await probe.check()

    // Then
    expect(status).toBe("ready")
  })

  it("reports unavailable when the configured PostgreSQL database does not exist", async () => {
    // Given
    const unavailableDatabaseUrl = new URL(TEST_DATABASE_URL)
    unavailableDatabaseUrl.pathname = `/missing-readiness-${randomUUID()}`
    const unavailableDatabase = createDatabase(unavailableDatabaseUrl.toString())
    const probe = new PostgresReadinessProbe({
      auditIntegrityProbe: readyAuditIntegrityProbe,
      database: unavailableDatabase,
    })

    // When
    const status = await probe.check()
    await unavailableDatabase.destroy()

    // Then
    expect(status).toBe("unavailable")
  })

  it("reports unavailable when the audit integrity check is unavailable", async () => {
    // Given
    const probe = new PostgresReadinessProbe({
      auditIntegrityProbe: { check: async () => "unavailable" },
      database,
    })

    // When
    const status = await probe.check()

    // Then
    expect(status).toBe("unavailable")
  })

  it("reports an idle PostgreSQL connection failure without terminating the process", async () => {
    // Given
    let reportIdleClientError: ((error: Error) => void) | undefined
    const idleClientErrorReported = new Promise<Error>((resolve) => {
      reportIdleClientError = resolve
    })
    const targetDatabase = createDatabase(TEST_DATABASE_URL, {
      onIdleClientError(error) {
        reportIdleClientError?.(error)
      },
    })
    const controlDatabase = createDatabase(TEST_DATABASE_URL)
    const backendResult = await sql<{ readonly backendPid: number }>`
      select pg_backend_pid() as "backendPid"
    `.execute(targetDatabase)
    const { backendPid } = z
      .object({ backendPid: z.number().int().positive() })
      .parse(backendResult.rows[0])

    // When
    await sql`select pg_terminate_backend(${backendPid})`.execute(controlDatabase)
    const idleClientError = await idleClientErrorReported
    await Promise.all([targetDatabase.destroy(), controlDatabase.destroy()])

    // Then
    expect(idleClientError).toBeInstanceOf(Error)
  })
})
