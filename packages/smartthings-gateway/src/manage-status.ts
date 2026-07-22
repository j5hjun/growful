import { z } from "zod"
import {
  AuditOperatorIdSchema,
  AuditTicketIdSchema,
  hashAuditOperatorIdentity,
  hashAuditTicketIdentity,
} from "./audit/audit-event.js"
import { PostgresServiceStatusManager } from "./status/postgres-service-status.js"
import {
  ServiceIncidentIdSchema,
  ServiceIncidentImpactSchema,
  ServiceIncidentMessageSchema,
  ServiceIncidentTitleSchema,
} from "./status/service-status.js"
import { createDatabase, runMigrations } from "./storage/database.js"

const environmentSchema = z.object({ DATABASE_URL: z.url() })
const activeIncidentStatusSchema = z.enum(["investigating", "monitoring"])
const commandSchema = z.union([
  z.tuple([z.literal("list")]),
  z.tuple([
    z.literal("open"),
    ServiceIncidentImpactSchema,
    ServiceIncidentTitleSchema,
    ServiceIncidentMessageSchema,
    AuditOperatorIdSchema,
    AuditTicketIdSchema,
  ]),
  z.tuple([
    z.literal("update"),
    ServiceIncidentIdSchema,
    activeIncidentStatusSchema,
    ServiceIncidentMessageSchema,
    AuditOperatorIdSchema,
    AuditTicketIdSchema,
  ]),
  z.tuple([
    z.literal("resolve"),
    ServiceIncidentIdSchema,
    ServiceIncidentMessageSchema,
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
    const manager = new PostgresServiceStatusManager(database)
    switch (command[0]) {
      case "list": {
        console.log(JSON.stringify({ incidents: await manager.listPublicIncidents() }))
        return
      }
      case "open": {
        const [, impact, title, message, operatorId, ticketId] = command
        const incidentId = await manager.open({
          actorIdHash: hashAuditOperatorIdentity({ operatorId }),
          impact,
          message,
          ticketHash: hashAuditTicketIdentity({ ticketId }),
          title,
        })
        console.log(JSON.stringify({ action: "open", incidentId }))
        return
      }
      case "update": {
        const [, incidentId, status, message, operatorId, ticketId] = command
        const changed = await manager.update({
          actorIdHash: hashAuditOperatorIdentity({ operatorId }),
          incidentId,
          message,
          status,
          ticketHash: hashAuditTicketIdentity({ ticketId }),
        })
        console.log(JSON.stringify({ action: "update", changed, incidentId }))
        return
      }
      case "resolve": {
        const [, incidentId, message, operatorId, ticketId] = command
        const changed = await manager.resolve({
          actorIdHash: hashAuditOperatorIdentity({ operatorId }),
          incidentId,
          message,
          ticketHash: hashAuditTicketIdentity({ ticketId }),
        })
        console.log(JSON.stringify({ action: "resolve", changed, incidentId }))
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
      event: "status.management.failed",
    }),
  )
  process.exitCode = 1
})
