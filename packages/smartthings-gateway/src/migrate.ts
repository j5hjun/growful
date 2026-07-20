import { loadConfig } from "./config.js"
import { createDatabase, runMigrations } from "./storage/database.js"

async function migrate(): Promise<void> {
  const config = loadConfig(process.env)
  const database = createDatabase(config.databaseUrl)
  try {
    await runMigrations(database)
  } finally {
    await database.destroy()
  }
}

// no-excuse-ok: catch — process boundary emits only the error class to avoid secret leakage.
migrate().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "database.migration.failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  )
  process.exitCode = 1
})
