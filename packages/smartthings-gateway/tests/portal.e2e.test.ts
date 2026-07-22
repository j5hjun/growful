import { afterEach, describe, expect, it } from "vitest"
import { type AppOptions, createApp } from "../src/http/app.js"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { portalClientScript } from "../src/http/portal-client.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"
import { emptyServiceStatusSource } from "../src/status/service-status.js"
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
    serviceStatusSource: emptyServiceStatusSource,
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

  it("serves first-party privacy and terms documents", async () => {
    // Given
    const app = createFixture()

    // When
    const [privacy, terms] = await Promise.all([
      app.inject({ method: "GET", url: "/privacy" }),
      app.inject({ method: "GET", url: "/terms" }),
    ])

    // Then
    for (const response of [privacy, terms]) {
      expect(response.statusCode).toBe(200)
      expect(response.headers["content-type"]).toContain("text/html")
      expect(response.headers["cache-control"]).toBe("no-store")
      expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
      expect(response.body).toContain(publicOAuthAccess.operatorName)
      expect(response.body).toContain(`href="mailto:${publicOAuthAccess.supportEmail}"`)
    }
    expect(privacy.body).toContain('data-policy-document="privacy"')
    expect(privacy.body).toContain('href="/privacy" aria-current="page"')
    expect(privacy.body).toContain("OAuth 상태는 10분 동안 유효")
    expect(privacy.body).toContain("데이터베이스에 남는 시간은 최대 15분")
    expect(privacy.body).toContain("구체적인 보존 기간은 이 문서에 아직 명시되어 있지 않습니다")
    expect(privacy.body).not.toContain("비공개 베타 범위에서 운영합니다")
    expect(privacy.body).not.toContain("비공개")
    expect(terms.body).toContain('data-policy-document="terms"')
    expect(terms.body).toContain('href="/terms" aria-current="page"')
    expect(terms.body).toContain("공개 서비스의 기술적 이용 조건")
    expect(terms.body).not.toContain("비공개 베타")
    expect(terms.body).toContain("연결당 분당 60회")
  })

  it("serves a first-party support page without requesting secret credentials", async () => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({ method: "GET", url: "/support" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.body).toContain("data-support-document")
    expect(response.body).toContain('href="/support" aria-current="page"')
    expect(response.body).toContain('href="/manage"')
    expect(response.body).toContain(`href="mailto:${publicOAuthAccess.supportEmail}"`)
    expect(response.body).toContain(publicOAuthAccess.operatorName)
    expect(response.body).toContain('data-support-topic="connection"')
    expect(response.body).toContain('data-support-topic="token-exposure"')
    expect(response.body).toContain('data-support-topic="privacy"')
    expect(response.body).toContain('data-support-topic="security"')
    expect(response.body).toContain("Growful 토큰 원문")
    expect(response.body).toContain("SmartThings access·refresh token")
    expect(response.body).not.toContain("비공개 베타")
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

    const [home, manage, privacy, terms, support, status, robots] = await Promise.all([
      app.inject({ method: "GET", url: "/" }),
      app.inject({ method: "GET", url: "/manage" }),
      app.inject({ method: "GET", url: "/privacy" }),
      app.inject({ method: "GET", url: "/terms" }),
      app.inject({ method: "GET", url: "/support" }),
      app.inject({ method: "GET", url: "/status" }),
      app.inject({ method: "GET", url: "/robots.txt" }),
    ])

    for (const page of [home, manage, privacy, terms, support, status]) {
      expect(page.body).toContain('<meta name="robots" content="noindex,nofollow">')
    }
    expect(privacy.body).toContain("비공개 베타 범위에서 운영합니다")
    expect(privacy.body).toContain("비공개 베타 사용자명")
    expect(privacy.body).toContain("비공개 초대·운영 정책이 회수")
    expect(terms.body).toContain("비공개 베타의 기술적 이용 조건")
    expect(support.body).toContain("비공개 베타 초대나 접근을 회수")
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
