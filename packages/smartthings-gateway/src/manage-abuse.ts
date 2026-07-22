import { z } from "zod"
import {
  GrowfulAbuseBlockReasonSchema,
  PostgresGrowfulAbuseControl,
} from "./abuse/abuse-control.js"
import {
  AuditEventHashSchema,
  AuditOperatorIdSchema,
  AuditTicketIdSchema,
  hashAuditOperatorIdentity,
  hashAuditTicketIdentity,
} from "./audit/audit-event.js"
import { createDatabase, runMigrations } from "./storage/database.js"

const environmentSchema = z.object({ DATABASE_URL: z.url() })
const commandSchema = z.union([
  z.tuple([z.literal("list")]),
  z.tuple([
    z.literal("block"),
    AuditEventHashSchema,
    GrowfulAbuseBlockReasonSchema,
    AuditOperatorIdSchema,
    AuditTicketIdSchema,
  ]),
  z.tuple([z.literal("unblock"), AuditEventHashSchema, AuditOperatorIdSchema, AuditTicketIdSchema]),
])

async function main(): Promise<void> {
  const environment = environmentSchema.parse(process.env)
  const command = commandSchema.parse(process.argv.slice(2))
  const database = createDatabase(environment.DATABASE_URL)
  try {
    await runMigrations(database)
    const abuseControl = new PostgresGrowfulAbuseControl({ database })
    switch (command[0]) {
      case "list": {
        console.log(JSON.stringify({ reviews: await abuseControl.listReviews() }))
        return
      }
      case "block": {
        const [, supportReference, reason, operatorId, ticketId] = command
        const changed = await abuseControl.block({
          actorIdHash: hashAuditOperatorIdentity({ operatorId }),
          reason,
          supportReference,
          ticketHash: hashAuditTicketIdentity({ ticketId }),
        })
        console.log(JSON.stringify({ action: "block", changed, supportReference }))
        return
      }
      case "unblock": {
        const [, supportReference, operatorId, ticketId] = command
        const changed = await abuseControl.unblock({
          actorIdHash: hashAuditOperatorIdentity({ operatorId }),
          supportReference,
          ticketHash: hashAuditTicketIdentity({ ticketId }),
        })
        console.log(JSON.stringify({ action: "unblock", changed, supportReference }))
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
      event: "abuse.management.failed",
    }),
  )
  process.exitCode = 1
})
