import { expect, test } from "@playwright/test"
import { portalClientScript } from "../src/http/portal-client.js"
import { renderPortalManagement } from "../src/http/portal-manage.js"
import { tokenSafetyClientScript } from "../src/http/token-safety.js"

const managementViewports = [
  { height: 812, width: 375 },
  { height: 1024, width: 768 },
  { height: 900, width: 1280 },
] as const

const managementColorSchemes = ["light", "dark"] as const

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

for (const viewport of managementViewports) {
  for (const colorScheme of managementColorSchemes) {
    test(`management disconnect keeps status checking available at ${viewport.width}px in ${colorScheme} mode`, async ({
      page,
    }) => {
      // Given
      const firstToken = `grw_st_${"A".repeat(43)}`
      const replacementToken = `grw_st_${"B".repeat(43)}`
      let statusRequests = 0
      let replacementTokenUsed = false
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.route("https://growful.test/**", async (route) => {
        const { pathname } = new URL(route.request().url())
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
        if (pathname === "/connection" && route.request().method() === "DELETE") {
          await route.fulfill({ status: 204 })
          return
        }
        if (pathname === "/connection") {
          statusRequests += 1
          const { authorization } = route.request().headers()
          replacementTokenUsed ||= authorization === `Bearer ${replacementToken}`
          await route.fulfill({
            json: {
              connected: true,
              expiresAt: "2026-07-23T00:00:00.000Z",
              grantedScopes: [],
              lastRefreshedAt: null,
              serviceAccess: { status: "active" },
              supportReference: "d".repeat(64),
            },
          })
          return
        }
        await route.abort()
      })
      await page.goto("https://growful.test/manage")
      const input = page.locator("#growful-token")
      const submit = page.locator("[data-token-submit]")
      const initialAction = await submit.boundingBox()
      await input.fill(firstToken)
      await submit.click()
      await expect(page.locator("[data-portal-status]")).toBeVisible()

      // When
      await page.locator("[data-disconnect]").click()
      await page.locator("[data-disconnect-confirm]").click()

      // Then
      await expect(page.locator("[data-portal-feedback]")).toHaveText(
        "Growful에 저장된 연결과 토큰을 삭제했습니다.",
      )
      await expect(input).toBeFocused()
      await expect(submit).toBeVisible()
      await expect(submit).toHaveText("연결 상태 확인")
      await expect(page.locator("[data-reconnect]")).toBeVisible()
      const disconnectedAction = await submit.boundingBox()
      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      )
      if (initialAction === null || disconnectedAction === null) {
        throw new Error("Management status action has a missing browser layout box")
      }
      expect(
        Math.abs(disconnectedAction.y - initialAction.y),
        `initial action y=${initialAction.y}, disconnected action y=${disconnectedAction.y}`,
      ).toBeLessThanOrEqual(8)
      expect(hasHorizontalOverflow).toBe(false)

      // When
      await page.keyboard.type(replacementToken)
      await page.keyboard.press("Tab")
      await expect(page.locator("[data-token-visibility]")).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(submit).toBeFocused()
      await page.keyboard.press("Enter")

      // Then
      await expect(page.locator("[data-portal-status]")).toBeVisible()
      await expect(page.locator("[data-portal-feedback]")).toHaveText("연결 상태를 확인했습니다.")
      expect(statusRequests).toBe(2)
      expect(replacementTokenUsed).toBe(true)
    })
  }
}
