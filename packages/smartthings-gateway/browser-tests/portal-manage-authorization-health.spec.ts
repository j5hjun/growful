import { expect, test } from "@playwright/test"
import { portalClientScript } from "../src/http/portal-client.js"
import { renderPortalManagement } from "../src/http/portal-manage.js"
import { smartThingsScopes } from "../src/oauth/smartthings-scope.js"

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
          grantedScopes: [...smartThingsScopes, "r:future-resources:*"],
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
    const tokenRecovery = page.getByRole("region", {
      name: "Growful 토큰을 잃어버렸나요?",
    })
    const tokenRecoveryAction = tokenRecovery.getByRole("link", {
      name: "새 연결 시작",
    })
    await expect(tokenRecovery).toContainText(
      "기존 Growful 토큰은 다시 조회하거나 복구할 수 없습니다.",
    )
    await expect(tokenRecovery).toContainText(
      "분실한 토큰의 기존 연결은 자동으로 해제되지 않습니다.",
    )
    await expect(tokenRecovery).toContainText(
      "SmartThings에서 이전 Growful 설치를 삭제한 뒤 새 연결을 시작하세요.",
    )
    await expect(tokenRecoveryAction).toHaveAttribute("href", "/oauth/start")
    const tokenInput = page.locator("#growful-token")
    await tokenInput.fill(growfulToken)
    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
    await expect(tokenRecoveryAction).toBeFocused()
    await tokenInput.fill(growfulToken)
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
    const permissionRegion = page.getByRole("region", { name: "승인된 권한" })
    const permissionList = permissionRegion.getByRole("list")
    await expect(permissionList).not.toHaveAttribute("aria-labelledby")
    await expect(permissionList.getByRole("listitem")).toHaveCount(15)
    await expect(
      permissionList.getByRole("listitem").filter({
        hasText: "SmartThings에서 선택한 디바이스 정보와 상태 읽기",
      }),
    ).toContainText("r:devices:$")
    const unknownPermission = permissionList.locator('[data-scope-kind="unknown"]')
    await expect(unknownPermission).toContainText("알 수 없는 SmartThings 권한")
    await expect(unknownPermission.locator("code")).toHaveText("r:future-resources:*")
    await expect(unknownPermission.locator("code")).toHaveAttribute(
      "aria-label",
      "원문 권한 코드: r:future-resources:*",
    )

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

  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 2,
    height: 450,
    mobile: false,
    screenHeight: 900,
    screenWidth: 1_280,
    width: 640,
  })
  const reflow = await page.locator("html").evaluate((html) => ({
    clientWidth: html.clientWidth,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    scrollWidth: html.scrollWidth,
  }))
  expect(reflow.devicePixelRatio).toBe(2)
  expect(reflow.innerWidth).toBe(640)
  expect(reflow.scrollWidth).toBeLessThanOrEqual(reflow.clientWidth)

  await page.emulateMedia({ forcedColors: "active" })
  const reconnect = page
    .locator("[data-reauthorization-notice]")
    .getByRole("link", { name: "SmartThings 다시 연결" })
  await expect(reconnect).toHaveCSS("border-top-style", "solid")
  await expect(reconnect).toHaveCSS("border-top-width", "2px")
  const unknownPermission = page.locator('[data-scope-kind="unknown"]')
  await expect(unknownPermission).toHaveCSS("border-top-style", "dashed")
  await expect(unknownPermission).toHaveCSS("border-top-width", "1px")
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
          grantedScopes: ["r:devices:*"],
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
