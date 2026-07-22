import { expect, test } from "@playwright/test"
import type { FastifyInstance } from "fastify"
import { createGatewayAppFixture } from "../tests/fixtures/gateway-app-fixture.js"

test("routed management states keep the portal shell pinned to the top safe area", async ({
  page,
}) => {
  // Given
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  await page.setViewportSize({ height: 1_600, width: 1_280 })

  try {
    await page.goto(`${origin}/manage`)
    const shell = page.locator(".portal-page-shell.page-manage")
    const submit = page.locator("[data-token-submit]")
    const initialBox = await shell.boundingBox()
    const initialAction = await submit.boundingBox()

    // When
    await page.locator("[data-token-submit]").evaluate((element) => {
      element.textContent = "확인 중…"
      element.setAttribute("disabled", "")
    })
    const loadingBox = await shell.boundingBox()
    const loadingAction = await submit.boundingBox()
    await page.locator("[data-portal-status]").evaluate((element) => {
      element.removeAttribute("hidden")
    })
    const connectedBox = await shell.boundingBox()
    const connectedAction = await submit.boundingBox()
    await page.locator("[data-portal-status]").evaluate((element) => {
      element.setAttribute("hidden", "")
    })
    await page.locator("[data-rotated-token-section]").evaluate((element) => {
      element.removeAttribute("hidden")
    })
    const tokenResultBox = await shell.boundingBox()
    const tokenResultAction = await submit.boundingBox()

    // Then
    for (const box of [initialBox, loadingBox, connectedBox, tokenResultBox]) {
      expect(box).not.toBeNull()
      expect(box?.y).toBeCloseTo(16, 0)
    }
    if (initialAction === null) throw new Error("Management action has no layout box")
    for (const action of [loadingAction, connectedAction, tokenResultAction]) {
      expect(action).not.toBeNull()
      expect(Math.abs((action?.y ?? 0) - initialAction.y)).toBeLessThanOrEqual(8)
    }
  } finally {
    await app.close()
  }
})
