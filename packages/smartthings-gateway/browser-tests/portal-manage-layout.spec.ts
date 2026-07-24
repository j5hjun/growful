import { expect, test } from "@playwright/test"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { portalClientScript } from "../src/http/portal-client.js"
import { renderPortalManagement } from "../src/http/portal-manage.js"
import { tokenSafetyClientScript } from "../src/http/token-safety.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"

function portalAccess() {
  return {
    mode: "public" as const,
    operatorName: "Growful QA",
    policyVersion: "qa-policy",
    privacyPolicyUrl: new URL("https://growful.click/privacy"),
    supportEmail: "support@growful.click",
    termsUrl: new URL("https://growful.click/terms"),
  }
}

test("management Korean error text wraps between words without splitting syllables", async ({
  page,
}) => {
  // Given
  await page.setViewportSize({ height: 812, width: 375 })
  await page.setContent(renderPortalManagement(portalAccess()))
  const errorMessage = page.locator("[data-portal-error-message]")
  await errorMessage.evaluate((element) => {
    element.textContent = "토큰이 교체되었거나 만료되었습니다. 새 Growful 토큰을 입력하세요."
    element.parentElement?.removeAttribute("hidden")
  })

  // When
  const splitWords = await errorMessage.evaluate((paragraph) => {
    const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const splitWords: string[] = []

    for (let textNode = walker.nextNode(); textNode !== null; textNode = walker.nextNode()) {
      const text = textNode.textContent ?? ""
      for (const match of text.matchAll(/[가-힣]+/gu)) {
        const start = match.index
        if (start === undefined) continue
        const range = paragraph.ownerDocument.createRange()
        range.setStart(textNode, start)
        range.setEnd(textNode, start + match[0].length)
        if (range.getClientRects().length > 1) splitWords.push(match[0])
      }
    }

    return splitWords
  })

  // Then
  expect(splitWords).toEqual([])
})

test("management form stays content-sized at supported mobile and desktop widths", async ({
  page,
}) => {
  for (const width of [320, 360, 390, 768, 1_280]) {
    // Given
    await page.setViewportSize({ height: 1_024, width })
    await page.emulateMedia({ colorScheme: "dark" })
    await page.setContent(renderPortalManagement(portalAccess()))
    const form = page.locator("[data-portal-token-form]")
    const actionSlot = page.locator(".connection-action-slot")
    const submit = page.locator("[data-token-submit]")
    const reveal = page.locator("[data-token-visibility]")
    const input = page.locator("#growful-token")
    const hint = page.locator("#token-hint")

    // When
    const grid = await form.evaluate((element) => {
      const style = getComputedStyle(element)
      return { minBlockSize: style.minBlockSize, rows: style.gridTemplateRows.split(" ") }
    })
    const actionRows = await actionSlot.evaluate((element) =>
      getComputedStyle(element).gridTemplateRows.split(" "),
    )
    const inputBox = await input.boundingBox()
    const revealBox = await reveal.boundingBox()
    const hintBox = await hint.boundingBox()
    const actionBox = await submit.boundingBox()
    const dimensions = await page.locator("html").evaluate((html) => ({
      clientWidth: html.clientWidth,
      scrollWidth: html.scrollWidth,
    }))

    // Then
    expect(grid.rows).toHaveLength(3)
    expect(grid.minBlockSize).toBe("0px")
    expect(actionRows).toHaveLength(1)
    if (inputBox === null || revealBox === null || hintBox === null || actionBox === null) {
      throw new Error(`Management controls have a missing layout box at ${width}px`)
    }
    if (width <= 360) {
      expect(revealBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height)
      expect(revealBox.width).toBeCloseTo(inputBox.width, 0)
    } else {
      expect(revealBox.y).toBeCloseTo(inputBox.y, 0)
      expect(revealBox.width).toBeLessThan(inputBox.width)
    }
    expect(actionBox.y - (hintBox.y + hintBox.height), `${width}px guidance-to-action gap`).toBe(16)
    expect(revealBox.height).toBeGreaterThanOrEqual(44)
    expect(actionBox.height).toBeGreaterThanOrEqual(44)
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    await expect(input).toHaveAttribute("aria-describedby", "token-hint management-token-error")
  }
})

test("management token errors remain part of the input description", async ({ page }) => {
  // Given
  await page.setViewportSize({ height: 480, width: 320 })
  await page.setContent(renderPortalManagement(portalAccess()))
  const input = page.locator("#growful-token")
  const errorMessage = page.locator("#management-token-error")

  // When
  await errorMessage.evaluate((element) => {
    element.textContent = "네트워크 연결을 확인하세요."
    element.parentElement?.removeAttribute("hidden")
  })

  // Then
  await expect(page.locator("#token-hint")).toBeVisible()
  await expect(errorMessage).toBeVisible()
  const describedBy = (await input.getAttribute("aria-describedby"))?.split(/\s+/u)
  expect(describedBy).toEqual(["token-hint", "management-token-error"])
})

test("one-time token flows confirm rotation and keep recovery navigation available", async ({
  page,
}) => {
  // Given
  const tokenA = `grw_st_${"A".repeat(43)}`
  const tokenB = `grw_st_${"B".repeat(43)}`
  let rotationRequests = 0
  let holdStatusRefresh = false
  let releaseStatusRefresh: (() => void) | undefined
  const statusRefreshGate = new Promise<void>((resolve) => {
    releaseStatusRefresh = resolve
  })
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText() {
          if ((globalThis as typeof globalThis & { clipboardFailure?: boolean }).clipboardFailure) {
            throw new Error("clipboard unavailable")
          }
        },
      },
    })
  })
  await page.route("https://growful.test/**", async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === "/oauth") {
      await route.fulfill({
        body: renderOAuthCompletion(GrowfulTokenSchema.parse(tokenA)),
        contentType: "text/html",
      })
      return
    }
    if (pathname === "/manage") {
      await route.fulfill({
        body: renderPortalManagement(portalAccess()),
        contentType: "text/html",
      })
      return
    }
    if (pathname === "/portal.js") {
      await route.fulfill({ body: portalClientScript, contentType: "text/javascript" })
      return
    }
    if (pathname === "/token-safety.js") {
      await route.fulfill({ body: tokenSafetyClientScript, contentType: "text/javascript" })
      return
    }
    if (pathname === "/connection") {
      if (holdStatusRefresh) await statusRefreshGate
      await route.fulfill({
        json: {
          connected: true,
          expiresAt: "2026-07-23T00:00:00.000Z",
          grantedScopes: [],
          lastRefreshedAt: null,
          serviceAccess: { status: "active" },
          supportReference: "c".repeat(64),
        },
      })
      return
    }
    if (pathname === "/token/rotate") {
      rotationRequests += 1
      await route.fulfill({ json: { growfulToken: tokenB } })
      return
    }
    await route.abort()
  })
  await page.goto("https://growful.test/manage")
  await page.locator("#growful-token").fill(tokenA)
  await page.locator("[data-token-submit]").click()
  await expect(page.locator("[data-portal-status]")).toBeVisible()

  // When
  await page.locator("[data-rotate-token]").click()

  // Then
  const dialog = page.locator("[data-rotate-token-dialog]")
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("현재 토큰은 즉시 무효화됩니다")
  await expect(dialog).toContainText("모든 소비자 설정을 새 토큰으로 변경해야 합니다")
  expect(rotationRequests).toBe(0)

  // When
  await page.locator("[data-rotate-token-confirm]").click()

  // Then
  const result = page.locator("[data-rotated-token-section]")
  await expect(result).toBeVisible()
  await expect(page.locator("[data-portal-status]")).toBeHidden()
  await expect(page.locator("[data-rotated-token]")).toHaveText(tokenB)
  expect(rotationRequests).toBe(1)
  await expect(result.locator("[data-copy-token]")).toHaveClass(/primary/)
  await expect(result.locator("[data-return-status]")).toHaveClass(/secondary/)

  // When
  await result.locator("[data-copy-token]").click()
  await expect(result.locator("[data-token-copy-feedback]")).toBeVisible()
  await page.locator("[data-return-status]").click()

  // Then
  await expect(result).toBeHidden()
  await expect(page.locator("[data-rotated-token]")).toHaveText("")
  await expect(page.locator("[data-portal-status]")).toBeFocused()

  // When
  await page.locator("[data-rotate-token]").click()
  await page.locator("[data-rotate-token-confirm]").click()
  await expect(result).toBeVisible()
  await result.locator("[data-copy-token]").click()
  await expect(result).toHaveAttribute("data-token-safety-acknowledged", "")
  holdStatusRefresh = true
  await page.locator("[data-token-submit]").click()

  // Then
  await expect(result).toBeVisible()
  releaseStatusRefresh?.()
  await expect(result).toBeHidden()
  await expect(page.locator("[data-rotated-token]")).toHaveText("")
  await expect(page.locator("[data-portal-status]")).toBeVisible()
  expect(rotationRequests).toBe(2)

  // When
  await page.goto("https://growful.test/oauth")
  await page.keyboard.press("Tab")

  // Then
  const oauthCopy = page.locator("[data-copy-token]")
  const manageAction = page.locator("[data-action=manage-issued-token]")
  await expect(oauthCopy).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(manageAction).toBeFocused()
  await oauthCopy.click()
  await expect(page.locator("[data-token-copy-feedback]")).toBeVisible()

  // When
  await page.evaluate(() => {
    ;(globalThis as typeof globalThis & { clipboardFailure?: boolean }).clipboardFailure = true
  })
  await oauthCopy.click()

  // Then
  await expect(page.locator("[data-token-copy-error]")).toBeVisible()
  await expect(page.locator("[data-token-value]")).toBeFocused()
  await expect(page.locator("[data-token-value]")).toHaveCSS("outline-style", "solid")
  await manageAction.click()
  await expect(page).toHaveURL("https://growful.test/manage")
})
