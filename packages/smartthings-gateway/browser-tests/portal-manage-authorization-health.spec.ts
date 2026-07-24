import { expect, test } from "@playwright/test"
import { portalClientScript } from "../src/http/portal-client.js"
import { renderPortalManagement } from "../src/http/portal-manage.js"

const growfulToken = `grw_st_${"R".repeat(43)}`

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

test("reauthorization recovery is keyboard reachable, responsive, and forced-colors visible", async ({
  page,
}) => {
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
    if (pathname === "/connection") {
      await route.fulfill({
        json: {
          authorizationHealth: { status: "reauthorization_required" },
          connected: true,
          expiresAt: "2026-07-23T00:00:00.000Z",
          grantedScopes: ["r:devices:*"],
          lastRefreshedAt: null,
          serviceAccess: { status: "active" },
          supportReference: "a".repeat(64),
        },
      })
      return
    }
    await route.abort()
  })

  for (const width of [160, 320, 375, 390, 640, 768, 1_280]) {
    await page.setViewportSize({ height: 900, width })
    await page.goto("https://growful.test/manage")
    await page.locator("#growful-token").fill(growfulToken)
    await page.locator("[data-token-submit]").click()

    const notice = page.locator("[data-reauthorization-notice]")
    const namedAlert = page.getByRole("alert", {
      name: "SmartThings 연결을 다시 승인해 주세요",
    })
    const reconnect = notice.getByRole("link", { name: "SmartThings 다시 연결" })
    await expect(page.locator("[data-portal-status]")).toBeFocused()
    await expect(page.locator("[data-status-reauthorization]")).toHaveText(
      "API 사용 불가 · 다시 연결 필요",
    )
    await expect(namedAlert).toBeVisible()
    await expect(notice.getByText("인증 갱신 필요", { exact: true })).toBeVisible()
    await expect(
      notice.getByRole("heading", { name: "SmartThings 연결을 다시 승인해 주세요" }),
    ).toBeVisible()
    await expect(notice).toContainText(
      "SmartThings 인증이 만료되었거나 회수되어 API 요청을 사용할 수 없습니다. 다시 연결하면 새 Growful 토큰이 발급되고 현재 토큰은 사용할 수 없게 됩니다. 새 토큰으로 소비자 설정을 업데이트하세요.",
    )
    await expect(reconnect).toHaveAttribute("href", "/oauth/start")
    await expect(page.locator("[data-rotate-token]")).toBeHidden()
    await expect(page.locator("[data-disconnect]")).toBeVisible()

    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
    await expect(reconnect).toBeFocused()

    const reconnectBox = await reconnect.boundingBox()
    const noticeBox = await notice.boundingBox()
    if (reconnectBox === null || noticeBox === null) {
      throw new Error(`Missing reauthorization layout box at ${width}px`)
    }
    expect(reconnectBox.height).toBeGreaterThanOrEqual(44)
    const dimensions = await page.locator("html").evaluate((html) => ({
      clientWidth: html.clientWidth,
      scrollWidth: html.scrollWidth,
    }))
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
          text: (element.textContent ?? "").trim().slice(0, 80),
        })),
    )
    expect(
      dimensions.scrollWidth,
      `${width}px overflowing elements: ${JSON.stringify(overflowingElements)}`,
    ).toBeLessThanOrEqual(dimensions.clientWidth)
    expect(noticeBox.x).toBeGreaterThanOrEqual(-1)
    expect(noticeBox.x + noticeBox.width).toBeLessThanOrEqual(dimensions.clientWidth + 1)
    expect(reconnectBox.x).toBeGreaterThanOrEqual(-1)
    expect(reconnectBox.x + reconnectBox.width).toBeLessThanOrEqual(dimensions.clientWidth + 1)
  }

  await page.emulateMedia({ forcedColors: "active" })
  const reconnect = page
    .locator("[data-reauthorization-notice]")
    .getByRole("link", { name: "SmartThings 다시 연결" })
  await expect(reconnect).toHaveCSS("border-top-style", "solid")
  await expect(reconnect).toHaveCSS("border-top-width", "2px")
})

test("operator block takes precedence over simultaneous reauthorization health", async ({
  page,
}) => {
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
    if (pathname === "/connection") {
      await route.fulfill({
        json: {
          authorizationHealth: { status: "reauthorization_required" },
          connected: true,
          expiresAt: "2026-07-23T00:00:00.000Z",
          grantedScopes: [],
          lastRefreshedAt: null,
          serviceAccess: {
            blockedAt: "2026-07-22T01:02:03.000Z",
            reason: "security_incident",
            status: "blocked",
          },
          supportReference: "b".repeat(64),
        },
      })
      return
    }
    await route.abort()
  })
  await page.goto("https://growful.test/manage")
  await page.locator("#growful-token").fill(growfulToken)
  await page.locator("[data-token-submit]").click()

  await expect(page.locator("[data-status-blocked]")).toBeVisible()
  await expect(page.locator("[data-blocked-notice]")).toBeVisible()
  await expect(page.locator("[data-status-reauthorization]")).toBeHidden()
  await expect(page.locator("[data-reauthorization-notice]")).toBeHidden()
  await expect(page.locator("[data-rotate-token]")).toBeVisible()
  await expect(page.locator("[data-disconnect]")).toBeVisible()
})
