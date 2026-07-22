import { PostgresGrowfulAbuseControl } from "./abuse/abuse-control.js"
import { AuditIntegrityMonitor } from "./audit/audit-integrity-monitor.js"
import { AuditedOAuthStore } from "./audit/audited-oauth-store.js"
import { verifyPostgresAuditIntegrity } from "./audit/postgres-audit-integrity.js"
import { PostgresAuditSink } from "./audit/postgres-audit-sink.js"
import { loadConfig } from "./config.js"
import { PostgresReadinessProbe } from "./health/postgres-readiness.js"
import { createApp } from "./http/app.js"
import {
  GrowfulRequestQuota,
  PostgresGrowfulRequestQuotaStore,
} from "./http/growful-request-quota.js"
import { SmartThingsProxy } from "./http/smartthings-proxy.js"
import { registerSmartThingsProxy } from "./http/smartthings-proxy-route.js"
import {
  PostgresSmartThingsRateLimitBackoffStore,
  SmartThingsRateLimitBackoff,
} from "./http/smartthings-rate-limit-backoff.js"
import { OAuthService } from "./oauth/oauth-service.js"
import { startRefreshWorker } from "./oauth/refresh-worker.js"
import { PostgresPrivateBetaInviteAccess } from "./private-beta/invite-access.js"
import { startGatewayRuntime } from "./runtime.js"
import { HttpSmartThingsClient } from "./smartthings/smartthings-client.js"
import { PostgresServiceStatusManager } from "./status/postgres-service-status.js"
import { createDatabase, runMigrations } from "./storage/database.js"
import { PostgresOAuthStore } from "./storage/postgres-oauth-store.js"

async function main(): Promise<void> {
  const config = loadConfig(process.env)
  const database = createDatabase(config.databaseUrl, {
    onIdleClientError(error) {
      console.error(
        JSON.stringify({
          event: "database.idle_client.failed",
          errorName: error.name,
        }),
      )
    },
  })
  let runtimeOwnsDatabase = false
  try {
    await runMigrations(database)
    const store = new AuditedOAuthStore({
      auditSink: new PostgresAuditSink({ database }),
      store: new PostgresOAuthStore({
        configuredPrivateBetaInvites:
          config.serviceAccess.mode === "private_beta" ? config.serviceAccess.invites : [],
        database,
        encryptionKeyBase64: config.encryptionKeyBase64,
      }),
    })
    const client = new HttpSmartThingsClient({
      authorizationUrl: config.authorizationUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      tokenUrl: config.tokenUrl,
    })
    const runtimeAccess =
      config.serviceAccess.mode === "private_beta"
        ? (() => {
            const inviteAccess = new PostgresPrivateBetaInviteAccess({
              configuredInvites: config.serviceAccess.invites,
              database,
            })
            return {
              oauthAccess: {
                inviteAccess,
                mode: config.serviceAccess.mode,
                operatorName: config.serviceAccess.operatorName,
                policyVersion: config.serviceAccess.policyVersion,
                privacyPolicyUrl: config.serviceAccess.privacyPolicyUrl,
                supportEmail: config.serviceAccess.supportEmail,
                termsUrl: config.serviceAccess.termsUrl,
              },
              privateBetaAccess: inviteAccess,
            }
          })()
        : { oauthAccess: config.serviceAccess, privateBetaAccess: null }
    const service = new OAuthService({
      accessPolicy: {
        policyVersion: config.serviceAccess.policyVersion,
        privateBetaAccess: runtimeAccess.privateBetaAccess,
      },
      client,
      refreshBeforeExpiryMs: config.refreshBeforeExpiryMs,
      refreshLeaseMs: config.refreshLeaseMs,
      store,
    })
    await service.revokeUnauthorizedConnections()
    const abuseControl = new PostgresGrowfulAbuseControl({ database })
    const auditIntegrityMonitor = new AuditIntegrityMonitor(() =>
      verifyPostgresAuditIntegrity(database),
    )
    const app = createApp({
      abuseControl,
      authorizationOrigin: config.authorizationUrl.origin,
      logger: {
        level: config.logLevel,
        redact: ["req.headers.authorization", "req.headers.cookie"],
      },
      oauthAccess: runtimeAccess.oauthAccess,
      readinessProbe: new PostgresReadinessProbe({
        auditIntegrityProbe: auditIntegrityMonitor,
        database,
      }),
      redirectOrigin: config.redirectUri.origin,
      serviceStatusSource: new PostgresServiceStatusManager(database),
      service,
      smartThingsAppId: config.smartThingsAppId,
    })
    registerSmartThingsProxy(app, {
      abuseControl,
      proxy: new SmartThingsProxy({
        apiBaseUrl: config.apiBaseUrl,
        service,
        timeoutMs: config.apiTimeoutMs,
      }),
      rateLimitBackoff: new SmartThingsRateLimitBackoff({
        store: new PostgresSmartThingsRateLimitBackoffStore({ database }),
      }),
      requestQuota: new GrowfulRequestQuota({
        store: new PostgresGrowfulRequestQuotaStore({ database }),
      }),
      service,
    })
    await auditIntegrityMonitor.refresh(app.log)
    const stopAuditIntegrityMonitor = auditIntegrityMonitor.start({
      intervalMs: config.refreshCheckIntervalMs,
      logger: app.log,
    })
    app.addHook("onClose", async () => {
      await stopAuditIntegrityMonitor()
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
