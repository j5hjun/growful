import { loadConfig } from "./config.js"
import { createDatabase, revokeCredentialsForLegacyRollback } from "./storage/database.js"

async function prepareRollback(): Promise<void> {
  const config = loadConfig(process.env)
  const database = createDatabase(config.databaseUrl)
  try {
    await revokeCredentialsForLegacyRollback(database)
  } finally {
    await database.destroy()
  }
}

// no-excuse-ok: catch — process boundary emits only the error class to avoid secret leakage.
prepareRollback().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "database.rollback-preparation.failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  )
  process.exitCode = 1
})
