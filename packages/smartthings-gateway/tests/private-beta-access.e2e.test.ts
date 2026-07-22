import { afterEach, describe, expect, it } from "vitest"
import { type AppOptions, createApp } from "../src/http/app.js"
import { InstalledAppIdSchema, type StoredTokens } from "../src/oauth/contracts.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { emptyServiceStatusSource } from "../src/status/service-status.js"
import { allowAllGrowfulAbuseControl } from "./fixtures/abuse-control.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore, memoryStoreGrowfulToken } from "./fixtures/memory-oauth-store.js"
import { privateBetaOAuthAccess } from "./fixtures/oauth-access.js"
import { readyProbe } from "./fixtures/readiness.js"

const apps: ReturnType<typeof createApp>[] = []
const authorizationOrigin = "https://api.smartthings.test"
const redirectOrigin = "https://smartthings.growful.click"

function storedTokens(): StoredTokens {
  return {
    accessToken: "access-token",
    expiresAt: new Date("2026-07-20T00:00:00.000Z"),
    installedAppId: InstalledAppIdSchema.parse("removed-user-installed-app"),
    lastRefreshedAt: null,
    refreshToken: "refresh-token",
    scopes: ["r:devices:$"],
    tokenType: "bearer",
  }
}

function createFixture(oauthAccess: AppOptions["oauthAccess"]) {
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    accessPolicy: {
      policyVersion: oauthAccess.policyVersion,
      privateBetaAccess: oauthAccess.mode === "private_beta" ? oauthAccess.inviteAccess : null,
    },
    client: new FakeSmartThingsClient(),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  const app = createApp({
    abuseControl: allowAllGrowfulAbuseControl,
    authorizationOrigin,
    oauthAccess,
    readinessProbe: readyProbe,
    redirectOrigin,
    serviceStatusSource: emptyServiceStatusSource,
    service,
    smartThingsAppId: "growful-app",
  })
  apps.push(app)
  return { app, store }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("Private-beta OAuth access HTTP surface", () => {
  it("requires Basic authentication for both private beta OAuth start requests", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )
    const authorization = `Basic ${Buffer.from("private-user:private-password").toString("base64")}`

    // When
    const unauthenticatedGet = await fixture.app.inject({ method: "GET", url: "/oauth/start" })
    const unauthenticatedPost = await fixture.app.inject({
      headers: { "content-type": "application/x-www-form-urlencoded", origin: redirectOrigin },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })
    const authenticatedGet = await fixture.app.inject({
      headers: { authorization },
      method: "GET",
      url: "/oauth/start",
    })
    const authenticatedPost = await fixture.app.inject({
      headers: {
        authorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })

    // Then
    expect(unauthenticatedGet.statusCode).toBe(401)
    expect(unauthenticatedGet.headers["www-authenticate"]).toBe(
      'Basic realm="Growful private beta", charset="UTF-8"',
    )
    expect(unauthenticatedGet.headers["cache-control"]).toBe("no-store")
    expect(unauthenticatedGet.json()).toEqual({ error: "private_beta_access_required" })
    expect(unauthenticatedPost.statusCode).toBe(401)
    expect(fixture.store.states.size).toBe(1)
    expect(authenticatedGet.statusCode).toBe(200)
    expect(authenticatedPost.statusCode).toBe(302)
  })

  it("rejects a private beta user removed from the invitation list", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "5b7865cd940ba26f00ee2d535bf8d96aba6308d98c1e290e2d095986e5967f55",
          username: "second-user",
        },
      ]),
    )
    const removedAuthorization = `Basic ${Buffer.from("private-user:private-password").toString("base64")}`

    // When
    const response = await fixture.app.inject({
      headers: { authorization: removedAuthorization },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
  })

  it("rate limits repeated invalid private beta credentials", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )
    const invalidAuthorization = `Basic ${Buffer.from("private-user:wrong-password").toString("base64")}`

    // When
    const responses = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(
        await fixture.app.inject({
          headers: {
            authorization: invalidAuthorization,
            "x-forwarded-for": "192.0.2.10",
          },
          method: "GET",
          url: "/oauth/start",
        }),
      )
    }
    const otherClient = await fixture.app.inject({
      headers: {
        authorization: invalidAuthorization,
        "x-forwarded-for": "192.0.2.11",
      },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(responses.slice(0, 5).map((response) => response.statusCode)).toEqual(Array(5).fill(401))
    expect(responses[5]?.statusCode).toBe(429)
    expect(responses[5]?.headers["retry-after"]).toBe("60")
    expect(responses[5]?.headers["cache-control"]).toBe("no-store")
    expect(responses[5]?.json()).toEqual({ error: "private_beta_access_rate_limited" })
    expect(otherClient.statusCode).toBe(401)
  })

  it("clears the client failure bucket after valid private beta credentials", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )
    const validAuthorization = `Basic ${Buffer.from("private-user:private-password").toString("base64")}`
    const invalidAuthorization = `Basic ${Buffer.from("private-user:wrong-password").toString("base64")}`
    const forwardedFor = "192.0.2.12"
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await fixture.app.inject({
        headers: { authorization: invalidAuthorization, "x-forwarded-for": forwardedFor },
        method: "GET",
        url: "/oauth/start",
      })
    }
    await fixture.app.inject({
      headers: { authorization: validAuthorization, "x-forwarded-for": forwardedFor },
      method: "GET",
      url: "/oauth/start",
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: invalidAuthorization, "x-forwarded-for": forwardedFor },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
  })

  it("rejects an existing Growful token that is not bound to an active invitation", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "5b7865cd940ba26f00ee2d535bf8d96aba6308d98c1e290e2d095986e5967f55",
          username: "second-user",
        },
      ]),
    )
    fixture.store.seedTokens(storedTokens())

    // When
    const response = await fixture.app.inject({
      headers: { authorization: `Bearer ${memoryStoreGrowfulToken}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(response.statusCode).toBe(401)
  })
})
