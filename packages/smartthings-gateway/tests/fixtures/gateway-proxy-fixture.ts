import type { FastifyInstance } from "fastify"
import type { GrowfulAbuseControl } from "../../src/abuse/abuse-control.js"
import type { AuditSink } from "../../src/audit/audit-event.js"
import { AuditedOAuthStore } from "../../src/audit/audited-oauth-store.js"
import { createApp } from "../../src/http/app.js"
import { GrowfulRequestQuota } from "../../src/http/growful-request-quota.js"
import { SmartThingsProxy } from "../../src/http/smartthings-proxy.js"
import { registerSmartThingsProxy } from "../../src/http/smartthings-proxy-route.js"
import {
  SmartThingsRateLimitBackoff,
  type SmartThingsRateLimitBackoffStore,
} from "../../src/http/smartthings-rate-limit-backoff.js"
import { OAuthService } from "../../src/oauth/oauth-service.js"
import { emptyServiceStatusSource } from "../../src/status/service-status.js"
import { allowAllGrowfulAbuseControl } from "./abuse-control.js"
import type { FakeSmartThingsApi } from "./fake-smartthings-api.js"
import { FakeSmartThingsClient } from "./fake-smartthings-client.js"
import { MemoryOAuthStore, memoryStoreGrowfulToken } from "./memory-oauth-store.js"
import { publicOAuthAccess } from "./oauth-access.js"
import { readyProbe } from "./readiness.js"

export const gatewayAuthorization = `Bearer ${memoryStoreGrowfulToken}`
export const now = new Date("2026-07-19T00:00:00.000Z")

export type GatewayProxyFixtureOptions = {
  readonly abuseControl?: GrowfulAbuseControl
  readonly api: FakeSmartThingsApi
  readonly apps: FastifyInstance[]
  readonly auditSink?: AuditSink
  readonly maxResponseBytes?: number
  readonly rateLimitStore?: SmartThingsRateLimitBackoffStore
  readonly requestQuota?: GrowfulRequestQuota
  readonly timeoutMs?: number
}

export function createGatewayProxyFixture(options: GatewayProxyFixtureOptions) {
  const client = new FakeSmartThingsClient()
  const rawStore = new MemoryOAuthStore()
  rawStore.seedTokens({
    accessToken: "stored-smartthings-access-token",
    expiresAt: new Date("2026-07-20T00:00:00.000Z"),
    installedAppId: client.exchangeGrant.installedAppId,
    lastRefreshedAt: null,
    refreshToken: "stored-smartthings-refresh-token",
    scopes: ["r:devices:*"],
    tokenType: "bearer",
  })
  const store =
    options.auditSink === undefined
      ? rawStore
      : new AuditedOAuthStore({ auditSink: options.auditSink, store: rawStore })
  client.refreshGrant = { ...client.refreshGrant, scopes: ["r:devices:*"] }
  const service = new OAuthService({
    client,
    now: () => now,
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    store,
  })
  const proxyOptions = {
    apiBaseUrl: options.api.baseUrl,
    service,
    timeoutMs: options.timeoutMs ?? 1_000,
  }
  const proxy = new SmartThingsProxy(
    options.maxResponseBytes === undefined
      ? proxyOptions
      : { ...proxyOptions, maxResponseBytes: options.maxResponseBytes },
  )
  const requestQuota = options.requestQuota ?? new GrowfulRequestQuota()
  const app = createApp({
    abuseControl: options.abuseControl ?? allowAllGrowfulAbuseControl,
    authorizationOrigin: "https://api.smartthings.test",
    oauthAccess: publicOAuthAccess,
    readinessProbe: readyProbe,
    redirectOrigin: "https://smartthings.growful.click",
    requestQuota,
    serviceStatusSource: emptyServiceStatusSource,
    service,
    smartThingsAppId: "growful-app",
  })
  const rateLimitBackoff =
    options.rateLimitStore === undefined
      ? new SmartThingsRateLimitBackoff()
      : new SmartThingsRateLimitBackoff({ store: options.rateLimitStore })
  registerSmartThingsProxy(app, {
    abuseControl: options.abuseControl ?? allowAllGrowfulAbuseControl,
    proxy,
    rateLimitBackoff,
    requestQuota,
    service,
  })
  options.apps.push(app)
  return { app, client, store: rawStore }
}
