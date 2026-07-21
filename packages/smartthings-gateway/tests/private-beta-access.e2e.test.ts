import { afterEach, describe, expect, it } from "vitest"
import { type AppOptions, createApp } from "../src/http/app.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const apps: ReturnType<typeof createApp>[] = []
const authorizationOrigin = "https://api.smartthings.test"
const redirectOrigin = "https://smartthings.growful.click"

function createFixture(oauthAccess: AppOptions["oauthAccess"]) {
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    client: new FakeSmartThingsClient(),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  const app = createApp({
    authorizationOrigin,
    oauthAccess,
    redirectOrigin,
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
    const fixture = createFixture({
      invites: [
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ],
      mode: "private_beta",
    })
    const authorization = `Basic ${Buffer.from("private-user:private-password").toString("base64")}`

    // When
    const unauthenticatedGet = await fixture.app.inject({ method: "GET", url: "/oauth/start" })
    const unauthenticatedPost = await fixture.app.inject({
      headers: { "content-type": "application/x-www-form-urlencoded", origin: redirectOrigin },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read",
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
      payload: "deviceRange=all&devicePermissions=read",
      url: "/oauth/start",
    })

    // Then
    expect(unauthenticatedGet.statusCode).toBe(401)
    expect(unauthenticatedGet.headers["www-authenticate"]).toBe(
      'Basic realm="Growful private beta", charset="UTF-8"',
    )
    expect(unauthenticatedPost.statusCode).toBe(401)
    expect(fixture.store.states.size).toBe(1)
    expect(authenticatedGet.statusCode).toBe(200)
    expect(authenticatedPost.statusCode).toBe(302)
  })

  it("rejects a private beta user removed from the invitation list", async () => {
    // Given
    const fixture = createFixture({
      invites: [
        {
          passwordHash: "5b7865cd940ba26f00ee2d535bf8d96aba6308d98c1e290e2d095986e5967f55",
          username: "second-user",
        },
      ],
      mode: "private_beta",
    })
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
})
