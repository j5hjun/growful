import { expect, test } from "@playwright/test"
import type { FastifyInstance } from "fastify"
import {
  authorizeGatewayApp,
  createGatewayAppFixture,
  gatewayRedirectOrigin,
} from "../tests/fixtures/gateway-app-fixture.js"

test("the complete routed HTML matrix shares one stable outer shell and accessible reflow", async ({
  page,
}) => {
  // Given
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const regularRoutes = [
    { bodyWidth: "wide", currentCount: 1, label: "home", url: "/" },
    { bodyWidth: "manage", currentCount: 1, label: "manage", url: "/manage" },
    { bodyWidth: "manage", currentCount: 1, label: "status", url: "/status" },
    { bodyWidth: "manage", currentCount: 1, label: "support", url: "/support" },
    { bodyWidth: "manage", currentCount: 1, label: "privacy", url: "/privacy" },
    { bodyWidth: "manage", currentCount: 1, label: "terms", url: "/terms" },
    { bodyWidth: "manage", currentCount: 0, label: "browser 404", url: "/missing-page" },
  ] as const

  try {
    const regularPages = await Promise.all(
      regularRoutes.map(async (route) => ({
        ...route,
        headerVariant: "standard" as const,
        response: await app.inject({
          headers: { accept: "text/html,application/xhtml+xml" },
          method: "GET",
          url: route.url,
        }),
      })),
    )
    const scopeSelection = await app.inject({ method: "GET", url: "/oauth/start" })
    const invalidSelection = await app.inject({
      headers: {
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all",
      url: "/oauth/start",
    })
    const startFailure = await app.inject({
      headers: {
        accept: "text/html",
        "content-type": "text/plain",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: "invalid-start",
      url: "/oauth/start",
    })
    const callbackError = await app.inject({
      method: "GET",
      url: "/oauth/callback?code=missing-state",
    })
    const callbackSuccess = await authorizeGatewayApp(app)
    const taskPages = [
      { autofocus: false, label: "OAuth scope", response: scopeSelection },
      { autofocus: true, label: "OAuth invalid POST", response: invalidSelection },
      { autofocus: true, label: "OAuth start failure", response: startFailure },
      { autofocus: false, label: "OAuth callback error", response: callbackError },
      { autofocus: false, label: "OAuth completion", response: callbackSuccess },
    ].map((entry) => ({
      ...entry,
      bodyWidth: "panel" as const,
      currentCount: 1 as const,
      headerVariant: "task" as const,
    }))
    const routedPages = [...regularPages, ...taskPages]

    for (const viewportWidth of [320, 375, 768, 1_280] as const) {
      await page.setViewportSize({ height: 1_600, width: viewportWidth })
      const expectedGutter =
        viewportWidth === 320 ? 12 : viewportWidth === 375 ? 16 : viewportWidth === 768 ? 24 : 32
      const expectedPageTitleSpacing = viewportWidth <= 640 ? 24 : 48
      const expectedSectionGap = viewportWidth <= 640 ? 24 : 32
      const expectedShellLeft = Math.max(expectedGutter, (viewportWidth - 1_024) / 2)
      let sharedShellLeft: number | undefined
      let sharedShellWidth: number | undefined

      for (const routedPage of routedPages) {
        // When
        await page.setContent(routedPage.response.body)
        await page.evaluate(() => window.scrollTo(0, 0))
        const layout = await page.locator("[data-page-shell]").evaluate((shell) => {
          const bodyStyle = getComputedStyle(shell.ownerDocument.body)
          const headerBounds = shell.querySelector(".site-header")?.getBoundingClientRect()
          const mainBounds = shell.querySelector("main")?.getBoundingClientRect()
          const shellBounds = shell.getBoundingClientRect()
          const visibleElements = [...shell.querySelectorAll("*")].filter((element) => {
            const bounds = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              bounds.width > 0 &&
              bounds.height > 0
            )
          })
          return {
            clippedContentCount: visibleElements.filter((element) => {
              const style = getComputedStyle(element)
              const clipsX = style.overflowX === "hidden" || style.overflowX === "clip"
              const clipsY = style.overflowY === "hidden" || style.overflowY === "clip"
              return (
                (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                (clipsY && element.scrollHeight > element.clientHeight + 1)
              )
            }).length,
            currentCount: shell.querySelectorAll('[aria-current="page"]').length,
            documentWidth: shell.ownerDocument.documentElement.scrollWidth,
            headerHeight: headerBounds?.height ?? 0,
            mainWidth: mainBounds?.width ?? 0,
            paddingBlockStart: Number.parseFloat(bodyStyle.paddingBlockStart),
            paddingInlineStart: Number.parseFloat(bodyStyle.paddingInlineStart),
            offscreenContentCount: visibleElements.filter((element) => {
              const bounds = element.getBoundingClientRect()
              return (
                bounds.left < -1 ||
                bounds.right > shell.ownerDocument.documentElement.clientWidth + 1
              )
            }).length,
            shellBlockStart: shellBounds.top,
            shellLeft: shellBounds.left,
            shellWidth: shellBounds.width,
            viewportWidth: shell.ownerDocument.documentElement.clientWidth,
          }
        })
        const minimumTargetHeight = await page.locator("body").evaluate(() => {
          const targets = [
            ...document.querySelectorAll(
              ".skip-link, .brand, .nav-list a, .footer-nav-list a, .footer-meta a, .action, .primary, .secondary, .touch-link, [data-action], button, summary, textarea, input:not([type=checkbox]):not([type=radio]), label:has(input)",
            ),
          ].filter((element) => {
            const style = getComputedStyle(element)
            const bounds = element.getBoundingClientRect()
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              bounds.width > 0 &&
              bounds.height > 0
            )
          })
          return {
            height: Math.min(...targets.map((element) => element.getBoundingClientRect().height)),
            width: Math.min(...targets.map((element) => element.getBoundingClientRect().width)),
          }
        })
        const pageTitleSpacing = await page.locator(".page-title").evaluate((pageTitle) => {
          const style = getComputedStyle(pageTitle)
          return {
            end: Number.parseFloat(style.paddingBlockEnd),
            start: Number.parseFloat(style.paddingBlockStart),
          }
        })

        // Then
        await expect(page.locator(".skip-link"), routedPage.label).toHaveCount(1)
        await expect(page.locator("header.site-header"), routedPage.label).toHaveCount(1)
        await expect(page.locator("main#main-content"), routedPage.label).toHaveCount(1)
        await expect(page.locator("main h1"), routedPage.label).toHaveCount(1)
        await expect(page.locator("footer.site-footer"), routedPage.label).toHaveCount(1)
        await expect(page.locator("[data-page-shell]"), routedPage.label).toHaveAttribute(
          "data-body-width",
          routedPage.bodyWidth,
        )
        await expect(page.locator(".site-header"), routedPage.label).toHaveAttribute(
          "data-header-variant",
          routedPage.headerVariant,
        )
        expect(layout.currentCount, routedPage.label).toBe(routedPage.currentCount)
        expect(layout.paddingInlineStart, routedPage.label).toBe(expectedGutter)
        expect(layout.shellLeft, routedPage.label).toBeCloseTo(expectedShellLeft, 0)
        expect(layout.shellBlockStart, routedPage.label).toBeCloseTo(layout.paddingBlockStart, 0)
        expect(layout.documentWidth, routedPage.label).toBeLessThanOrEqual(layout.viewportWidth)
        expect(layout.shellWidth, routedPage.label).toBeLessThanOrEqual(1_024)
        expect(layout.headerHeight, routedPage.label).toBeGreaterThanOrEqual(
          viewportWidth <= 640 ? 56 : 64,
        )
        expect(pageTitleSpacing.start, routedPage.label).toBe(expectedPageTitleSpacing)
        expect(pageTitleSpacing.end, routedPage.label).toBe(expectedPageTitleSpacing)
        expect(layout.mainWidth, routedPage.label).toBeLessThanOrEqual(
          routedPage.bodyWidth === "panel" ? 544 : routedPage.bodyWidth === "manage" ? 672 : 1_024,
        )
        expect(layout.offscreenContentCount, routedPage.label).toBe(0)
        expect(layout.clippedContentCount, routedPage.label).toBe(0)
        expect(minimumTargetHeight.height, routedPage.label).toBeGreaterThanOrEqual(44)
        expect(minimumTargetHeight.width, routedPage.label).toBeGreaterThanOrEqual(44)
        sharedShellLeft ??= layout.shellLeft
        sharedShellWidth ??= layout.shellWidth
        expect(layout.shellLeft, routedPage.label).toBeCloseTo(sharedShellLeft, 0)
        expect(layout.shellWidth, routedPage.label).toBeCloseTo(sharedShellWidth, 0)

        if (routedPage.label === "home") {
          const flowSpacing = await page.locator(".flow").evaluate((flow) => {
            const flowStyle = getComputedStyle(flow)
            const heading = flow.querySelector("h2")
            if (!heading) throw new Error("home flow heading is missing")
            return {
              headingMargin: Number.parseFloat(getComputedStyle(heading).marginBlockEnd),
              paddingEnd: Number.parseFloat(flowStyle.paddingBlockEnd),
              paddingStart: Number.parseFloat(flowStyle.paddingBlockStart),
            }
          })
          expect(flowSpacing.paddingStart).toBe(expectedSectionGap)
          expect(flowSpacing.paddingEnd).toBe(expectedSectionGap)
          expect(flowSpacing.headingMargin).toBe(expectedSectionGap)
        }
        if (routedPage.label === "OAuth start failure") {
          const recoverySpacing = await page.locator(".recovery").evaluate((recovery) => {
            const style = getComputedStyle(recovery)
            return {
              margin: Number.parseFloat(style.marginBlockStart),
              padding: Number.parseFloat(style.paddingBlockStart),
            }
          })
          expect(recoverySpacing.margin).toBe(expectedSectionGap)
          expect(recoverySpacing.padding).toBe(expectedSectionGap)
        }
        if (routedPage.label === "OAuth callback error") {
          const callbackSectionPadding = await page
            .locator("main > section")
            .evaluate((section) => Number.parseFloat(getComputedStyle(section).paddingBlockStart))
          expect(callbackSectionPadding).toBe(expectedSectionGap)
        }
        if (routedPage.label === "OAuth completion") {
          const completionSectionMargins = await page
            .locator("main > section")
            .evaluateAll((sections) =>
              sections.map((section) =>
                Number.parseFloat(getComputedStyle(section).marginBlockStart),
              ),
            )
          const quickstartPadding = await page
            .locator(".api-quickstart")
            .evaluate((section) => Number.parseFloat(getComputedStyle(section).paddingBlockStart))
          expect(completionSectionMargins).toEqual([expectedSectionGap, expectedSectionGap])
          expect(quickstartPadding).toBe(expectedSectionGap)
        }

        const skipLink = page.locator(".skip-link")
        if ("autofocus" in routedPage && routedPage.autofocus) {
          await expect(page.locator(".error-summary"), routedPage.label).toHaveAttribute(
            "autofocus",
            "",
          )
          await page.locator(".error-summary").focus()
          await expect(page.locator(".error-summary"), routedPage.label).toBeFocused()
          for (let step = 0; step < 4; step += 1) await page.keyboard.press("Shift+Tab")
          await expect(skipLink, routedPage.label).toBeFocused()
        } else {
          await page.evaluate(() => {
            document.body.tabIndex = -1
            document.body.focus()
          })
          await page.keyboard.press("Tab")
          await expect(skipLink, routedPage.label).toBeFocused()
        }
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

test("the 640px reflow surrogate keeps status summary regions from overlapping", async ({
  page,
}) => {
  // Given
  // This viewport reduction is a layout surrogate; verify actual 200% browser zoom manually after deployment.
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

test("status readiness and support links remain at least 44px at narrow widths", async ({
  page,
}) => {
  // Given
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })

  try {
    for (const width of [320, 375] as const) {
      await page.setViewportSize({ height: 900, width })

      // When
      await page.goto(`${origin}/status`)
      const readinessLink = page.locator('main a[href="/readyz"]')
      const supportLink = page.locator('main a[href="/support"]')
      const managementLink = page.locator('main a[href="/manage"]').last()
      const topStatusLink = page.locator('.nav-list a[href="/status"]')

      // Then
      for (const [label, link] of [
        ["/readyz", readinessLink],
        ["support", supportLink],
        ["manage", managementLink],
        ["top status", topStatusLink],
      ] as const) {
        const bounds = await link.boundingBox()
        expect(bounds?.height, `${width}px ${label} height`).toBeGreaterThanOrEqual(44)
        expect(bounds?.width, `${width}px ${label} width`).toBeGreaterThanOrEqual(44)
      }
    }
  } finally {
    await app.close()
  }
})

test("routed management states keep the shared shell pinned to the top safe area", async ({
  page,
}) => {
  // Given
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  await page.setViewportSize({ height: 1_600, width: 1_280 })

  try {
    await page.goto(`${origin}/manage`)
    const shell = page.locator("[data-page-shell]")
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
      expect(box?.y).toBeCloseTo(32, 0)
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
