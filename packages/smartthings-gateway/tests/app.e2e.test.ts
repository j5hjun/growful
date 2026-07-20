import { Writable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import { type AppOptions, createApp } from "../src/http/app.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const apps: ReturnType<typeof createApp>[] = []
const adminToken = "test-admin-token-with-32-characters"
const adminAuthorization = `Basic ${Buffer.from(`operator:${adminToken}`).toString("base64")}`
const authorizationOrigin = "https://api.smartthings.test"
const redirectOrigin = "https://smartthings.growful.click"

function createFixture(logger?: AppOptions["logger"]) {
  const client = new FakeSmartThingsClient()
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    client,
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  const app = createApp({ adminToken, authorizationOrigin, logger, redirectOrigin, service })
  apps.push(app)
  return { app, client, store }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings Gateway HTTP API", () => {
  it("rejects OAuth authorization starts without valid operator credentials", async () => {
    // Given
    const fixture = createFixture()
    const wrongAuthorization = `Basic ${Buffer.from("operator:wrong-token").toString("base64")}`

    // When
    const responses = await Promise.all([
      fixture.app.inject({ method: "GET", url: "/oauth/start" }),
      fixture.app.inject({
        headers: { authorization: wrongAuthorization },
        method: "GET",
        url: "/oauth/start",
      }),
      fixture.app.inject({
        headers: { "content-type": "application/x-www-form-urlencoded", origin: redirectOrigin },
        method: "POST",
        payload: "deviceRange=all&permissions=read",
        url: "/oauth/start",
      }),
      fixture.app.inject({
        headers: {
          authorization: wrongAuthorization,
          "content-type": "application/x-www-form-urlencoded",
          origin: redirectOrigin,
        },
        method: "POST",
        payload: "deviceRange=all&permissions=read",
        url: "/oauth/start",
      }),
    ])

    // Then
    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 401, 401])
    expect(
      responses.every(
        (response) => response.headers["www-authenticate"] === 'Basic realm="SmartThings Gateway"',
      ),
    ).toBe(true)
    expect(fixture.store.states.size).toBe(0)
  })

  it("rejects OAuth POST requests before buffering an unauthenticated body", async () => {
    const fixture = createFixture()

    const unauthenticatedResponse = await fixture.app.inject({
      headers: { "content-type": "application/x-www-form-urlencoded", origin: redirectOrigin },
      method: "POST",
      payload: "x".repeat(4_097),
      url: "/oauth/start",
    })
    const oversizedAuthenticatedResponse = await fixture.app.inject({
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: "x".repeat(4_097),
      url: "/oauth/start",
    })

    expect(unauthenticatedResponse.statusCode).toBe(401)
    expect(oversizedAuthenticatedResponse.statusCode).toBe(413)
  })

  it("sets form-action to the SmartThings OAuth redirect chain", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({
      headers: { authorization: adminAuthorization },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.headers["content-security-policy"]).toContain(
      "form-action 'self' https://api.smartthings.test https://account.smartthings.com https://account.samsung.com",
    )
  })

  it("completes OAuth and reports connection metadata without tokens", async () => {
    // Given
    const fixture = createFixture()
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      scopes: ["r:devices:$", "x:devices:$", "r:locations:*"],
    }
    const startResponse = await fixture.app.inject({
      headers: { authorization: adminAuthorization },
      method: "GET",
      url: "/oauth/start",
    })
    expect(startResponse.statusCode).toBe(200)
    expect(startResponse.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(startResponse.headers["referrer-policy"]).toBe("same-origin")
    expect(startResponse.headers["cache-control"]).toBe("no-store")
    expect(startResponse.body).not.toContain('name="locationRead" value="on" checked')

    const authorizationResponse = await fixture.app.inject({
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=selected&permissions=read&permissions=control&locationRead=on",
      url: "/oauth/start",
    })
    const location = new URL(authorizationResponse.headers.location ?? "")
    const state = location.searchParams.get("state") ?? ""

    // When
    const callbackResponse = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=authorization-code&state=${encodeURIComponent(state)}`,
    })
    const replayResponse = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=replayed-code&state=${encodeURIComponent(state)}`,
    })
    const connectionResponse = await fixture.app.inject({ method: "GET", url: "/connection" })

    // Then
    expect(callbackResponse.statusCode).toBe(200)
    expect(replayResponse.statusCode).toBe(400)
    expect(replayResponse.json()).toEqual({ error: "invalid_oauth_state" })
    expect(fixture.client.exchangedCodes).toEqual(["authorization-code"])
    expect(location.searchParams.get("scope")).toBe("r:devices:$ x:devices:$ r:locations:*")
    expect(connectionResponse.json()).toEqual({
      connected: true,
      expiresAt: "2026-07-20T00:00:00.000Z",
      grantedScopes: ["r:devices:$", "x:devices:$", "r:locations:*"],
      lastRefreshedAt: null,
    })
    expect(connectionResponse.headers["cache-control"]).toBe("no-store")
    expect(connectionResponse.body).not.toContain("initial-access-token")
    expect(connectionResponse.body).not.toContain("initial-refresh-token")
  })

  it("does not log the OAuth authorization code or state", async () => {
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
    const startResponse = await fixture.app.inject({
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&permissions=read&locationRead=on",
      url: "/oauth/start",
    })
    const location = new URL(startResponse.headers.location ?? "")
    const state = location.searchParams.get("state") ?? ""

    await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=sensitive-authorization-code&state=${encodeURIComponent(state)}`,
    })

    const logs = logChunks.join("")
    expect(logs).not.toContain(adminToken)
    expect(logs).not.toContain("sensitive-authorization-code")
    expect(logs).not.toContain(state)
  })

  it("rejects OAuth selections submitted from a different origin", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
      },
      method: "POST",
      payload: "deviceRange=all&permissions=read",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({ error: "invalid_origin" })
  })

  it("consumes the OAuth state when authorization is denied", async () => {
    const fixture = createFixture()
    const startResponse = await fixture.app.inject({
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&permissions=read",
      url: "/oauth/start",
    })
    const state = new URL(startResponse.headers.location ?? "").searchParams.get("state") ?? ""

    const deniedResponse = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    })
    const replayResponse = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=replayed-code&state=${encodeURIComponent(state)}`,
    })

    expect(deniedResponse.statusCode).toBe(400)
    expect(deniedResponse.json()).toEqual({ error: "authorization_denied" })
    expect(replayResponse.statusCode).toBe(400)
    expect(replayResponse.json()).toEqual({ error: "invalid_oauth_state" })
    expect(fixture.client.exchangedCodes).toHaveLength(0)
  })

  it("returns an accessible selection page when no device permission is selected", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=selected",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toContain('role="alert"')
    expect(response.body).toContain("디바이스 권한은 하나&nbsp;이상 필요합니다.")
    expect(response.body).not.toContain('value="read" checked')
    expect(response.body).not.toContain('value="control" checked')
    expect(response.headers.location).toBeUndefined()
  })
})
