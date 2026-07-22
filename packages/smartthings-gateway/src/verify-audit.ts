import { z } from "zod"
import { verifyPostgresAuditIntegrity } from "./audit/postgres-audit-integrity.js"
import { createDatabase } from "./storage/database.js"

const environmentSchema = z.object({ DATABASE_URL: z.url() })

async function verifyAudit(): Promise<void> {
  const environment = environmentSchema.parse(process.env)
  const database = createDatabase(environment.DATABASE_URL)
  try {
    let result = await verifyPostgresAuditIntegrity(database)
    while (result.status === "in_progress") {
      result = await verifyPostgresAuditIntegrity(database, result.checkpoint)
    }
    console.log(JSON.stringify(result))
    if (result.status === "invalid") {
      process.exitCode = 1
    }
  } finally {
    await database.destroy()
  }
}

// no-excuse-ok: catch — process boundary emits only the error class to avoid data leakage.
verifyAudit().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      errorName: error instanceof Error ? error.name : "UnknownError",
      status: "error",
    }),
  )
  process.exitCode = 1
})
