import type { FastifyInstance, LightMyRequestResponse } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import {
  authorizeGatewayApp,
  createGatewayAppFixture,
  gatewayRedirectOrigin,
} from "./fixtures/gateway-app-fixture.js"
import { privateBetaOAuthAccess, publicOAuthAccess } from "./fixtures/oauth-access.js"

const apps: FastifyInstance[] = []
const browserAccept = "text/html,application/xhtml+xml"

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

type HtmlPageExpectation = {
  readonly bodyWidth: "manage" | "panel" | "wide"
  readonly currentCount: 0 | 1
  readonly headerVariant: "standard" | "task"
  readonly label: string
  readonly response: LightMyRequestResponse
}

function countOpeningTags(html: string, tagName: string): number {
  return html.match(new RegExp(`<${tagName}(?:\\s|>)`, "gu"))?.length ?? 0
}

function expectSharedDocument(page: HtmlPageExpectation): void {
  const { body } = page.response
  const renderedBody = body.slice(body.indexOf("<body>"))
  expect(page.response.headers["content-type"], page.label).toContain("text/html")
  expect(body.match(/class="skip-link"/gu), page.label).toHaveLength(1)
  expect(countOpeningTags(body, "header"), page.label).toBe(1)
  expect(countOpeningTags(body, "main"), page.label).toBe(1)
  expect(countOpeningTags(body, "h1"), page.label).toBe(1)
  expect(countOpeningTags(body, "footer"), page.label).toBe(1)
  expect(body.match(/id="main-content"/gu), page.label).toHaveLength(1)
  expect(body.match(/data-page-shell/gu), page.label).toHaveLength(1)
  expect(renderedBody.match(/aria-current="page"/gu) ?? [], page.label).toHaveLength(
    page.currentCount,
  )
  expect(body, page.label).toContain(`data-body-width="${page.bodyWidth}"`)
  expect(body, page.label).toContain(`data-header-variant="${page.headerVariant}"`)
  expect(body, page.label).toContain("--panel-wide: 64rem")
  expect(body, page.label).toContain(".page-shell { width: min(var(--panel-wide), 100%)")

  const skipIndex = body.indexOf('<a class="skip-link"')
  const headerIndex = body.indexOf('<header class="site-header"')
  const mainIndex = body.indexOf('<main id="main-content"')
  const headingIndex = body.indexOf("<h1", mainIndex)
  const mainEndIndex = body.indexOf("</main>", mainIndex)
  const footerIndex = body.indexOf('<footer class="site-footer">')
  expect(skipIndex, page.label).toBeGreaterThan(body.indexOf("<body>"))
  expect(skipIndex, page.label).toBeLessThan(headerIndex)
  expect(headerIndex, page.label).toBeLessThan(mainIndex)
  expect(mainIndex, page.label).toBeLessThan(headingIndex)
  expect(mainEndIndex, page.label).toBeLessThan(footerIndex)
}

describe("Growful shared user-facing page shell", () => {
  it("renders the complete public, OAuth, callback, and private-beta HTML route matrix", async () => {
    // Given
    const publicFixture = createGatewayAppFixture({ apps })
    const regularRoutes = [
      { bodyWidth: "wide", currentCount: 1, label: "home", url: "/" },
      { bodyWidth: "manage", currentCount: 1, label: "manage", url: "/manage" },
      { bodyWidth: "manage", currentCount: 1, label: "status", url: "/status" },
      { bodyWidth: "manage", currentCount: 1, label: "support", url: "/support" },
      { bodyWidth: "manage", currentCount: 1, label: "privacy", url: "/privacy" },
      { bodyWidth: "manage", currentCount: 1, label: "terms", url: "/terms" },
      { bodyWidth: "manage", currentCount: 0, label: "browser 404", url: "/missing-page" },
    ] as const
    const regularPages = await Promise.all(
      regularRoutes.map(async (route) => ({
        ...route,
        headerVariant: "standard" as const,
        response: await publicFixture.app.inject({
          headers: { accept: browserAccept },
          method: "GET",
          url: route.url,
        }),
      })),
    )
    const scopeSelection = await publicFixture.app.inject({
      headers: { accept: browserAccept },
      method: "GET",
      url: "/oauth/start",
    })
    const invalidSelection = await publicFixture.app.inject({
      headers: {
        accept: browserAccept,
        "content-type": "application/x-www-form-urlencoded",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all",
      url: "/oauth/start",
    })
    const startFailure = await publicFixture.app.inject({
      headers: {
        accept: browserAccept,
        "content-type": "text/plain",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })
    const callbackError = await publicFixture.app.inject({
      headers: { accept: browserAccept },
      method: "GET",
      url: "/oauth/callback?code=missing-state",
    })
    const callbackSuccess = await authorizeGatewayApp(publicFixture.app)

    const privateFixture = createGatewayAppFixture({
      apps,
      oauthAccess: privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    })
    const privateBetaDenied = await privateFixture.app.inject({
      headers: { accept: browserAccept },
      method: "GET",
      url: "/oauth/start",
    })
    const privateBetaPostDenied = await privateFixture.app.inject({
      headers: {
        accept: browserAccept,
        "content-type": "application/x-www-form-urlencoded",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await privateFixture.app.inject({
        headers: { accept: browserAccept },
        method: "GET",
        url: "/oauth/start",
      })
    }
    const privateBetaRateLimited = await privateFixture.app.inject({
      headers: { accept: browserAccept },
      method: "GET",
      url: "/oauth/start",
    })
    const privateBetaPostRateLimited = await privateFixture.app.inject({
      headers: {
        accept: browserAccept,
        "content-type": "application/x-www-form-urlencoded",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })
    const taskPages: HtmlPageExpectation[] = [
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "GET OAuth start",
        response: scopeSelection,
      },
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "invalid POST OAuth start",
        response: invalidSelection,
      },
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "OAuth start failure",
        response: startFailure,
      },
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "OAuth callback error",
        response: callbackError,
      },
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "OAuth callback success",
        response: callbackSuccess,
      },
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "private beta 401",
        response: privateBetaDenied,
      },
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "private beta POST 401",
        response: privateBetaPostDenied,
      },
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "private beta 429",
        response: privateBetaRateLimited,
      },
      {
        bodyWidth: "panel",
        currentCount: 1,
        headerVariant: "task",
        label: "private beta POST 429",
        response: privateBetaPostRateLimited,
      },
    ]

    // Then
    expect(callbackSuccess.statusCode).toBe(200)
    expect(privateBetaDenied.statusCode).toBe(401)
    expect(privateBetaPostDenied.statusCode).toBe(401)
    expect(privateBetaRateLimited.statusCode).toBe(429)
    expect(privateBetaPostRateLimited.statusCode).toBe(429)
    for (const page of [...regularPages, ...taskPages]) expectSharedDocument(page)
    expect(
      regularPages.find((page) => page.label === "home")?.response.headers[
        "content-security-policy"
      ],
    ).toContain("form-action 'none'")
    expect(
      regularPages.find((page) => page.label === "manage")?.response.headers[
        "content-security-policy"
      ],
    ).toContain("script-src 'self'")
    expect(scopeSelection.headers["content-security-policy"]).toContain(
      "form-action 'self' https://api.smartthings.test",
    )
    expect(scopeSelection.headers["content-security-policy"]).not.toContain("script-src 'self'")
    expect(startFailure.headers["content-security-policy"]).toContain("script-src 'none'")
    expect(callbackError.headers["content-security-policy"]).toContain("script-src 'none'")
    expect(callbackSuccess.headers["content-security-policy"]).toContain("script-src 'self'")
    expect(callbackSuccess.headers["content-security-policy"]).not.toContain("script-src 'none'")
    expect(callbackSuccess.body).toContain("토큰 저장 후 서비스 안내")
    expect(callbackSuccess.body).toContain("토큰 저장 후 지원")
    expect(callbackSuccess.body.split("grw_st_")).toHaveLength(2)
  })

  it("keeps machine and static responses outside the HTML shell", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })
    const requests = [
      { contentType: "application/json", method: "GET", url: "/healthz" },
      { contentType: "application/json", method: "GET", url: "/readyz" },
      { contentType: "application/json", method: "GET", url: "/v1/devices" },
      { contentType: "application/json", method: "POST", url: "/token/rotate" },
      { contentType: "text/plain", method: "GET", url: "/robots.txt" },
      { contentType: "application/javascript", method: "GET", url: "/portal.js" },
      { contentType: "application/javascript", method: "GET", url: "/token-safety.js" },
    ] as const

    // When
    const responses = await Promise.all(
      requests.map(async (request) => ({
        ...request,
        response: await app.inject({ method: request.method, url: request.url }),
      })),
    )

    // Then
    for (const result of responses) {
      expect(result.response.headers["content-type"], result.url).toContain(result.contentType)
      expect(result.response.body, result.url).not.toContain("data-page-shell")
      expect(result.response.body, result.url).not.toContain('id="main-content"')
      expect(result.response.body, result.url).not.toContain('<header class="site-header"')
    }
  })

  it("provides every standard destination and one accurate current item", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({ method: "GET", url: "/privacy" })

    // Then
    expect(response.body).toContain('<a class="skip-link" href="#main-content">본문 바로가기</a>')
    expect(response.body).toContain('<main id="main-content" tabindex="-1"')
    expect(response.body).toContain('<nav class="site-nav" aria-label="주요 메뉴">')
    expect(response.body).toContain('<footer class="site-footer">')
    expect(response.body).toContain('href="/privacy" aria-current="page"')
    expect(response.body).toContain(publicOAuthAccess.operatorName)
    expect(response.body).toContain(
      `<!--email_off--><a href="mailto:${publicOAuthAccess.supportEmail}">${publicOAuthAccess.supportEmail}</a><!--/email_off-->`,
    )
    expect(response.body).toContain(">서비스 안내</a>")
    expect(response.body).toContain(">연결 관리</a>")
    expect(response.body).toContain(">상태</a>")
    expect(response.body).toContain(">지원</a>")
    expect(
      response.body.slice(response.body.indexOf("<body>")).match(/aria-current="page"/gu),
    ).toHaveLength(1)
    expect(response.body).not.toContain("decoratePortalPage")
  })
})
