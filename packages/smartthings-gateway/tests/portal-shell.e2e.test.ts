import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"
import { publicOAuthAccess } from "./fixtures/oauth-access.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("Growful portal shell", () => {
  it("provides shared skip navigation and secondary footer navigation", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({ method: "GET", url: "/privacy" })

    // Then
    expect(response.body).toContain('<a class="skip-link" href="#main-content">본문 바로가기</a>')
    expect(response.body).toContain('<main id="main-content" tabindex="-1"')
    expect(response.body).toContain('<nav class="site-nav" aria-label="주요 메뉴">')
    expect(response.body).toContain('<footer class="site-footer">')
    expect(response.body).toContain('<nav aria-label="보조 메뉴">')
    expect(response.body).toContain('href="/privacy" aria-current="page"')
    expect(response.body).toContain(publicOAuthAccess.operatorName)
    expect(response.body).toContain(`href="mailto:${publicOAuthAccess.supportEmail}"`)

    const primaryNavigation = response.body.match(/<nav class="site-nav"[\s\S]*?<\/nav>/u)?.[0]
    expect(primaryNavigation).toContain("서비스 안내")
    expect(primaryNavigation).toContain("상태")
    expect(primaryNavigation).toContain("연결 관리")
    expect(primaryNavigation).not.toContain("지원 안내")
    expect(primaryNavigation).not.toContain("개인정보 처리방침")
    expect(primaryNavigation).not.toContain("이용약관")

    const primaryNavigationIndex = response.body.indexOf('<nav class="site-nav"')
    const mainIndex = response.body.indexOf('<main id="main-content"')
    const mainEndIndex = response.body.indexOf("</main>", mainIndex)
    const footerIndex = response.body.indexOf('<footer class="site-footer">')
    expect(primaryNavigationIndex).toBeLessThan(mainIndex)
    expect(mainEndIndex).toBeLessThan(footerIndex)
  })
})
