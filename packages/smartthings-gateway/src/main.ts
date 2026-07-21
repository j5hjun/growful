import { loadConfig } from "./config.js"
import { createApp } from "./http/app.js"
import { SmartThingsProxy } from "./http/smartthings-proxy.js"
import { registerSmartThingsProxy } from "./http/smartthings-proxy-route.js"
import { OAuthService } from "./oauth/oauth-service.js"
import { startRefreshWorker } from "./oauth/refresh-worker.js"
import { startGatewayRuntime } from "./runtime.js"
import { HttpSmartThingsClient } from "./smartthings/smartthings-client.js"
import { createDatabase, runMigrations } from "./storage/database.js"
import { PostgresOAuthStore } from "./storage/postgres-oauth-store.js"

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const database = createDatabase(config.databaseUrl)
  let runtimeOwnsDatabase = false
  try {
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
      tokenUrl: config.tokenUrl,
    })
    const service = new OAuthService({
      accessPolicy: {
        policyVersion: config.serviceAccess.policyVersion,
        privateBetaUsernames:
          config.serviceAccess.mode === "private_beta"
            ? config.serviceAccess.invites.map((invite) => invite.username)
            : null,
      },
      client,
      refreshBeforeExpiryMs: config.refreshBeforeExpiryMs,
      refreshLeaseMs: config.refreshLeaseMs,
      store,
    })
    await service.revokeUnauthorizedConnections()
    const app = createApp({
      authorizationOrigin: config.authorizationUrl.origin,
      logger: {
        level: config.logLevel,
        redact: ["req.headers.authorization", "req.headers.cookie"],
      },
      oauthAccess: config.serviceAccess,
      redirectOrigin: config.redirectUri.origin,
      service,
      smartThingsAppId: config.smartThingsAppId,
    })
    registerSmartThingsProxy(app, {
      proxy: new SmartThingsProxy({
        apiBaseUrl: config.apiBaseUrl,
        service,
        timeoutMs: config.apiTimeoutMs,
      }),
      service,
    })
    runtimeOwnsDatabase = true
    await startGatewayRuntime({
      app,
      database,
      host: config.host,
      port: config.port,
      startWorker: () =>
        startRefreshWorker({
          intervalMs: config.refreshCheckIntervalMs,
          logger: app.log,
          service,
        }),
    })
  } finally {
    if (!runtimeOwnsDatabase) {
      await database.destroy()
    }
  }
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
