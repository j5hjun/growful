import { expect, test } from "@playwright/test"
import type { FastifyInstance } from "fastify"
import { createGatewayAppFixture } from "../tests/fixtures/gateway-app-fixture.js"

for (const viewport of [
  { height: 720, width: 320 },
  { height: 780, width: 360 },
  { height: 844, width: 390 },
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
      const input = page.locator("#growful-token")
      const reveal = page.locator("[data-token-visibility]")
      const hint = page.locator("#token-hint")
      const fallback = page.locator("[data-no-js-fallback]")
      const submit = page.locator("[data-token-submit]")
      await input.fill(token)

      // When
      await submit.click()

      // Then
      await expect(page).toHaveURL(`${origin}/manage?#javascript-required`)
      await expect(fallback).toBeVisible()
      const inputBox = await input.boundingBox()
      const revealBox = await reveal.boundingBox()
      const hintBox = await hint.boundingBox()
      const fallbackBox = await fallback.boundingBox()
      const submitBox = await submit.boundingBox()
      if (
        inputBox === null ||
        revealBox === null ||
        hintBox === null ||
        fallbackBox === null ||
        submitBox === null
      ) {
        throw new Error("Management fallback controls have a missing browser layout box")
      }
      const entryBottom = Math.max(inputBox.y + inputBox.height, revealBox.y + revealBox.height)
      expect(hintBox.y).toBeGreaterThanOrEqual(entryBottom)
      expect(hintBox.y - entryBottom).toBeLessThanOrEqual(12)
      expect(fallbackBox.y).toBeGreaterThanOrEqual(hintBox.y + hintBox.height)
      expect(fallbackBox.y - (hintBox.y + hintBox.height)).toBeLessThanOrEqual(24)
      expect(submitBox.y).toBeGreaterThanOrEqual(fallbackBox.y + fallbackBox.height)
      expect(submitBox.y - (fallbackBox.y + fallbackBox.height)).toBeLessThanOrEqual(24)
      for (const control of [inputBox, revealBox, submitBox]) {
        expect(control.height).toBeGreaterThanOrEqual(44)
      }
      expect(submitBox.y).toBeGreaterThanOrEqual(0)
      expect(submitBox.y + submitBox.height).toBeLessThanOrEqual(viewport.height)
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      expect(hasHorizontalOverflow).toBe(false)
      expect(requests.join("\n")).not.toContain(token)
      expect(requests.some((request) => request.startsWith(`GET ${origin}/manage `))).toBe(true)

      // When
      await input.focus()
      await page.keyboard.press("Tab")

      // Then
      await expect(reveal).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(submit).toBeFocused()
    } finally {
      await context.close()
      await app.close()
    }
  })
}
