import { createHash, generateKeyPairSync, sign } from "node:crypto"
import type { FastifyInstance } from "fastify"
import { vi } from "vitest"
import { createApp } from "../../src/http/app.js"
import { InstalledAppIdSchema, type StoredTokens } from "../../src/oauth/contracts.js"
import { OAuthService } from "../../src/oauth/oauth-service.js"
import { allowAllGrowfulAbuseControl } from "./abuse-control.js"
import { FakeSmartThingsClient } from "./fake-smartthings-client.js"
import { MemoryOAuthStore } from "./memory-oauth-store.js"
import { publicOAuthAccess } from "./oauth-access.js"
import { readyProbe } from "./readiness.js"

export const webhookNow = new Date("2026-07-22T00:00:00.000Z")
export const requestDate = webhookNow.toUTCString()
export const webhookPath = "/smartthings/webhook"
const installedAppId = InstalledAppIdSchema.parse("webhook-installed-app")
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 })
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString()

export function storedTokens(): StoredTokens {
  return {
    accessToken: "webhook-access-token",
    expiresAt: new Date("2026-07-23T00:00:00.000Z"),
    installedAppId,
    lastRefreshedAt: null,
    refreshToken: "webhook-refresh-token",
    scopes: ["r:devices:$"],
    tokenType: "bearer",
  }
}

export function lifecycleEventBody(lifecycle: "DELETE" | "UPDATE", appId = "growful-app"): string {
  return JSON.stringify({
    eventData: {
      events: [
        {
          eventTime: webhookNow.toISOString(),
          eventType: "INSTALLED_APP_LIFECYCLE_EVENT",
          installedAppLifecycleEvent: {
            appId,
            delete: {},
            eventId: "delete-event",
            installedAppId,
            lifecycle,
            locationId: "growful-location",
          },
        },
      ],
      installedApp: { installedAppId, locationId: "growful-location" },
    },
    messageType: "EVENT",
  })
}

export function signedHeaders(
  body: string,
  date = requestDate,
  keyId = "/pl/useast2/growful-test",
) {
  const digest = `SHA256=${createHash("sha256").update(body).digest("base64")}`
  const signingString = `(request-target): post ${webhookPath}\ndigest: ${digest}\ndate: ${date}`
  const signature = sign("RSA-SHA256", Buffer.from(signingString), privateKey).toString("base64")
  return {
    authorization: `Signature keyId="${keyId}",signature="${signature}",headers="(request-target) digest date",algorithm="rsa-sha256"`,
    "content-type": "application/json",
    date,
    digest,
  }
}

export function createSmartThingsWebhookFixture(
  apps: FastifyInstance[],
  confirmationRequester = vi.fn(async (_url: URL) => {}),
) {
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    client: new FakeSmartThingsClient(),
    now: () => webhookNow,
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 120_000,
    store,
  })
  const keyProvider = vi.fn(async (_keyId: string) => publicKeyPem)
  const app = createApp({
    abuseControl: allowAllGrowfulAbuseControl,
    authorizationOrigin: "https://api.smartthings.test",
    oauthAccess: publicOAuthAccess,
    readinessProbe: readyProbe,
    redirectOrigin: "https://smartthings.growful.click",
    service,
    smartThingsConfirmationRequester: confirmationRequester,
    smartThingsAppId: "growful-app",
    smartThingsWebhookKeyProvider: keyProvider,
    webhookNow: () => webhookNow,
  })
  apps.push(app)
  return { app, confirmationRequester, keyProvider, store }
}
