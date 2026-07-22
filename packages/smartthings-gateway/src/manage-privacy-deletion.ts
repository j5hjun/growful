import { z } from "zod"
import { AuditEventHashSchema, hashAuditValue } from "./audit/audit-event.js"
import { PostgresPrivacyDeletion } from "./privacy/postgres-privacy-deletion.js"
import { createDatabase, runMigrations } from "./storage/database.js"

const environmentSchema = z.object({ DATABASE_URL: z.url() })
const operatorIdentitySchema = z.string().trim().min(1).max(200)
const ticketIdentitySchema = z.string().trim().min(1).max(200)
const commandSchema = z.tuple([
  z.literal("delete"),
  AuditEventHashSchema,
  operatorIdentitySchema,
  ticketIdentitySchema,
])

async function main(): Promise<void> {
  const environment = environmentSchema.parse(process.env)
  const command = commandSchema.parse(process.argv.slice(2))
  const database = createDatabase(environment.DATABASE_URL)
  try {
    await runMigrations(database)
    const privacyDeletion = new PostgresPrivacyDeletion({ database })
    const [, supportReference, operatorId, ticketId] = command
    const result = await privacyDeletion.delete({
      actorIdHash: hashAuditValue(operatorId),
      supportReference,
      ticketHash: hashAuditValue(ticketId),
    })
    console.log(JSON.stringify({ action: "privacy.delete", ...result, supportReference }))
    switch (result.outcome) {
      case "failed": {
        process.exitCode = 2
        return
      }
      case "succeeded": {
        return
      }
      default: {
        const unreachable: never = result
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
      event: "privacy.deletion.failed",
    }),
  )
  process.exitCode = 1
})
