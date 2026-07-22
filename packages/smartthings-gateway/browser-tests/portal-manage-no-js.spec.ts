import { expect, test } from "@playwright/test"
import type { FastifyInstance } from "fastify"
import { createGatewayAppFixture } from "../tests/fixtures/gateway-app-fixture.js"

for (const viewport of [
  { height: 812, width: 375 },
  { height: 1_024, width: 768 },
  { height: 800, width: 1_280 },
]) {
  test(`native management fallback keeps the token and CTA safe at ${viewport.width}px`, async ({
    browser,
  }) => {
    // Given
    const apps: FastifyInstance[] = []
    const { app } = createGatewayAppFixture({ apps })
    const origin = await app.listen({ host: "127.0.0.1", port: 0 })
    const context = await browser.newContext({ javaScriptEnabled: false, viewport })
    const page = await context.newPage()
    const token = `grw_st_${"A".repeat(43)}`
    const requests: string[] = []
    page.on("request", (request) => {
      requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`)
    })

    try {
      await page.goto(`${origin}/manage`)
      await page.locator("#growful-token").fill(token)
      const initialAction = await page.locator("[data-token-submit]").boundingBox()
      const initialScroll = await page.evaluate(() => scrollY)

      // When
      await page.locator("[data-token-submit]").click()

      // Then
      await expect(page).toHaveURL(`${origin}/manage?#javascript-required`)
      await expect(page.locator("[data-no-js-fallback]")).toBeVisible()
      const fallbackAction = await page.locator("[data-token-submit]").boundingBox()
      const fallbackScroll = await page.evaluate(() => scrollY)
      if (initialAction === null || fallbackAction === null) {
        throw new Error("Management fallback action has no browser layout box")
      }
      expect(
        Math.abs(fallbackAction.y + fallbackScroll - initialAction.y - initialScroll),
      ).toBeLessThanOrEqual(8)
      expect(fallbackAction.y).toBeGreaterThanOrEqual(0)
      expect(fallbackAction.y + fallbackAction.height).toBeLessThanOrEqual(viewport.height)
      expect(requests.join("\n")).not.toContain(token)
      expect(requests.some((request) => request.startsWith(`GET ${origin}/manage `))).toBe(true)
    } finally {
      await context.close()
      await app.close()
    }
  })
}
