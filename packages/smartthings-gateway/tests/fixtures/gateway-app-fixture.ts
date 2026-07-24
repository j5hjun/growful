import type { FastifyInstance } from "fastify"
import type { GrowfulAbuseControl } from "../../src/abuse/abuse-control.js"
import { type AppOptions, createApp } from "../../src/http/app.js"
import type { GrowfulRequestQuota } from "../../src/http/growful-request-quota.js"
import { OAuthService } from "../../src/oauth/oauth-service.js"
import { GrowfulTokenSchema } from "../../src/security/growful-token.js"
import { allowAllGrowfulAbuseControl } from "./abuse-control.js"
import { FakeSmartThingsClient } from "./fake-smartthings-client.js"
import { MemoryOAuthStore } from "./memory-oauth-store.js"
import { publicOAuthAccess } from "./oauth-access.js"
import { readyProbe } from "./readiness.js"

export const gatewayRedirectOrigin = "https://smartthings.growful.click"

export type GatewayAppFixtureOptions = {
  readonly abuseControl?: GrowfulAbuseControl
  readonly apps: FastifyInstance[]
  readonly logger?: AppOptions["logger"]
  readonly oauthAccess?: AppOptions["oauthAccess"]
  readonly readinessProbe?: AppOptions["readinessProbe"]
  readonly requestQuota?: GrowfulRequestQuota
  readonly serviceStatusSource?: AppOptions["serviceStatusSource"]
}

export function testGrowfulToken(index: number) {
  return GrowfulTokenSchema.parse(`grw_st_${Buffer.alloc(32, index).toString("base64url")}`)
}

export function createGatewayAppFixture(options: GatewayAppFixtureOptions) {
  const client = new FakeSmartThingsClient()
  client.exchangeGrant = {
    ...client.exchangeGrant,
    scopes: ["r:devices:$", "x:devices:$", "r:locations:*"],
  }
  const store = new MemoryOAuthStore()
  let tokenIndex = 1
  const service = new OAuthService({
    client,
    growfulTokenGenerator: () => {
      const token = testGrowfulToken(tokenIndex)
      tokenIndex += 1
      return token
    },
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  const app = createApp({
    abuseControl: options.abuseControl ?? allowAllGrowfulAbuseControl,
    authorizationOrigin: "https://api.smartthings.test",
    logger: options.logger,
    oauthAccess: options.oauthAccess ?? publicOAuthAccess,
    readinessProbe: options.readinessProbe ?? readyProbe,
    redirectOrigin: gatewayRedirectOrigin,
    ...(options.requestQuota === undefined ? {} : { requestQuota: options.requestQuota }),
    serviceStatusSource: options.serviceStatusSource ?? {
      listPublicIncidents: async () => [],
    },
    service,
    smartThingsAppId: "growful-app",
  })
  options.apps.push(app)
  return { app, client, store }
}

export async function authorizeGatewayApp(app: FastifyInstance) {
  const authorizationResponse = await app.inject({
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: gatewayRedirectOrigin,
    },
    method: "POST",
    payload:
      "deviceRange=selected&devicePermissions=read&devicePermissions=control&locationPermissions=read&policyConsent=accepted",
    url: "/oauth/start",
  })
  const state =
    new URL(authorizationResponse.headers.location ?? "").searchParams.get("state") ?? ""
  return app.inject({
    method: "GET",
    url: `/oauth/callback?code=authorization-code&state=${encodeURIComponent(state)}`,
  })
}
