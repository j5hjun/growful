import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  AuditOperatorIdSchema,
  AuditTicketIdSchema,
  hashAuditOperatorIdentity,
  hashAuditTicketIdentity,
} from "../src/audit/audit-event.js"
import {
  generatePrivateBetaInviteCredential,
  hashPrivateBetaCredentialSecret,
} from "../src/private-beta/invite.js"
import { PostgresPrivateBetaInviteAccess } from "../src/private-beta/invite-access.js"
import { PostgresPrivateBetaInviteManager } from "../src/private-beta/invite-management.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const usernames = ["database-access-user", "configured-access-user"] as const
const actorIdHash = hashAuditOperatorIdentity({
  operatorId: AuditOperatorIdSchema.parse(randomUUID()),
})

function ticketHash(): ReturnType<typeof hashAuditTicketIdentity> {
  return hashAuditTicketIdentity({ ticketId: AuditTicketIdSchema.parse(randomUUID()) })
}

function basicAuthorization(username: string, credentialSecret: string): string {
  return `Basic ${Buffer.from(`${username}:${credentialSecret}`).toString("base64")}`
}

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

describe("PostgreSQL private beta invitation access", () => {
  it("stops authenticating a database invitation after revocation", async () => {
    // Given
    const username = usernames[0]
    const credential = generatePrivateBetaInviteCredential()
    const manager = new PostgresPrivateBetaInviteManager({ configuredInvites: [], database })
    const access = new PostgresPrivateBetaInviteAccess({ configuredInvites: [], database })
    await manager.issue({
      actorIdHash,
      passwordHash: credential.passwordHash,
      ticketHash: ticketHash(),
      username,
    })
    const authorization = basicAuthorization(username, credential.secret)
    await expect(access.authenticate(authorization)).resolves.toEqual({
      generation: expect.any(String),
      username,
    })

    // When
    await manager.revoke({
      actorIdHash,
      ticketHash: ticketHash(),
      username,
    })

    // Then
    await expect(access.authenticate(authorization)).resolves.toBeNull()
    await expect(access.isUsernameActive(username)).resolves.toBe(false)
  })

  it("lets a revoked database tombstone override a configured invitation", async () => {
    // Given
    const username = usernames[1]
    const credentialSecret = "configured-private-beta-secret"
    const configuredInvites = [
      { passwordHash: hashPrivateBetaCredentialSecret(credentialSecret), username },
    ]
    const manager = new PostgresPrivateBetaInviteManager({ configuredInvites, database })
    const access = new PostgresPrivateBetaInviteAccess({ configuredInvites, database })
    const authorization = basicAuthorization(username, credentialSecret)
    await expect(access.authenticate(authorization)).resolves.toEqual({
      generation: expect.any(String),
      username,
    })

    // When
    await manager.revoke({
      actorIdHash,
      ticketHash: ticketHash(),
      username,
    })

    // Then
    await expect(access.authenticate(authorization)).resolves.toBeNull()
    expect((await access.listActiveInvites()).map((invite) => invite.username)).not.toContain(
      username,
    )
  })
})
