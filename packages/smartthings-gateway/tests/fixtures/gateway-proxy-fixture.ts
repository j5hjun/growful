import type { FastifyInstance } from "fastify"
import { createApp, registerSmartThingsProxy } from "../../src/http/app.js"
import { SmartThingsProxy } from "../../src/http/smartthings-proxy.js"
import { OAuthService } from "../../src/oauth/oauth-service.js"
import type { FakeSmartThingsApi } from "./fake-smartthings-api.js"
import { FakeSmartThingsClient } from "./fake-smartthings-client.js"
import { MemoryOAuthStore } from "./memory-oauth-store.js"

const adminToken = "test-admin-token-with-32-characters"
export const gatewayApiToken = "test-gateway-api-token-with-32-characters"
export const gatewayAuthorization = `Bearer ${gatewayApiToken}`
export const now = new Date("2026-07-19T00:00:00.000Z")

export type GatewayProxyFixtureOptions = {
  readonly api: FakeSmartThingsApi
  readonly apps: FastifyInstance[]
  readonly maxResponseBytes?: number
  readonly timeoutMs?: number
}

export function createGatewayProxyFixture(options: GatewayProxyFixtureOptions) {
  const client = new FakeSmartThingsClient()
  const store = new MemoryOAuthStore()
  store.seedTokens({
    accessToken: "stored-smartthings-access-token",
    expiresAt: new Date("2026-07-20T00:00:00.000Z"),
    installedAppId: client.exchangeGrant.installedAppId,
    lastRefreshedAt: null,
    refreshToken: "stored-smartthings-refresh-token",
    scope: "r:devices:*",
    tokenType: "bearer",
  })
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
  const app = createApp({ adminToken, service })
  registerSmartThingsProxy(app, { gatewayApiToken, proxy })
  options.apps.push(app)
  return { app, client, store }
}
