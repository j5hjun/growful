import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { createDatabase, runMigrations } from "../src/storage/database.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const issueOutputSchema = z.object({
  action: z.literal("issue"),
  changed: z.literal(true),
  credentialSecret: z.string().min(43),
  username: z.string(),
})
const unchangedIssueOutputSchema = z.object({
  action: z.literal("issue"),
  changed: z.literal(false),
  username: z.string(),
})
const listOutputSchema = z.object({
  reviews: z.array(
    z.object({
      issuedAt: z.iso.datetime().nullable(),
      revokedAt: z.iso.datetime().nullable(),
      source: z.enum(["configured", "database"]),
      status: z.enum(["active", "revoked"]),
      username: z.string(),
    }),
  ),
})
const revokeOutputSchema = z.object({
  action: z.literal("revoke"),
  changed: z.literal(true),
  revokedConnections: z.int().nonnegative(),
  revokedStates: z.int().nonnegative(),
  username: z.string(),
})
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const execFileAsync = promisify(execFile)
const usernames = [
  "dynamic-invite-issue-user",
  "dynamic-invite-repeat-user",
  "dynamic-invite-list-user",
  "dynamic-invite-revoke-user",
  "configured-invite-revoke-user",
] as const

beforeAll(async () => {
  await runMigrations(database)
})

beforeEach(async () => {
  await database.deleteFrom("privateBetaInvites").where("username", "in", usernames).execute()
})

afterAll(async () => {
  await database.deleteFrom("privateBetaInvites").where("username", "in", usernames).execute()
  await database.destroy()
})

async function runCli(arguments_: readonly string[], environment: NodeJS.ProcessEnv = {}) {
  return execFileAsync("pnpm", ["exec", "tsx", "src/manage-invites.ts", ...arguments_], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...environment, DATABASE_URL: TEST_DATABASE_URL },
  })
}

describe("Private beta invite operator CLI", () => {
  it("issues a capability credential once", async () => {
    // Given
    const username = usernames[0]
    const operatorId = "operator@example.test"
    const ticketId = "BETA-1001"

    // When
    const result = await runCli(["issue", username, operatorId, ticketId])

    // Then
    const output = issueOutputSchema.parse(JSON.parse(result.stdout))
    expect(output.username).toBe(username)
    expect(result.stdout).not.toContain(operatorId)
    expect(result.stdout).not.toContain(ticketId)
  })

  it("does not replace or reveal the secret for an active invitation", async () => {
    // Given
    const username = usernames[1]
    await runCli(["issue", username, "operator@example.test", "BETA-1002"])

    // When
    const result = await runCli(["issue", username, "operator@example.test", "BETA-1003"])

    // Then
    expect(unchangedIssueOutputSchema.parse(JSON.parse(result.stdout))).toEqual({
      action: "issue",
      changed: false,
      username,
    })
    expect(result.stdout).not.toContain("credentialSecret")
  })

  it("lists invitation status without credential material", async () => {
    // Given
    const username = usernames[2]
    await runCli(["issue", username, "operator@example.test", "BETA-1004"])

    // When
    const result = await runCli(["list"])

    // Then
    const output = listOutputSchema.parse(JSON.parse(result.stdout))
    expect(output.reviews).toContainEqual({
      issuedAt: expect.any(String),
      revokedAt: null,
      source: "database",
      status: "active",
      username,
    })
    expect(result.stdout).not.toContain("passwordHash")
    expect(result.stdout).not.toContain("credentialSecret")
  })

  it("revokes an active invitation with an operator audit", async () => {
    // Given
    const username = usernames[3]
    await runCli(["issue", username, "operator@example.test", "BETA-1005"])

    // When
    const result = await runCli(["revoke", username, "operator@example.test", "BETA-1006"])

    // Then
    expect(revokeOutputSchema.parse(JSON.parse(result.stdout))).toEqual({
      action: "revoke",
      changed: true,
      revokedConnections: 0,
      revokedStates: 0,
      username,
    })
    const stored = await database
      .selectFrom("privateBetaInvites")
      .select("revokedAt")
      .where("username", "=", username)
      .executeTakeFirstOrThrow()
    expect(stored.revokedAt).toBeInstanceOf(Date)
  })

  it("records a revoked tombstone over a configured invitation", async () => {
    // Given
    const username = usernames[4]
    const configuredInvites = JSON.stringify([
      {
        passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
        username,
      },
    ])

    // When
    const result = await runCli(["revoke", username, "operator@example.test", "BETA-1007"], {
      PRIVATE_BETA_INVITES_JSON: configuredInvites,
    })

    // Then
    expect(revokeOutputSchema.parse(JSON.parse(result.stdout))).toEqual({
      action: "revoke",
      changed: true,
      revokedConnections: 0,
      revokedStates: 0,
      username,
    })
    const stored = await database
      .selectFrom("privateBetaInvites")
      .select(["passwordHash", "revokedAt"])
      .where("username", "=", username)
      .executeTakeFirstOrThrow()
    expect(stored.passwordHash).toBe(
      "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
    )
    expect(stored.revokedAt).toBeInstanceOf(Date)
  })
})
