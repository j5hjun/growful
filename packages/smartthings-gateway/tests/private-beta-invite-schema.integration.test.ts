import { sql } from "kysely"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { PostgresReadinessProbe } from "../src/health/postgres-readiness.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const readyAuditIntegrityProbe = { check: async () => "ready" as const }
const validPasswordHash = "a".repeat(64)

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

describe("Private beta invite registry schema", () => {
  it("creates an idempotent registry that retains revoked usernames", async () => {
    // Given
    await runMigrations(database)
    await sql`delete from private_beta_invites where username = 'schema-user'`.execute(database)
    await sql`
      insert into private_beta_invites (username, password_hash, issued_at)
      values ('schema-user', ${validPasswordHash}, '2026-07-22T00:00:00.000Z')
    `.execute(database)

    // When
    await sql`
      update private_beta_invites
      set revoked_at = '2026-07-22T01:00:00.000Z'
      where username = 'schema-user'
    `.execute(database)
    await runMigrations(database)
    const result = await sql<{
      readonly revokedAt: Date | null
      readonly username: string
    }>`
      select username, revoked_at as "revokedAt"
      from private_beta_invites
      where username = 'schema-user'
    `.execute(database)

    // Then
    expect(result.rows).toEqual([
      { revokedAt: new Date("2026-07-22T01:00:00.000Z"), username: "schema-user" },
    ])
  })

  it("rejects usernames and password hashes outside the invite contract", async () => {
    // Given
    const issuedAt = new Date("2026-07-22T00:00:00.000Z")

    // When
    const invalidUsername = sql`
      insert into private_beta_invites (username, password_hash, issued_at)
      values ('invalid username', ${validPasswordHash}, ${issuedAt})
    `.execute(database)
    const invalidPasswordHash = sql`
      insert into private_beta_invites (username, password_hash, issued_at)
      values ('schema-user-invalid-hash', 'not-a-hash', ${issuedAt})
    `.execute(database)

    // Then
    await expect(invalidUsername).rejects.toMatchObject({
      constraint: "private_beta_invites_username_check",
    })
    await expect(invalidPasswordHash).rejects.toMatchObject({
      constraint: "private_beta_invites_password_hash_check",
    })
  })

  it("reports unavailable when the invite registry cannot be queried", async () => {
    // Given
    const probe = new PostgresReadinessProbe({
      auditIntegrityProbe: readyAuditIntegrityProbe,
      database,
    })
    await sql`drop table private_beta_invites`.execute(database)

    // When
    let status: "ready" | "unavailable"
    try {
      status = await probe.check()
    } finally {
      await runMigrations(database)
    }

    // Then
    expect(status).toBe("unavailable")
  })
})
