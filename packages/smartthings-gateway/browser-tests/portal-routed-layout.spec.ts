import { expect, test } from "@playwright/test"
import type { FastifyInstance } from "fastify"
import { createGatewayAppFixture } from "../tests/fixtures/gateway-app-fixture.js"

const publicPagePaths = [
  { hasPortalShell: true, value: "/" },
  { hasPortalShell: true, value: "/status" },
  { hasPortalShell: true, value: "/manage" },
  { hasPortalShell: true, value: "/support" },
  { hasPortalShell: true, value: "/privacy" },
  { hasPortalShell: true, value: "/terms" },
  { hasPortalShell: true, value: "/missing-page" },
  { hasPortalShell: false, value: "/oauth/start" },
  { hasPortalShell: false, value: "/oauth/callback" },
] as const

test("public portal and OAuth pages share the top safe-area baseline", async ({ page }) => {
  // Given
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  await page.setViewportSize({ height: 1_600, width: 1_280 })

  try {
    for (const path of publicPagePaths) {
      // When
      await page.goto(`${origin}${path.value}`)
      const layout = await page
        .locator("body > main, body > .portal-page-shell")
        .evaluate((shell) => {
          const bodyStyle = getComputedStyle(shell.ownerDocument.body)
          return {
            paddingBlockStart: Number.parseFloat(bodyStyle.paddingBlockStart),
            shellBlockStart: shell.getBoundingClientRect().top,
          }
        })

      // Then
      expect(layout.shellBlockStart, path.value).toBeCloseTo(layout.paddingBlockStart, 0)
      if (path.hasPortalShell) {
        await page.keyboard.press("Tab")
        const skipLink = page.locator(".skip-link")
        await expect(skipLink).toBeFocused()
        await expect(skipLink).toHaveCSS("outline-style", "solid")
        await page.keyboard.press("Enter")
        await expect(page.locator("main#main-content")).toBeFocused()
      }
    }
  } finally {
    await app.close()
  }
})

test("portal shell keeps tablet navigation and the home journey compact", async ({ page }) => {
  // Given
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })

  try {
    for (const viewport of [
      { expectedColumns: 3, expectedDirection: "row", width: 768 },
      { expectedColumns: 1, expectedDirection: "column", width: 640 },
      { expectedColumns: 1, expectedDirection: "column", width: 375 },
    ] as const) {
      await page.setViewportSize({ height: 1_024, width: viewport.width })

      // When
      await page.goto(origin)
      const actionDirection = await page
        .locator(".action-row")
        .evaluate((element) => getComputedStyle(element).flexDirection)
      const flowColumns = await page
        .locator(".flow ol")
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
      const footerColumns = await page
        .locator(".site-footer")
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
      const navigationDirection = await page
        .locator(".site-nav")
        .evaluate((element) => getComputedStyle(element).flexDirection)
      const pageWidth = await page.locator("html").evaluate((html) => ({
        documentWidth: html.scrollWidth,
        viewportWidth: html.clientWidth,
      }))

      // Then
      expect(navigationDirection, `${viewport.width}px navigation`).toBe(viewport.expectedDirection)
      expect(actionDirection, `${viewport.width}px actions`).toBe(viewport.expectedDirection)
      expect(footerColumns, `${viewport.width}px footer`).toBe(
        viewport.expectedDirection === "row" ? 2 : 1,
      )
      expect(flowColumns, `${viewport.width}px home journey`).toBe(viewport.expectedColumns)
      expect(pageWidth.documentWidth).toBeLessThanOrEqual(pageWidth.viewportWidth)
    }
  } finally {
    await app.close()
  }
})

test("200 percent zoom keeps status summary regions from overlapping", async ({ page }) => {
  // Given
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  await page.setViewportSize({ height: 800, width: 640 })

  try {
    await page.goto(`${origin}/status`)
    const readinessSummary = await page.locator(".current-status > div").first().boundingBox()
    const statusCheck = await page.locator(".status-check").boundingBox()

    // When
    const pageWidth = await page.locator("html").evaluate((html) => ({
      documentWidth: html.scrollWidth,
      viewportWidth: html.clientWidth,
    }))

    // Then
    if (readinessSummary === null || statusCheck === null) {
      throw new Error("Status summary regions have a missing browser layout box")
    }
    expect(statusCheck.y).toBeGreaterThanOrEqual(readinessSummary.y + readinessSummary.height)
    expect(pageWidth.documentWidth).toBeLessThanOrEqual(pageWidth.viewportWidth)
  } finally {
    await app.close()
  }
})

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

test("forced colors preserve current-menu and primary-action boundaries", async ({ page }) => {
  // Given
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  await page.setViewportSize({ height: 844, width: 390 })
  await page.emulateMedia({ forcedColors: "active" })

  try {
    // When
    await page.goto(`${origin}/manage`)

    // Then
    const currentMenu = page.locator('.nav-list a[aria-current="page"]')
    await expect(currentMenu).toHaveCSS("border-top-style", "solid")
    await expect(currentMenu).toHaveCSS("border-top-width", "2px")
    const primaryButton = page.locator("[data-token-submit]")
    await expect(primaryButton).toHaveCSS("border-top-style", "solid")
    await expect(primaryButton).toHaveCSS("border-top-width", "2px")

    await page.goto(origin)
    const primaryAction = page.locator(".action-primary")
    await expect(primaryAction).toHaveCSS("border-top-style", "solid")
    await expect(primaryAction).toHaveCSS("border-top-width", "2px")
  } finally {
    await app.close()
  }
})
