import type { FastifyInstance } from "fastify"
import { createApp } from "../../src/http/app.js"
import { SmartThingsProxy } from "../../src/http/smartthings-proxy.js"
import { registerSmartThingsProxy } from "../../src/http/smartthings-proxy-route.js"
import { OAuthService } from "../../src/oauth/oauth-service.js"
import type { FakeSmartThingsApi } from "./fake-smartthings-api.js"
import { FakeSmartThingsClient } from "./fake-smartthings-client.js"
import { MemoryOAuthStore, memoryStoreGrowfulToken } from "./memory-oauth-store.js"
import { publicOAuthAccess } from "./oauth-access.js"

export const gatewayAuthorization = `Bearer ${memoryStoreGrowfulToken}`
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
    scopes: ["r:devices:*"],
    tokenType: "bearer",
  })
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
  const app = createApp({
    authorizationOrigin: "https://api.smartthings.test",
    oauthAccess: publicOAuthAccess,
    redirectOrigin: "https://smartthings.growful.click",
    service,
    smartThingsAppId: "growful-app",
  })
  registerSmartThingsProxy(app, { proxy, service })
  options.apps.push(app)
  return { app, client, store }
}
