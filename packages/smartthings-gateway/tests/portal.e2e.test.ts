import { afterEach, describe, expect, it } from "vitest"
import { type AppOptions, createApp } from "../src/http/app.js"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { portalClientScript } from "../src/http/portal-client.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"
import { allowAllGrowfulAbuseControl } from "./fixtures/abuse-control.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"
import { privateBetaOAuthAccess, publicOAuthAccess } from "./fixtures/oauth-access.js"
import { readyProbe } from "./fixtures/readiness.js"

const apps: ReturnType<typeof createApp>[] = []
const redirectOrigin = "https://smartthings.growful.click"

function createFixture(oauthAccess: AppOptions["oauthAccess"] = publicOAuthAccess) {
  const app = createApp({
    abuseControl: allowAllGrowfulAbuseControl,
    authorizationOrigin: "https://api.smartthings.test",
    oauthAccess,
    readinessProbe: readyProbe,
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
    expect(response.body).toContain("공개 서비스")
    expect(response.body).not.toContain("비공개 베타 Gateway")
    expect(response.body).toContain(publicOAuthAccess.operatorName)
    expect(response.body).toContain(publicOAuthAccess.privacyPolicyUrl.toString())
    expect(response.body).toContain(publicOAuthAccess.termsUrl.toString())
    expect(response.body).toContain(publicOAuthAccess.supportEmail)
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
    expect(response.body).toContain("data-support-reference")
    expect(response.body).toContain("data-blocked-notice")
    expect(response.body).toContain(`href="mailto:${publicOAuthAccess.supportEmail}"`)
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

  it("blocks indexing for private beta portal routes", async () => {
    const app = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )

    const [home, manage, robots] = await Promise.all([
      app.inject({ method: "GET", url: "/" }),
      app.inject({ method: "GET", url: "/manage" }),
      app.inject({ method: "GET", url: "/robots.txt" }),
    ])

    expect(home.body).toContain('<meta name="robots" content="noindex,nofollow">')
    expect(manage.body).toContain('<meta name="robots" content="noindex,nofollow">')
    expect(robots.headers["cache-control"]).toBe("no-store")
    expect(robots.body).toBe("User-agent: *\nDisallow: /\n")
  })

  it("serves the compiled browser client without caching it", async () => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({ method: "GET", url: "/portal.js" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("javascript")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toBe(portalClientScript)
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
