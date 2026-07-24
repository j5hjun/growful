import { expect, test } from "@playwright/test"
import { renderPortalSupport } from "../src/http/portal-support.js"
import { publicOAuthAccess } from "../tests/fixtures/oauth-access.js"

const viewportCases = [
  { height: 812, width: 375 },
  { height: 1_024, width: 768 },
  { height: 900, width: 1_280 },
] as const

for (const colorScheme of ["light", "dark"] as const) {
  for (const viewport of viewportCases) {
    test(`support CTA and static topics fit ${viewport.width}px in ${colorScheme} mode`, async ({
      page,
    }) => {
      // Given
      await page.emulateMedia({ colorScheme })
      await page.setViewportSize(viewport)

      // When
      await page.setContent(renderPortalSupport(publicOAuthAccess))

      // Then
      const cta = page.locator("[data-support-email-action]")
      await expect(cta).toBeVisible()
      await expect(cta).toHaveAccessibleName("이메일 문의하기")
      const ctaHref = await cta.getAttribute("href")
      expect(ctaHref?.startsWith("mailto:")).toBe(true)

      const ctaBox = await cta.boundingBox()
      if (ctaBox === null) throw new Error("Support email action has no browser layout box")
      expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(viewport.height)

      const semantics = await page.locator(".support-topics").evaluate((topics) => ({
        interactiveDescendants: topics.querySelectorAll("a, button, [tabindex]").length,
        itemTags: Array.from(topics.children, (item) => ({
          description: item.children.item(1)?.tagName,
          term: item.children.item(0)?.tagName,
        })),
        tagName: topics.tagName,
      }))
      expect(semantics).toEqual({
        interactiveDescendants: 0,
        itemTags: Array.from({ length: 4 }, () => ({ description: "DD", term: "DT" })),
        tagName: "DL",
      })

      const overflow = await page.evaluate(() => ({
        body: document.body.scrollWidth - document.body.clientWidth,
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }))
      expect(overflow.body).toBeLessThanOrEqual(0)
      expect(overflow.document).toBeLessThanOrEqual(0)
    })
  }
}

test("support keyboard order reaches the primary contact action before static topics", async ({
  page,
}) => {
  // Given
  await page.setViewportSize({ height: 812, width: 375 })
  await page.setContent(renderPortalSupport(publicOAuthAccess))

  // When
  for (let index = 0; index < 7; index += 1) await page.keyboard.press("Tab")

  // Then
  await expect(page.locator("[data-support-email-action]")).toBeFocused()
  await expect(page.locator("[data-support-topic]:focus")).toHaveCount(0)

  // When
  await page.keyboard.press("Tab")

  // Then
  const recovery = page.getByRole("region", { name: "먼저 직접 할 수 있는 조치" })
  const reconnect = recovery.getByRole("link", { name: "새 연결 시작" })
  await expect(reconnect).toBeFocused()
  await expect(reconnect).toHaveAttribute("href", "/oauth/start")
  await expect(recovery).toContainText("기존 Growful 토큰은 다시 조회하거나 복구할 수 없습니다.")
  await expect(recovery).toContainText(
    "같은 SmartThings 연결을 다시 승인하면 이전 Growful 토큰은 더 이상 사용할 수 없습니다.",
  )
  await expect(recovery).toContainText(
    "별도 SmartThings 연결로 승인하면 기존 Growful 연결은 자동으로 해제되지 않고 남을 수 있습니다.",
  )
  await expect(recovery).toContainText(
    "이 작업은 Growful Gateway에 저장된 연결 정보만 삭제하며 SmartThings 쪽 상태는 변경하지 않습니다.",
  )
  await expect(recovery).not.toContainText("비밀값을 이메일로 보내지 마세요.")
})

test("support content reflows without overflow in the DPR 2 / 640px surrogate", async ({
  page,
}) => {
  // Given
  // DPR does not emulate browser zoom; verify actual 200% browser zoom manually after deployment.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 2,
    height: 450,
    mobile: false,
    screenHeight: 900,
    screenWidth: 1_280,
    width: 640,
  })
  await page.setContent(renderPortalSupport(publicOAuthAccess))

  // Then
  const cta = page.locator("[data-support-email-action]")
  const layout = await cta.evaluate((action) => ({
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    ctaRight: action.getBoundingClientRect().right,
    devicePixelRatio: window.devicePixelRatio,
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }))
  expect(layout.bodyOverflow).toBeLessThanOrEqual(0)
  expect(layout.documentOverflow).toBeLessThanOrEqual(0)
  expect(layout.ctaRight).toBeLessThanOrEqual(layout.innerWidth)
  expect(layout.devicePixelRatio).toBe(2)
  expect(layout.innerWidth).toBe(640)
  await expect(cta).toBeVisible()
  await expect(page.locator("dl.support-topics > div > dt")).toHaveCount(4)
  await expect(page.locator("dl.support-topics > div > dd")).toHaveCount(4)
  await expect(
    page.locator(".support-topics a, .support-topics button, .support-topics [tabindex]"),
  ).toHaveCount(0)

  // When
  for (let index = 0; index < 7; index += 1) await page.keyboard.press("Tab")

  // Then
  await expect(cta).toBeFocused()
  await expect(page.locator("[data-support-topic]:focus")).toHaveCount(0)
})
