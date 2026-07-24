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
