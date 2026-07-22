import { z } from "zod"
import { hashAuditValue } from "./audit/audit-event.js"
import { PostgresServiceStatusManager } from "./status/postgres-service-status.js"
import {
  ServiceIncidentIdSchema,
  ServiceIncidentImpactSchema,
  ServiceIncidentMessageSchema,
  ServiceIncidentTitleSchema,
} from "./status/service-status.js"
import { createDatabase, runMigrations } from "./storage/database.js"

const environmentSchema = z.object({ DATABASE_URL: z.url() })
const operatorIdentitySchema = z.string().trim().min(1).max(200)
const ticketIdentitySchema = z.string().trim().min(1).max(200)
const activeIncidentStatusSchema = z.enum(["investigating", "monitoring"])
const commandSchema = z.union([
  z.tuple([z.literal("list")]),
  z.tuple([
    z.literal("open"),
    ServiceIncidentImpactSchema,
    ServiceIncidentTitleSchema,
    ServiceIncidentMessageSchema,
    operatorIdentitySchema,
    ticketIdentitySchema,
  ]),
  z.tuple([
    z.literal("update"),
    ServiceIncidentIdSchema,
    activeIncidentStatusSchema,
    ServiceIncidentMessageSchema,
    operatorIdentitySchema,
    ticketIdentitySchema,
  ]),
  z.tuple([
    z.literal("resolve"),
    ServiceIncidentIdSchema,
    ServiceIncidentMessageSchema,
    operatorIdentitySchema,
    ticketIdentitySchema,
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
          actorIdHash: hashAuditValue(operatorId),
          impact,
          message,
          ticketHash: hashAuditValue(ticketId),
          title,
        })
        console.log(JSON.stringify({ action: "open", incidentId }))
        return
      }
      case "update": {
        const [, incidentId, status, message, operatorId, ticketId] = command
        const changed = await manager.update({
          actorIdHash: hashAuditValue(operatorId),
          incidentId,
          message,
          status,
          ticketHash: hashAuditValue(ticketId),
        })
        console.log(JSON.stringify({ action: "update", changed, incidentId }))
        return
      }
      case "resolve": {
        const [, incidentId, message, operatorId, ticketId] = command
        const changed = await manager.resolve({
          actorIdHash: hashAuditValue(operatorId),
          incidentId,
          message,
          ticketHash: hashAuditValue(ticketId),
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
