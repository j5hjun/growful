import { Writable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import { type AppOptions, createApp } from "../src/http/app.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const apps: ReturnType<typeof createApp>[] = []
const authorizationOrigin = "https://api.smartthings.test"
const redirectOrigin = "https://smartthings.growful.click"

function testGrowfulToken(index: number) {
  return GrowfulTokenSchema.parse(`grw_st_${Buffer.alloc(32, index).toString("base64url")}`)
}

function createFixture(logger?: AppOptions["logger"]) {
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
    authorizationOrigin,
    logger,
    redirectOrigin,
    service,
  })
  apps.push(app)
  return { app, client, store }
}

async function authorize(app: ReturnType<typeof createApp>) {
  const authorizationResponse = await app.inject({
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: redirectOrigin,
    },
    method: "POST",
    payload:
      "deviceRange=selected&devicePermissions=read&devicePermissions=control&locationPermissions=read",
    url: "/oauth/start",
  })
  const state =
    new URL(authorizationResponse.headers.location ?? "").searchParams.get("state") ?? ""
  return app.inject({
    method: "GET",
    url: `/oauth/callback?code=authorization-code&state=${encodeURIComponent(state)}`,
  })
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings Gateway HTTP API", () => {
  it("opens OAuth scope selection without a shared administrator token", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({ method: "GET", url: "/oauth/start" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.headers["referrer-policy"]).toBe("same-origin")
  })

  it("allows browser navigation through the SmartThings OAuth redirect chain", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({ method: "GET", url: "/oauth/start" })

    // Then
    expect(response.headers["content-security-policy"]).toContain(
      "form-action 'self' https://api.smartthings.test https://account.smartthings.com https://account.samsung.com",
    )
  })

  it("issues a Growful token once and requires it for connection status", async () => {
    // Given
    const fixture = createFixture()
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      scopes: ["r:devices:$", "x:devices:$", "r:locations:*"],
    }

    // When
    const callbackResponse = await authorize(fixture.app)
    const unauthenticatedStatus = await fixture.app.inject({ method: "GET", url: "/connection" })
    const authenticatedStatus = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(callbackResponse.statusCode).toBe(200)
    expect(callbackResponse.headers["cache-control"]).toBe("no-store")
    expect(callbackResponse.headers["content-type"]).toContain("text/html")
    expect(callbackResponse.body.match(/data-growful-token/g)).toHaveLength(1)
    expect(callbackResponse.body.match(new RegExp(testGrowfulToken(1), "g"))).toHaveLength(1)
    expect(unauthenticatedStatus.statusCode).toBe(401)
    expect(authenticatedStatus.json()).toEqual({
      connected: true,
      expiresAt: "2026-07-20T00:00:00.000Z",
      grantedScopes: ["r:devices:$", "x:devices:$", "r:locations:*"],
      lastRefreshedAt: null,
    })
    expect(authenticatedStatus.body).not.toContain("initial-access-token")
    expect(authenticatedStatus.body).not.toContain("initial-refresh-token")
  })

  it("rotates the Growful token and invalidates the previous token", async () => {
    // Given
    const fixture = createFixture()
    await authorize(fixture.app)

    // When
    const rotation = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "POST",
      url: "/token/rotate",
    })
    const previousStatus = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })
    const currentStatus = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(2)}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(rotation.json()).toEqual({ growfulToken: testGrowfulToken(2) })
    expect(rotation.headers["cache-control"]).toBe("no-store")
    expect(previousStatus.statusCode).toBe(401)
    expect(currentStatus.statusCode).toBe(200)
  })

  it("disconnects the authenticated connection and revokes its token", async () => {
    // Given
    const fixture = createFixture()
    await authorize(fixture.app)

    // When
    const disconnected = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "DELETE",
      url: "/connection",
    })
    const status = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(disconnected.statusCode).toBe(204)
    expect(status.statusCode).toBe(401)
  })

  it("does not log OAuth secrets or the issued Growful token", async () => {
    // Given
    const logChunks: string[] = []
    const fixture = createFixture({
      level: "info",
      stream: new Writable({
        write(chunk, _encoding, done) {
          logChunks.push(String(chunk))
          done()
        },
      }),
    })

    // When
    const response = await authorize(fixture.app)

    // Then
    const logs = logChunks.join("")
    expect(response.statusCode).toBe(200)
    expect(logs).not.toContain("authorization-code")
    expect(logs).not.toContain("test-state-with-sufficient-entropy")
    expect(logs).not.toContain(testGrowfulToken(1))
  })

  it("rejects OAuth selections from a different origin", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(403)
    expect(fixture.store.states.size).toBe(0)
  })

  it("rejects oversized OAuth selections", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({
      headers: { "content-type": "application/x-www-form-urlencoded", origin: redirectOrigin },
      method: "POST",
      payload: "x".repeat(4_097),
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(413)
  })

  it("consumes the OAuth state when authorization is denied", async () => {
    // Given
    const fixture = createFixture()
    const start = await fixture.app.inject({
      headers: { "content-type": "application/x-www-form-urlencoded", origin: redirectOrigin },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read",
      url: "/oauth/start",
    })
    const state = new URL(start.headers.location ?? "").searchParams.get("state") ?? ""

    // When
    const denied = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    })
    const replay = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=replayed-code&state=${encodeURIComponent(state)}`,
    })

    // Then
    expect(denied.statusCode).toBe(400)
    expect(replay.json()).toEqual({ error: "invalid_oauth_state" })
    expect(fixture.client.exchangedCodes).toHaveLength(0)
  })
})
