import { expect, type Page, test } from "@playwright/test"
import {
  type OAuthStartErrorKind,
  oauthStartErrorKinds,
  renderOAuthStartError,
} from "../src/http/oauth-start-error.js"

const errorUrl = "http://gateway.test/oauth/start"

async function openErrorPage(page: Page, kind: OAuthStartErrorKind): Promise<void> {
  await page.route(errorUrl, async (route) => {
    await route.fulfill({
      body: renderOAuthStartError(kind),
      contentType: "text/html; charset=utf-8",
      status: 500,
    })
  })
  await page.goto(errorUrl)
}

for (const width of [320, 375]) {
  test(`OAuth start recovery is focused and keyboard-usable at ${width}px`, async ({ page }) => {
    // Given
    await page.setViewportSize({ height: 720, width })

    // When
    await openErrorPage(page, oauthStartErrorKinds.internal)

    // Then
    await expect(page.locator(".error-summary")).toBeFocused()
    await expect(page.locator(".error-summary")).toHaveCSS("outline-style", "solid")
    await expect(page.locator(".error-summary")).toHaveAttribute("aria-labelledby", "error-title")
    await expect(page.locator(".error-summary")).toHaveAttribute("tabindex", "-1")
    await expect(page.locator('[role="alert"]')).toHaveCount(0)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("연결을 시작하지 못했습니다")
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("다음 행동")
    await expect(page.getByRole("link", { name: "권한 선택 다시 시작" })).toBeVisible()
    await expect(page.getByRole("link", { name: "서비스 안내" })).toBeVisible()
    await expect(page.getByRole("link", { name: "지원 안내" })).toBeVisible()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: "권한 선택 다시 시작" })).toBeFocused()
    const dimensions = await page.locator("html").evaluate((html) => ({
      clientWidth: html.clientWidth,
      scrollWidth: html.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  })
}

test("OAuth start recovery remains usable at 200 percent zoom", async ({ page }) => {
  // Given
  await page.setViewportSize({ height: 360, width: 160 })

  // When
  await openErrorPage(page, oauthStartErrorKinds.invalidOrigin)

  // Then
  await expect(page.locator(".error-summary")).toBeFocused()
  await expect(page.getByRole("link", { name: "권한 선택 다시 시작" })).toBeVisible()
  const overflowingElements = await page.locator("body *").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const bounds = element.getBoundingClientRect()
        return (
          bounds.left < -1 || bounds.right > element.ownerDocument.documentElement.clientWidth + 1
        )
      })
      .map((element) => ({
        className: element.getAttribute("class") ?? "",
        tagName: element.tagName,
      })),
  )
  expect(overflowingElements).toEqual([])
})

test("forced colors preserve the OAuth start primary action boundary", async ({ page }) => {
  // Given
  await page.setViewportSize({ height: 844, width: 375 })
  await page.emulateMedia({ forcedColors: "active" })

  // When
  await openErrorPage(page, oauthStartErrorKinds.rateLimited)

  // Then
  await expect(page.locator("time")).toHaveCount(0)
  await expect(page.getByText("잠시 후 권한 선택을 다시 시작할 수 있습니다.")).toBeVisible()
  const primaryAction = page.getByRole("link", { name: "서비스 안내" })
  await expect(primaryAction).toHaveCSS("border-top-style", "solid")
  await expect(primaryAction).toHaveCSS("border-top-width", "2px")
  await page.keyboard.press("Tab")
  await expect(primaryAction).toBeFocused()
  await expect(page.getByRole("link", { name: "권한 선택 다시 시작" })).toHaveClass("secondary")
})
