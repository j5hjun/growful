import { afterEach, describe, expect, it } from "vitest"
import { createApp } from "../src/http/app.js"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const apps: ReturnType<typeof createApp>[] = []
const redirectOrigin = "https://smartthings.growful.click"

function createFixture() {
  const app = createApp({
    authorizationOrigin: "https://api.smartthings.test",
    oauthAccess: { mode: "public" },
    redirectOrigin,
    service: new OAuthService({
      client: new FakeSmartThingsClient(),
      growfulTokenGenerator: () =>
        GrowfulTokenSchema.parse(`grw_st_${Buffer.alloc(32, 1).toString("base64url")}`),
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
      refreshLeaseMs: 60_000,
      stateGenerator: () => "portal-state-with-sufficient-entropy",
      store: new MemoryOAuthStore(),
    }),
    smartThingsAppId: "growful-app",
  })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("Growful portal HTTP surface", () => {
  it("renders a public landing page with connection and management actions", async () => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({ method: "GET", url: "/" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.headers["content-security-policy"]).toContain("connect-src 'self'")
    expect(response.body).toContain("data-portal-home")
    expect(response.body).toContain('href="/oauth/start" data-action="connect"')
    expect(response.body).toContain('href="/manage" data-action="manage"')
  })

  it("renders a token management page with a self-hosted interaction script", async () => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({ method: "GET", url: "/manage" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("script-src 'self'")
    expect(response.headers["content-security-policy"]).toContain("connect-src 'self'")
    expect(response.body).toContain('<meta name="robots" content="index,follow">')
    expect(response.body).toContain("data-portal-token-form")
    expect(response.body).toContain('href="/oauth/start" data-reconnect')
    expect(response.body).toContain('type="password"')
    expect(response.body).toContain('autocomplete="off"')
    expect(response.body).toContain("data-portal-status")
    expect(response.body).toContain(
      '<form class="dialog-content" method="dialog" data-disconnect-form>',
    )
    expect(response.body).toContain('<script src="/portal.js" defer></script>')
  })

  it("publishes an indexing policy for the public portal routes", async () => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({ method: "GET", url: "/robots.txt" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/plain")
    expect(response.body).toBe("User-agent: *\nAllow: /\n")
  })

  it("serves a browser client that keeps the token out of persistent browser storage", async () => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({ method: "GET", url: "/portal.js" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("javascript")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toContain('"/connection"')
    expect(response.body).toContain('"/token/rotate"')
    expect(response.body).not.toContain("localStorage")
    expect(response.body).not.toContain("sessionStorage")
    expect(response.body).not.toContain("document.cookie")
    expect(response.body).not.toContain("innerHTML")
  })

  it("links the one-time credential output to the management page", () => {
    // Given
    const token = GrowfulTokenSchema.parse(`grw_st_${Buffer.alloc(32, 2).toString("base64url")}`)

    // When
    const page = renderOAuthCompletion(token)

    // Then
    expect(page).toContain('href="/manage" data-action="manage-issued-token"')
  })
})
