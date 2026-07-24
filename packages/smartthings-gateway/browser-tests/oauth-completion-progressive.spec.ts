import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { tokenSafetyClientScript } from "../src/http/token-safety.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"

const token = GrowfulTokenSchema.parse(`grw_st_${"A".repeat(43)}`)
const origin = "https://growful.test"
const viewports = [
  { height: 720, width: 320 },
  { height: 812, width: 375 },
  { height: 1_024, width: 768 },
  { height: 900, width: 1_280 },
] as const

async function routeCompletion(page: Page, scriptAvailable: boolean): Promise<void> {
  await page.route(`${origin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === "/oauth") {
      await route.fulfill({
        body: renderOAuthCompletion(token),
        contentType: "text/html",
      })
      return
    }
    if (pathname === "/token-safety.js") {
      if (scriptAvailable) {
        await route.fulfill({
          body: tokenSafetyClientScript,
          contentType: "text/javascript",
        })
      } else {
        await route.abort()
      }
      return
    }
    if (pathname === "/manage") {
      await route.fulfill({ body: "<main>management</main>", contentType: "text/html" })
      return
    }
    await route.abort()
  })
}

async function expectManualOnlyCompletion(page: Page): Promise<void> {
  await expect(page.locator("[data-growful-token]")).toHaveValue(token)
  await expect(page.locator("[data-growful-token]")).toHaveAttribute("readonly", "")
  await expect(page.locator("[data-token-manual-copy]")).toBeVisible()
  await expect(page.locator("[data-token-manual-copy]")).toContainText("Ctrl+C 또는 Command+C")
  await expect(page.getByRole("button", { name: "Growful 토큰 복사" })).toHaveCount(0)
  await expect(page.locator("[data-copy-token]")).toBeHidden()
  await expect(page.locator("[data-copy-token]")).toBeDisabled()
  await expect(page.getByRole("link", { name: "관리 화면에서 연결 확인" })).toBeVisible()
  await expectQuickstart(page)
}

async function expectQuickstart(page: Page): Promise<void> {
  const quickstart = page.getByRole("region", { name: "첫 API 요청" })

  await expect(quickstart).toBeVisible()
  await expect(quickstart).toContainText(
    "이 Gateway와 같은 주소의 /v1 아래에 SmartThings API 경로를 붙이세요.",
  )
  await expect(quickstart).toContainText(
    "디바이스 읽기 권한을 선택한 경우 아래처럼 요청할 수 있습니다. 다른 권한만 승인했다면 /v1 뒤에 자신이 승인한 SmartThings API 경로를 사용하세요.",
  )
  await expect(quickstart.locator("pre code")).toHaveText(
    "GET /v1/devices\nAuthorization: Bearer <Growful 토큰>",
  )
  await expect(quickstart).toContainText(
    "실제 토큰은 위 자리표시자 대신 Authorization 헤더에만 넣으세요.",
  )
  await expect(quickstart.locator(".api-token-safety")).toHaveCSS("margin-bottom", "0px")
}

async function expectNoHorizontalOverflowOrQuickstartOverlap(page: Page): Promise<void> {
  const layout = await page.evaluate(() => {
    const documentElement = document.documentElement
    const quickstart = document.querySelector('[aria-labelledby="api-quickstart-title"]')
    if (!(quickstart instanceof HTMLElement)) {
      throw new TypeError("API quickstart is missing")
    }
    const visibleChildren = [...quickstart.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement)
      .map((element) => {
        const bounds = element.getBoundingClientRect()
        return { bottom: bounds.bottom, left: bounds.left, right: bounds.right, top: bounds.top }
      })

    return {
      clientWidth: documentElement.clientWidth,
      overlappingChildren: visibleChildren.slice(1).filter((child, index) => {
        const previous = visibleChildren[index]
        return previous !== undefined && child.top < previous.bottom - 1
      }).length,
      overflowingChildren: visibleChildren.filter(
        (child) => child.left < -1 || child.right > documentElement.clientWidth + 1,
      ).length,
      scrollWidth: documentElement.scrollWidth,
    }
  })

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
  expect(layout.overflowingChildren).toBe(0)
  expect(layout.overlappingChildren).toBe(0)
}

async function expectExactKeyboardCopy(page: Page): Promise<void> {
  const tokenField = page.locator("[data-growful-token]")

  await page.keyboard.press("Tab")
  await expect(tokenField).toBeFocused()
  await page.keyboard.press("ControlOrMeta+A")

  const selection = await tokenField.evaluate((element: HTMLTextAreaElement) => ({
    end: element.selectionEnd,
    formIsNull: element.form === null,
    name: element.name,
    selectedValue: element.value.slice(element.selectionStart, element.selectionEnd),
    start: element.selectionStart,
  }))
  expect(selection).toEqual({
    end: token.length,
    formIsNull: true,
    name: "",
    selectedValue: token,
    start: 0,
  })

  await page.keyboard.press("ControlOrMeta+C")
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(token)
  await expect(page).toHaveURL(`${origin}/oauth`)
}

test("completion keeps manual-copy recovery and no inert copy action without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin })
  const page = await context.newPage()
  await routeCompletion(page, true)

  try {
    await page.goto(`${origin}/oauth`)
    await expectManualOnlyCompletion(page)
    await expectExactKeyboardCopy(page)
  } finally {
    await context.close()
  }
})

test("completion keeps manual-copy recovery when its enhancement script fails", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin })
  await routeCompletion(page, false)

  await page.goto(`${origin}/oauth`)

  await expectManualOnlyCompletion(page)
  await expectExactKeyboardCopy(page)
})

test("pagehide removes the token from every textarea representation before browser caching", async ({
  page,
}) => {
  await routeCompletion(page, true)
  await page.goto(`${origin}/oauth`)
  const tokenField = page.locator("[data-growful-token]")

  const snapshot = await tokenField.evaluate((element: HTMLTextAreaElement) => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))
    return {
      defaultValue: element.defaultValue,
      outerHTML: element.outerHTML,
      textContent: element.textContent,
      value: element.value,
    }
  })

  expect(snapshot).toMatchObject({
    defaultValue: "",
    textContent: "",
    value: "",
  })
  expect(snapshot.outerHTML).not.toContain(token)
  await expect(page.locator("[data-copy-token]")).toBeDisabled()
})

test("clipboard failure selects the exact token for keyboard copying", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin })
  await page.addInitScript(() => {
    const clipboard = navigator.clipboard
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: clipboard.readText.bind(clipboard),
        async writeText() {
          throw new Error("clipboard unavailable")
        },
      },
    })
  })
  await routeCompletion(page, true)
  await page.goto(`${origin}/oauth`)
  const copyButton = page.getByRole("button", { name: "Growful 토큰 복사" })

  await expect(copyButton).toBeVisible()
  await expect(copyButton).toBeEnabled()
  await copyButton.click()

  await expect(page.locator("[data-token-copy-error]")).toBeVisible()
  const tokenField = page.locator("[data-growful-token]")
  await expect(tokenField).toBeFocused()
  expect(
    await tokenField.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe(token)

  await page.keyboard.press("ControlOrMeta+C")

  await expect(page.locator("[data-token-safety]")).toHaveAttribute(
    "data-token-safety-acknowledged",
    "",
  )
  await expect(page.locator("[data-token-copy-feedback]")).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token)
  await page.getByRole("link", { name: "관리 화면에서 연결 확인" }).click()
  await expect(page).toHaveURL(`${origin}/manage`)
})

for (const viewport of viewports) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`quickstart reflows at ${viewport.width}px in ${colorScheme} mode`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await routeCompletion(page, true)

      await page.goto(`${origin}/oauth`)

      await expectQuickstart(page)
      await expectNoHorizontalOverflowOrQuickstartOverlap(page)
    })
  }
}

test("quickstart remains readable in a 160px reflow surrogate", async ({ page }) => {
  // This viewport reduction is a layout surrogate; verify actual 200% browser zoom manually after deployment.
  await page.setViewportSize({ height: viewports[0].height / 2, width: viewports[0].width / 2 })
  await page.emulateMedia({ colorScheme: "dark" })
  await routeCompletion(page, true)

  await page.goto(`${origin}/oauth`)

  await expectQuickstart(page)
  await expectNoHorizontalOverflowOrQuickstartOverlap(page)
})

test("forced colors preserve the quickstart example boundary", async ({ page }) => {
  await page.setViewportSize(viewports[0])
  await page.emulateMedia({ forcedColors: "active" })
  await routeCompletion(page, true)

  await page.goto(`${origin}/oauth`)

  await expectQuickstart(page)
  await expect(page.locator(".api-request-example")).toHaveCSS("border-top-style", "solid")
  await expect(page.locator(".api-request-example")).toHaveCSS("border-top-width", "2px")
  await expectNoHorizontalOverflowOrQuickstartOverlap(page)
})
