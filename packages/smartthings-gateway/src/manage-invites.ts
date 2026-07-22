import { z } from "zod"
import {
  AuditOperatorIdSchema,
  AuditTicketIdSchema,
  hashAuditOperatorIdentity,
  hashAuditTicketIdentity,
} from "./audit/audit-event.js"
import {
  generatePrivateBetaInviteCredential,
  PrivateBetaUsernameSchema,
  parsePrivateBetaInvites,
} from "./private-beta/invite.js"
import { PostgresPrivateBetaInviteManager } from "./private-beta/invite-management.js"
import { createDatabase, runMigrations } from "./storage/database.js"

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  PRIVATE_BETA_INVITES_JSON: z.string().min(1).optional(),
})
const commandSchema = z.union([
  z.tuple([z.literal("list")]),
  z.tuple([
    z.literal("issue"),
    PrivateBetaUsernameSchema,
    AuditOperatorIdSchema,
    AuditTicketIdSchema,
  ]),
  z.tuple([
    z.literal("revoke"),
    PrivateBetaUsernameSchema,
    AuditOperatorIdSchema,
    AuditTicketIdSchema,
  ]),
])

async function main(): Promise<void> {
  const environment = environmentSchema.parse(process.env)
  const command = commandSchema.parse(process.argv.slice(2))
  const database = createDatabase(environment.DATABASE_URL)
  try {
    await runMigrations(database)
    const manager = new PostgresPrivateBetaInviteManager({
      configuredInvites:
        environment.PRIVATE_BETA_INVITES_JSON === undefined
          ? []
          : parsePrivateBetaInvites(environment.PRIVATE_BETA_INVITES_JSON),
      database,
    })
    switch (command[0]) {
      case "list": {
        console.log(JSON.stringify({ reviews: await manager.listReviews() }))
        return
      }
      case "issue": {
        const [, username, operatorId, ticketId] = command
        const credential = generatePrivateBetaInviteCredential()
        const changed = await manager.issue({
          actorIdHash: hashAuditOperatorIdentity({ operatorId }),
          passwordHash: credential.passwordHash,
          ticketHash: hashAuditTicketIdentity({ ticketId }),
          username,
        })
        console.log(
          JSON.stringify({
            action: "issue",
            changed,
            ...(changed ? { credentialSecret: credential.secret } : {}),
            username,
          }),
        )
        return
      }
      case "revoke": {
        const [, username, operatorId, ticketId] = command
        const result = await manager.revoke({
          actorIdHash: hashAuditOperatorIdentity({ operatorId }),
          ticketHash: hashAuditTicketIdentity({ ticketId }),
          username,
        })
        console.log(JSON.stringify({ action: "revoke", ...result, username }))
        return
      }
      default: {
        const unreachable: never = command
        return unreachable
      }
    }
  } finally {
    await database.destroy()
  }
}

// no-excuse-ok: catch — process boundary emits only the error class to avoid secret leakage.
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      errorName: error instanceof Error ? error.name : "UnknownError",
      event: "invite.management.failed",
    }),
  )
  process.exitCode = 1
})
