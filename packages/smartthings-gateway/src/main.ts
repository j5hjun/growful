import { loadConfig } from "./config.js"
import { createApp } from "./http/app.js"
import { OAuthService } from "./oauth/oauth-service.js"
import { startRefreshWorker } from "./oauth/refresh-worker.js"
import { HttpSmartThingsClient } from "./smartthings/smartthings-client.js"
import { createDatabase, runMigrations } from "./storage/database.js"
import { PostgresOAuthStore } from "./storage/postgres-oauth-store.js"

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const database = createDatabase(config.databaseUrl)
  await runMigrations(database)
  const store = new PostgresOAuthStore({
    database,
    encryptionKeyBase64: config.encryptionKeyBase64,
  })
  const client = new HttpSmartThingsClient({
    authorizationUrl: config.authorizationUrl,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    tokenUrl: config.tokenUrl,
  })
  const service = new OAuthService({
    client,
    refreshBeforeExpiryMs: config.refreshBeforeExpiryMs,
    refreshLeaseMs: config.refreshLeaseMs,
    store,
  })
  const app = createApp({
    adminToken: config.adminToken,
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    service,
  })
  const stopRefreshWorker = startRefreshWorker({
    intervalMs: config.refreshCheckIntervalMs,
    logger: app.log,
    service,
  })
  await app.listen({ host: config.host, port: config.port })

  let shuttingDown = false
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    app.log.info({ signal }, "server.stopping")
    await stopRefreshWorker()
    await app.close()
    await database.destroy()
  }
  process.once("SIGINT", (signal) => void shutdown(signal))
  process.once("SIGTERM", (signal) => void shutdown(signal))
}

// no-excuse-ok: catch — process boundary emits only the error class to avoid secret leakage.
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: "server.startup.failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    }),
  )
  process.exitCode = 1
})
