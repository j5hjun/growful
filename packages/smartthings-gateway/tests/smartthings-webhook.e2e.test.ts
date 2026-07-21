import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../src/http/app.js"
import { InstalledAppIdSchema, type StoredTokens } from "../src/oauth/contracts.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const apps: ReturnType<typeof createApp>[] = []
const now = new Date("2026-07-22T00:00:00.000Z")
const requestDate = now.toUTCString()
const webhookPath = "/smartthings/webhook"
const installedAppId = InstalledAppIdSchema.parse("webhook-installed-app")
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 })
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString()

function storedTokens(): StoredTokens {
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

function lifecycleEventBody(lifecycle: "DELETE" | "UPDATE", appId = "growful-app"): string {
  return JSON.stringify({
    eventData: {
      events: [
        {
          eventTime: now.toISOString(),
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

function signedHeaders(body: string, date = requestDate, keyId = "/pl/useast2/growful-test") {
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

function createFixture() {
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    client: new FakeSmartThingsClient(),
    now: () => now,
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 120_000,
    store,
  })
  const confirmationRequester = vi.fn(async (_url: URL) => {})
  const keyProvider = vi.fn(async (_keyId: string) => publicKeyPem)
  const appOptions = {
    authorizationOrigin: "https://api.smartthings.test",
    oauthAccess: { mode: "public" as const },
    redirectOrigin: "https://smartthings.growful.click",
    service,
    smartThingsConfirmationRequester: confirmationRequester,
    smartThingsAppId: "growful-app",
    smartThingsWebhookKeyProvider: keyProvider,
    webhookNow: () => now,
  }
  const app = createApp(appOptions)
  apps.push(app)
  return { app, confirmationRequester, keyProvider, store }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings webhook", () => {
  it("deletes stored tokens when a signed DELETE lifecycle event arrives", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("DELETE")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({})
    expect(fixture.store.tokens).toBeNull()
    expect(fixture.keyProvider).toHaveBeenCalledWith("/pl/useast2/growful-test")
  })

  it("rejects an unsigned event without deleting stored tokens", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens(storedTokens())

    // When
    const response = await fixture.app.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: lifecycleEventBody("DELETE"),
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("rejects a key identifier that escapes the SmartThings key namespace", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("DELETE")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body, requestDate, "/../unexpected"),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(fixture.keyProvider).not.toHaveBeenCalled()
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("acknowledges a repeated signed DELETE after the connection is already gone", async () => {
    // Given
    const fixture = createFixture()
    const body = lifecycleEventBody("DELETE")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
  })

  it("acknowledges a signed UPDATE lifecycle event without deleting tokens", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("UPDATE")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("rejects a signed lifecycle event for a different SmartThings app", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("DELETE", "different-app")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("rejects a signed event when the body digest was changed", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens(storedTokens())
    const signedBody = lifecycleEventBody("DELETE")
    const changedBody = `${signedBody} `

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(signedBody),
      method: "POST",
      payload: changedBody,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("rejects a signed event older than five minutes", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("DELETE")
    const staleDate = new Date(now.getTime() - 5 * 60 * 1_000 - 1).toUTCString()

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body, staleDate),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("confirms a validated SmartThings target URL", async () => {
    // Given
    const fixture = createFixture()
    const confirmationUrl =
      "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=confirmation-token"

    // When
    const response = await fixture.app.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: {
        confirmationData: { appId: "growful-app", confirmationUrl },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(fixture.confirmationRequester).toHaveBeenCalledWith(new URL(confirmationUrl))
  })

  it("rejects a confirmation URL outside the SmartThings API origin", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: {
        confirmationData: {
          appId: "growful-app",
          confirmationUrl:
            "https://attacker.example/v1/apps/growful-app/confirm-registration?token=confirmation-token",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(fixture.confirmationRequester).not.toHaveBeenCalled()
  })

  it("rejects a confirmation for a different SmartThings app", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({
      method: "POST",
      payload: {
        confirmationData: {
          appId: "different-app",
          confirmationUrl:
            "https://api.smartthings.com/v1/apps/different-app/confirm-registration?token=confirmation-token",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(fixture.confirmationRequester).not.toHaveBeenCalled()
  })

  it("returns a sanitized error when SmartThings confirmation fails", async () => {
    // Given
    const fixture = createFixture()
    fixture.confirmationRequester.mockRejectedValueOnce(
      new Error("confirmation failed for token=confirmation-token"),
    )

    // When
    const response = await fixture.app.inject({
      method: "POST",
      payload: {
        confirmationData: {
          appId: "growful-app",
          confirmationUrl:
            "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=confirmation-token",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: "smartthings_confirmation_failed" })
    expect(response.body).not.toContain("confirmation-token")
  })
})
