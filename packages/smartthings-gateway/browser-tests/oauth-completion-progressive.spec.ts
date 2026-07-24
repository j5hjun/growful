import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { tokenSafetyClientScript } from "../src/http/token-safety.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"

const token = GrowfulTokenSchema.parse(`grw_st_${"A".repeat(43)}`)
const origin = "https://growful.test"

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
