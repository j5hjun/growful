import { type ExecFileException, execFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { sql } from "kysely"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { hashAuditSubject } from "../src/audit/audit-event.js"
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
  encryptionKeyBase64: Buffer.alloc(32, 67).toString("base64"),
})
const operatorId = "privacy-operator@example.test"
const ticketId = "PRIVACY-4321"

type CliResult = {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
}

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

async function seedConnection() {
  const installedAppId = InstalledAppIdSchema.parse(`privacy-delete-${randomUUID()}`)
  const now = new Date("2026-07-22T00:00:00.000Z")
  await oauthStore.saveTokens({
    authorization: oauthAuthorization(["r:devices:*"]),
    grant: {
      accessToken: "privacy-delete-access-token",
      expiresInSeconds: 3_600,
      installedAppId,
      refreshToken: "privacy-delete-refresh-token",
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

function runCli(arguments_: readonly string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      "pnpm",
      ["exec", "tsx", "src/manage-privacy-deletion.ts", ...arguments_],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      },
      (error: ExecFileException | null, stdout, stderr) => {
        resolve({
          exitCode: typeof error?.code === "number" ? error.code : error === null ? 0 : 1,
          stderr,
          stdout,
        })
      },
    )
  })
}

describe("privacy deletion operator CLI", () => {
  it("deletes the primary connection and records hashed operator approval atomically", async () => {
    // Given
    const installedAppId = await seedConnection()
    const supportReference = hashAuditSubject(installedAppId)

    // When
    const result = await runCli(["delete", supportReference, operatorId, ticketId])

    // Then
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      action: "privacy.delete",
      affectedCount: 1,
      outcome: "succeeded",
      supportReference,
    })
    expect(result.stdout).not.toContain(installedAppId)
    expect(result.stdout).not.toContain(operatorId)
    expect(result.stdout).not.toContain(ticketId)
    await expect(
      database
        .selectFrom("smartThingsConnections")
        .select("installedAppId")
        .where("installedAppId", "=", installedAppId)
        .executeTakeFirst(),
    ).resolves.toBeUndefined()
    const event = await database
      .selectFrom("auditEvents")
      .selectAll()
      .where("action", "=", "privacy.delete")
      .where("subjectHash", "=", supportReference)
      .executeTakeFirstOrThrow()
    expect(event).toMatchObject({
      actorIdHash: createHash("sha256").update(operatorId).digest("hex"),
      affectedCount: 1,
      outcome: "succeeded",
      subjectHash: supportReference,
      ticketHash: createHash("sha256").update(ticketId).digest("hex"),
    })
    expect(JSON.stringify(event)).not.toContain(installedAppId)
    expect(JSON.stringify(event)).not.toContain(operatorId)
    expect(JSON.stringify(event)).not.toContain(ticketId)
  })

  it("records a failed request when no primary connection matches", async () => {
    // Given
    const supportReference = createHash("sha256").update(randomUUID()).digest("hex")

    // When
    const result = await runCli(["delete", supportReference, operatorId, ticketId])

    // Then
    expect(result.exitCode).toBe(2)
    expect(JSON.parse(result.stdout)).toEqual({
      action: "privacy.delete",
      affectedCount: 0,
      outcome: "failed",
      supportReference,
    })
    const event = await database
      .selectFrom("auditEvents")
      .select(["affectedCount", "outcome"])
      .where("action", "=", "privacy.delete")
      .where("subjectHash", "=", supportReference)
      .executeTakeFirstOrThrow()
    expect(event).toEqual({ affectedCount: 0, outcome: "failed" })
  })

  it("rolls back primary deletion when the operator audit cannot append", async () => {
    // Given
    const installedAppId = await seedConnection()
    const supportReference = hashAuditSubject(installedAppId)
    await sql`
      create or replace function reject_privacy_deletion_audit()
      returns trigger
      language plpgsql
      as $function$
      begin
        if new.action = 'privacy.delete' then
          raise exception 'privacy deletion audit rejected';
        end if;
        return new;
      end;
      $function$
    `.execute(database)
    await sql`
      create trigger privacy_deletion_audit_guard
      before insert on audit_events
      for each row execute function reject_privacy_deletion_audit()
    `.execute(database)

    // When
    const result = await runCli(["delete", supportReference, operatorId, ticketId])
    await sql`drop trigger privacy_deletion_audit_guard on audit_events`.execute(database)
    await sql`drop function reject_privacy_deletion_audit()`.execute(database)

    // Then
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stderr)).toEqual({
      errorName: "error",
      event: "privacy.deletion.failed",
    })
    expect(result.stderr).not.toContain(installedAppId)
    expect(result.stderr).not.toContain(operatorId)
    expect(result.stderr).not.toContain(ticketId)
    await expect(
      database
        .selectFrom("smartThingsConnections")
        .select("installedAppId")
        .where("installedAppId", "=", installedAppId)
        .executeTakeFirst(),
    ).resolves.toEqual({ installedAppId })
    await expect(
      database
        .selectFrom("auditEvents")
        .select("eventId")
        .where("action", "=", "privacy.delete")
        .where("subjectHash", "=", supportReference)
        .executeTakeFirst(),
    ).resolves.toBeUndefined()
  })

  it("rejects mutation of a recorded privacy deletion outcome", async () => {
    // Given
    const supportReference = createHash("sha256").update(randomUUID()).digest("hex")
    await runCli(["delete", supportReference, operatorId, ticketId])
    await expect(
      database
        .selectFrom("auditEvents")
        .select("outcome")
        .where("action", "=", "privacy.delete")
        .where("subjectHash", "=", supportReference)
        .executeTakeFirstOrThrow(),
    ).resolves.toEqual({ outcome: "failed" })

    // When
    const mutation = database
      .updateTable("auditEvents")
      .set({ outcome: "succeeded" })
      .where("action", "=", "privacy.delete")
      .where("subjectHash", "=", supportReference)
      .execute()

    // Then
    await expect(mutation).rejects.toThrow("audit_events is append-only")
  })
})
