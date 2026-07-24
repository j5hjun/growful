import { expect, test } from "@playwright/test"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { portalClientScript } from "../src/http/portal-client.js"
import { renderPortalManagement } from "../src/http/portal-manage.js"
import { tokenSafetyClientScript } from "../src/http/token-safety.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"

const tokenA = `grw_st_${"A".repeat(43)}`
const tokenB = `grw_st_${"B".repeat(43)}`

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

function connectionStatus() {
  return {
    authorizationHealth: { status: "active" },
    connected: true,
    expiresAt: "2026-07-23T00:00:00.000Z",
    grantedScopes: [],
    lastRefreshedAt: null,
    serviceAccess: { status: "active" },
    supportReference: "d".repeat(64),
  }
}

test("temporary management outage preserves the known status and retry token", async ({ page }) => {
  let statusRequests = 0
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
    if (pathname === "/connection") {
      statusRequests += 1
      if (statusRequests === 2) {
        await route.fulfill({ status: 503 })
        return
      }
      await route.fulfill({ json: connectionStatus() })
      return
    }
    await route.abort()
  })
  await page.goto("https://growful.test/manage")
  const input = page.locator("#growful-token")
  const submit = page.locator("[data-token-submit]")
  await input.fill(tokenA)
  await submit.click()
  await expect(page.locator("[data-portal-status]")).toBeVisible()
  await input.fill(tokenB)

  await submit.click()

  await expect(page.locator("[data-portal-status]")).toBeVisible()
  await expect(input).toHaveValue(tokenB)
  await expect(page.locator("[data-reconnect]")).toBeHidden()
  await expect(page.locator("[data-portal-error-message]")).toContainText(
    "연결은 삭제되지 않았습니다",
  )
  await expect(submit).toHaveText("상태 다시 확인")

  await submit.click()

  await expect(page.locator("[data-portal-feedback]")).toHaveText("연결 상태를 확인했습니다.")
  await expect(input).toHaveValue("")
  expect(statusRequests).toBe(3)
})

test("unconfirmed replacement token remains visible when status return is cancelled", async ({
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
    if (pathname === "/token-safety.js") {
      await route.fulfill({ body: tokenSafetyClientScript, contentType: "text/javascript" })
      return
    }
    if (pathname === "/connection") {
      await route.fulfill({ json: connectionStatus() })
      return
    }
    if (pathname === "/token/rotate") {
      await route.fulfill({ json: { growfulToken: tokenB } })
      return
    }
    await route.abort()
  })
  await page.goto("https://growful.test/manage")
  await page.locator("#growful-token").fill(tokenA)
  await page.locator("[data-token-submit]").click()
  await page.locator("[data-rotate-token]").click()
  await page.locator("[data-rotate-token-confirm]").click()
  const result = page.locator("[data-rotated-token-section]")
  const output = page.locator("[data-rotated-token]")
  await expect(result).toBeVisible()

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm")
    expect(dialog.message()).toContain("토큰을 다시 볼 수 없습니다")
    await dialog.dismiss()
  })
  await page.locator("[data-return-status]").click()

  await expect(result).toBeVisible()
  await expect(output).toHaveText(tokenB)
  await expect(output).toBeFocused()

  page.once("dialog", async (dialog) => {
    await dialog.accept()
  })
  await page.locator("[data-return-status]").click()

  await expect(result).toBeHidden()
  await expect(output).toHaveText("")
})

test("OAuth completion warns before navigation until the one-time token is copied", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: "https://growful.test",
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
    if (pathname === "/token-safety.js") {
      await route.fulfill({ body: tokenSafetyClientScript, contentType: "text/javascript" })
      return
    }
    if (pathname === "/manage") {
      await route.fulfill({ body: "<main>management</main>", contentType: "text/html" })
      return
    }
    await route.abort()
  })
  await page.goto("https://growful.test/oauth")
  const output = page.locator("[data-growful-token]")

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("beforeunload")
    await dialog.dismiss()
  })
  await page.locator('[data-action="manage-issued-token"]').click()

  await expect(page).toHaveURL("https://growful.test/oauth")
  await expect(output).toHaveText(tokenA)

  await page.locator("[data-copy-token]").click()
  await expect(page.locator("[data-token-copy-feedback]")).toBeVisible()
  await page.locator('[data-action="manage-issued-token"]').click()

  await expect(page).toHaveURL("https://growful.test/manage")
})

test("token visibility keeps focus and clipboard fallback selects exactly the support reference", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText() {
          throw new Error("clipboard denied")
        },
      },
    })
  })
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
    if (pathname === "/connection") {
      await route.fulfill({ json: connectionStatus() })
      return
    }
    await route.abort()
  })
  await page.goto("https://growful.test/manage")
  const input = page.locator("#growful-token")
  const visibility = page.locator("[data-token-visibility]")
  await input.fill(tokenA)
  await visibility.focus()

  await visibility.click()

  await expect(visibility).toBeFocused()
  await expect(visibility).toHaveAttribute("aria-pressed", "true")
  await expect(input).toHaveAttribute("type", "text")
  await page.locator("[data-token-submit]").click()
  const supportReference = page.locator("[data-support-reference]")

  await page.locator("[data-copy-support-reference]").click()

  await expect(supportReference).toBeFocused()
  await expect(page.locator("[data-portal-error-message]")).toHaveText(
    "자동 복사를 사용할 수 없습니다. 값을 직접 선택해 복사하세요.",
  )
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("d".repeat(64))
})

test("uncertain rotation exposes pending state then focuses safe OAuth recovery", async ({
  page,
}) => {
  let statusRequests = 0
  let releaseRotation: (() => void) | undefined
  const rotationGate = new Promise<void>((resolve) => {
    releaseRotation = resolve
  })
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
    if (pathname === "/connection") {
      statusRequests += 1
      await route.fulfill({ json: connectionStatus() })
      return
    }
    if (pathname === "/token/rotate") {
      await rotationGate
      await route.fulfill({ status: 502 })
      return
    }
    await route.abort()
  })
  await page.goto("https://growful.test/manage")
  await page.locator("#growful-token").fill(tokenA)
  await page.locator("[data-token-submit]").click()
  const rotate = page.locator("[data-rotate-token]")
  const status = page.locator("[data-portal-status]")
  const submit = page.locator("[data-token-submit]")
  await rotate.click()

  await page.locator("[data-rotate-token-confirm]").click()

  await expect(rotate).toHaveText("Growful 토큰 교체 중…")
  await expect(rotate).toHaveAttribute("aria-label", "Growful 토큰 교체 중입니다")
  await expect(rotate).toHaveAttribute("aria-busy", "true")
  await expect(status).toHaveAttribute("aria-busy", "true")
  await expect(status).toBeFocused()
  await expect(submit).toBeDisabled()
  await expect(submit).toHaveAttribute("aria-busy", "true")
  const beforeUnloadDialogs: string[] = []
  page.once("dialog", async (dialog) => {
    beforeUnloadDialogs.push(dialog.type())
    await dialog.dismiss()
  })
  await page.locator(".brand").click()
  await expect(page).toHaveURL("https://growful.test/manage")
  expect(beforeUnloadDialogs).toEqual(["beforeunload"])
  releaseRotation?.()

  await expect(page.locator("[data-portal-error-message]")).toContainText(
    "토큰 교체가 이미 적용되었을 수 있습니다",
  )
  await expect(page.locator("[data-portal-error-message]")).toContainText("다시 교체하지 마세요")
  const reconnect = page.locator("[data-reconnect]")
  await expect(reconnect).toBeVisible()
  await expect(reconnect).toBeFocused()
  await expect(reconnect).toHaveAttribute("class", "action action-primary")
  await page.emulateMedia({ forcedColors: "active" })
  await expect(reconnect).toHaveCSS("border-top-style", "solid")
  await expect(reconnect).toHaveCSS("border-top-width", "2px")
  await expect(status).toBeHidden()
  await expect(page.locator("#growful-token")).toBeDisabled()
  await expect(submit).toBeHidden()
  await expect(submit).toBeDisabled()
  await expect(status).not.toHaveAttribute("aria-busy", "true")
  await expect(rotate).not.toHaveAttribute("aria-busy", "true")
  await expect(rotate).toHaveText("Growful 토큰 교체")

  await page.locator("[data-portal-token-form]").evaluate((form) => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })

  await expect(reconnect).toBeVisible()
  await expect(reconnect).toBeFocused()
  await expect(page.locator("[data-portal-error-message]")).toContainText(
    "토큰 교체가 이미 적용되었을 수 있습니다",
  )
  expect(statusRequests).toBe(1)
})

test("pending disconnect ignores cancel and Escape until it settles on token entry", async ({
  page,
}) => {
  let disconnectRequests = 0
  let releaseDisconnect: (() => void) | undefined
  let markDisconnectStarted: (() => void) | undefined
  const disconnectGate = new Promise<void>((resolve) => {
    releaseDisconnect = resolve
  })
  const disconnectStarted = new Promise<void>((resolve) => {
    markDisconnectStarted = resolve
  })
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
      disconnectRequests += 1
      markDisconnectStarted?.()
      await disconnectGate
      await route.fulfill({ status: 204 })
      return
    }
    if (pathname === "/connection") {
      await route.fulfill({ json: connectionStatus() })
      return
    }
    await route.abort()
  })
  await page.goto("https://growful.test/manage")
  const input = page.locator("#growful-token")
  await input.fill(tokenA)
  await page.locator("[data-token-submit]").click()
  await page.locator("[data-disconnect]").click()
  const dialog = page.locator("[data-disconnect-dialog]")
  const cancel = page.locator("[data-disconnect-cancel]")

  await page.locator("[data-disconnect-confirm]").click()
  await disconnectStarted

  await expect(dialog).toBeVisible()
  await expect(dialog).toBeFocused()
  await expect(dialog).toHaveAttribute("aria-busy", "true")
  await expect(cancel).toBeDisabled()
  await expect(page.locator("[data-disconnect-confirm]")).toBeDisabled()

  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeFocused()
  await cancel.evaluate((button) => (button as HTMLButtonElement).click())
  await page.locator("[data-disconnect-form]").evaluate((form) => {
    const disconnectForm = form as HTMLFormElement
    const cancelButton = disconnectForm.querySelector<HTMLButtonElement>("[data-disconnect-cancel]")
    if (cancelButton !== null) disconnectForm.requestSubmit(cancelButton)
  })
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeFocused()
  expect(disconnectRequests).toBe(1)

  releaseDisconnect?.()

  await expect(dialog).toBeHidden()
  await expect(page.locator("[data-portal-feedback]")).toHaveText(
    "Growful에 저장된 연결과 토큰을 삭제했습니다.",
  )
  await expect(input).toBeFocused()
  expect(disconnectRequests).toBe(1)
})
