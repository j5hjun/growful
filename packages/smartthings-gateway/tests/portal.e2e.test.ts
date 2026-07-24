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

function expectCloudflareSafeSupportEmail(body: string): void {
  expect(body).toContain(
    `<!--email_off--><a href="mailto:${publicOAuthAccess.supportEmail}">${publicOAuthAccess.supportEmail}</a><!--/email_off-->`,
  )
  expect(body).not.toContain("/cdn-cgi/l/email-protection")
  expect(body).not.toContain("[email protected]")
}

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
    expect(response.body).toContain("초대 없이 이용 가능한 공개 접근 모드")
    expect(response.body).not.toContain("비공개 베타 Gateway")
    expect(response.body).toContain(publicOAuthAccess.operatorName)
    expect(response.body).toContain(publicOAuthAccess.privacyPolicyUrl.toString())
    expect(response.body).toContain(publicOAuthAccess.termsUrl.toString())
    expectCloudflareSafeSupportEmail(response.body)
    expect(response.body).toContain('href="/oauth/start" data-action="connect"')
    expect(response.body).toContain('href="/manage" data-action="manage"')
    expect(response.headers["content-security-policy"]).not.toContain("script-src 'unsafe-inline'")
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
    expect(response.body).toContain("data-token-loss-recovery")
    expect(response.body).toContain('href="/oauth/start" data-token-loss-reconnect')
    expect(response.body).toContain("기존 Growful 토큰은 다시 조회하거나 복구할 수 없습니다.")
    expect(response.body).toContain(
      "새 연결 시작을 선택해 SmartThings 승인을 완료하면 새 Growful 토큰을 받을 수 있습니다.",
    )
    expect(response.body).toContain(
      "같은 SmartThings 연결을 다시 승인하면 이전 Growful 토큰은 더 이상 사용할 수 없습니다.",
    )
    expect(response.body).toContain(
      "별도 SmartThings 연결로 승인하면 기존 Growful 연결은 자동으로 해제되지 않고 남을 수 있습니다.",
    )
    expect(response.body).toContain(
      "이 작업은 Growful Gateway에 저장된 연결 정보만 삭제하며 SmartThings 쪽 상태는 변경하지 않습니다.",
    )
    expect(response.body).toContain(">새 연결 시작</a>")
    expect(response.body).toContain('type="password"')
    expect(response.body).toContain('autocomplete="off"')
    expect(response.body).toContain("data-portal-status")
    expect(response.body).toContain("data-support-reference")
    expect(response.body).toContain("data-blocked-notice")
    expect(response.body).toContain(
      `문의할 때 위 지원 참조를 함께 전달해 주세요. <!--email_off--><a href="mailto:${publicOAuthAccess.supportEmail}">${publicOAuthAccess.supportEmail}</a><!--/email_off-->`,
    )
    expect(response.body).toContain(
      '<form class="dialog-content" method="dialog" data-disconnect-form>',
    )
    expect(response.body).toContain('<script src="/portal.js" defer></script>')
  })

  it("renders a token-safe native fallback when the interaction script is unavailable", async () => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({ method: "GET", url: "/manage" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("form-action 'self'")
    expect(response.body).toContain(
      '<form class="token-form" action="/manage#javascript-required" method="get"',
    )
    expect(response.body).toContain('id="growful-token" type="password"')
    expect(response.body).not.toContain('name="growfulToken"')
    expect(response.body).toContain('id="javascript-required" data-no-js-fallback')
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
      expectCloudflareSafeSupportEmail(response.body)
      expect(response.headers["content-security-policy"]).not.toContain(
        "script-src 'unsafe-inline'",
      )
    }
    expect(privacy.body).toContain('data-policy-document="privacy"')
    expect(privacy.body).toContain('href="/privacy" aria-current="page"')
    expect(privacy.body).toContain("승인 과정의 임시 상태값은 10분 동안 유효")
    expect(privacy.body).toContain("데이터베이스에 남는 시간은 최대 15분")
    expect(privacy.body).toContain(
      '<span class="phrase">백업·데이터베이스 복구 기록·운영 로그</span>',
    )
    expect(privacy.body).toContain("구체적인 보존 기간은 이 문서에 아직 명시되어 있지 않습니다")
    expect(privacy.body).not.toContain("비공개 베타 범위에서 운영합니다")
    expect(privacy.body).not.toContain("비공개")
    expect(terms.body).toContain('data-policy-document="terms"')
    expect(terms.body).toContain('href="/terms" aria-current="page"')
    expect(terms.body).toContain("초대 없이 이용 가능한 공개 접근 모드의 기술적 이용 조건")
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
    expect(response.body.includes("data-support-document")).toBe(true)
    expect(response.body.includes('href="/support" aria-current="page"')).toBe(true)
    expect(response.body.includes('href="/manage"')).toBe(true)
    expect(
      response.body.includes(
        `<!--email_off--><a class="action action-primary" href="mailto:${publicOAuthAccess.supportEmail}" data-support-email-action>이메일 문의하기</a><!--/email_off-->`,
      ),
    ).toBe(true)
    expectCloudflareSafeSupportEmail(response.body)
    expect(response.headers["content-security-policy"]).not.toContain("script-src 'unsafe-inline'")
    expect(response.body.includes(publicOAuthAccess.operatorName)).toBe(true)
    expect(response.body.includes('<dl class="support-topics">')).toBe(true)
    expect(response.body.includes('data-support-topic="connection"')).toBe(true)
    expect(response.body.includes('data-support-topic="token-exposure"')).toBe(true)
    expect(response.body.includes('data-support-topic="privacy"')).toBe(true)
    expect(response.body.includes('data-support-topic="security"')).toBe(true)
    expect(response.body.includes("Growful 토큰")).toBe(true)
    expect(response.body.includes("SmartThings 연결 토큰")).toBe(true)
    expect(response.body.includes("승인 과정의 임시 코드·상태값")).toBe(true)
    expect(response.body.includes("주소창 전체 주소")).toBe(true)
    expect(response.body.includes("비밀번호")).toBe(true)
    expect(response.body.includes("원본 계정·설치 식별자")).toBe(true)
    expect(response.body.includes("승인 후 돌아오는 단계")).toBe(true)
    expect(response.body.includes("화면에 표시된 지원 참조")).toBe(true)
    expect(response.body.includes("callback")).toBe(false)
    expect(response.body.includes("supportReference")).toBe(false)
    expect(response.body.includes("data-token-loss-recovery")).toBe(true)
    expect(response.body.includes('href="/oauth/start" data-token-loss-reconnect')).toBe(true)
    expect(response.body.includes("기존 Growful 토큰은 다시 조회하거나 복구할 수 없습니다.")).toBe(
      true,
    )
    expect(
      response.body.includes(
        "새 연결 시작을 선택해 SmartThings 승인을 완료하면 새 Growful 토큰을 받을 수 있습니다.",
      ),
    ).toBe(true)
    expect(
      response.body.includes(
        "같은 SmartThings 연결을 다시 승인하면 이전 Growful 토큰은 더 이상 사용할 수 없습니다.",
      ),
    ).toBe(true)
    expect(
      response.body.includes(
        "별도 SmartThings 연결로 승인하면 기존 Growful 연결은 자동으로 해제되지 않고 남을 수 있습니다.",
      ),
    ).toBe(true)
    expect(
      response.body.includes(
        "이 작업은 Growful Gateway에 저장된 연결 정보만 삭제하며 SmartThings 쪽 상태는 변경하지 않습니다.",
      ),
    ).toBe(true)
    expect(response.body.includes(">새 연결 시작</a>")).toBe(true)
    expect(
      response.body.includes("분실한 토큰의 기존 연결을 찾아 정리하기 위한 본인 확인 절차"),
    ).toBe(true)
    expect(response.body.includes("SmartThings에 남아")).toBe(false)
    expect(response.body.includes("SmartThings에서 별도로 정리")).toBe(false)
    expect(response.body.includes("SmartThings 토큰까지 폐기하려면")).toBe(false)
    expect(response.body.includes("비공개 베타")).toBe(false)
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
    expect(home.body).toContain("data-private-beta-entry-guidance")
    expect(home.body).toContain("초대 사용자 이름과 초대 비밀번호")
    expect(home.body).toContain("초대 비밀번호는 삼성 계정 비밀번호가 아닙니다")
    expect(home.body).toContain("반복해서 잘못 입력하면 초대 확인 시도가 잠시 제한될 수 있습니다")
    expect(privacy.body).toContain("비공개 베타 범위에서 운영합니다")
    expect(privacy.body).toContain("초대 사용자 이름")
    expect(privacy.body).toContain("비공개 베타 초대가 회수")
    expect(privacy.body).toContain("Gateway API 중계 접근이 제한·중단되어도 연결 정보는 유지되며")
    expect(terms.body).toContain("비공개 베타의 기술적 이용 조건")
    expect(support.body).toContain("비공개 베타 초대를 회수")
    expect(support.body).toContain("해당 연결의 Gateway API 중계 접근을 제한·중단")
    expect(robots.headers["cache-control"]).toBe("no-store")
    expect(robots.body).toBe("User-agent: *\nDisallow: /\n")
  })

  it("does not show private beta credential guidance on the public landing page", async () => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({ method: "GET", url: "/" })

    // Then
    expect(response.body).not.toContain("data-private-beta-entry-guidance")
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
