import type { Page, Route } from "@playwright/test"
import { expect, test } from "@playwright/test"
import {
  parseOAuthScopeSelectionSubmission,
  renderOAuthScopeSelection,
} from "../src/http/oauth-scope-selection.js"
import { testDisclosures } from "../tests/fixtures/oauth-access.js"

const gatewayUrl = "http://gateway.test/oauth/start"
const viewports = [
  { height: 812, name: "mobile", width: 375 },
  { height: 1_024, name: "tablet", width: 768 },
  { height: 900, name: "desktop", width: 1_280 },
] as const
const colorSchemes = ["light", "dark"] as const

async function findSplitKoreanWords(page: Page): Promise<string[]> {
  return page.locator("main").evaluate((main) => {
    const walker = main.ownerDocument.createTreeWalker(main, NodeFilter.SHOW_TEXT)
    const splitWords: string[] = []

    for (let textNode = walker.nextNode(); textNode !== null; textNode = walker.nextNode()) {
      const text = textNode.textContent ?? ""
      for (const match of text.matchAll(/[가-힣]+/gu)) {
        const start = match.index
        if (start === undefined) continue
        const range = main.ownerDocument.createRange()
        range.setStart(textNode, start)
        range.setEnd(textNode, start + match[0].length)
        if (range.getClientRects().length > 1) splitWords.push(match[0])
      }
    }

    return splitWords
  })
}

async function fulfillScopeSelection(route: Route): Promise<void> {
  const request = route.request()
  if (request.method() === "GET") {
    await route.fulfill({
      body: renderOAuthScopeSelection({ disclosures: testDisclosures }),
      contentType: "text/html; charset=utf-8",
      status: 200,
    })
    return
  }

  const submission = parseOAuthScopeSelectionSubmission(Buffer.from(request.postData() ?? ""))
  if (submission.kind !== "invalid") {
    throw new TypeError("Browser fixture requires an invalid OAuth scope submission")
  }
  await route.fulfill({
    body: renderOAuthScopeSelection({
      disclosures: testDisclosures,
      draft: submission.draft,
      issues: submission.issues,
    }),
    contentType: "text/html; charset=utf-8",
    status: 400,
  })
}

async function submitInvalidLongDraft(page: Page): Promise<void> {
  await page.goto(gatewayUrl)
  for (const resource of ["device", "hub", "location", "scene", "rule"]) {
    await page.locator(`[data-permission-resource="${resource}"] summary`).click()
  }
  for (const selector of [
    'input[name="deviceRange"][value="all"]',
    'input[name="devicePermissions"][value="control"]',
    'input[name="hubPermissions"][value="read"]',
    'input[name="locationPermissions"][value="execute"]',
    'input[name="scenePermissions"][value="execute"]',
    'input[name="rulePermissions"][value="write"]',
    'input[name="policyConsent"]',
  ]) {
    await page.locator(selector).check()
  }
  await page.locator("form").evaluate((form) => {
    if (!(form instanceof HTMLFormElement)) {
      throw new TypeError("OAuth selection form is missing")
    }
    const rejectedInput = form.ownerDocument.createElement("input")
    rejectedInput.type = "hidden"
    rejectedInput.name = "devicePermissions"
    rejectedInput.value = "private-user-identifier"
    form.append(rejectedInput)
  })
  await Promise.all([
    page.waitForNavigation(),
    page.getByRole("button", { name: "SmartThings에서 계속" }).click(),
  ])
}

for (const viewport of viewports) {
  for (const colorScheme of colorSchemes) {
    test(`invalid draft recovers at ${viewport.name} in ${colorScheme} mode`, async ({ page }) => {
      // Given
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme })
      await page.route(gatewayUrl, fulfillScopeSelection)

      // When
      await submitInvalidLongDraft(page)

      // Then
      await expect(page.locator("#selection-error-summary")).toBeFocused()
      for (const selector of [
        'input[name="deviceRange"][value="all"]',
        'input[name="devicePermissions"][value="read"]',
        'input[name="devicePermissions"][value="control"]',
        'input[name="hubPermissions"][value="read"]',
        'input[name="locationPermissions"][value="execute"]',
        'input[name="scenePermissions"][value="execute"]',
        'input[name="rulePermissions"][value="write"]',
        'input[name="policyConsent"]',
      ]) {
        await expect(page.locator(selector)).toBeChecked()
      }
      await expect(page.locator("main")).not.toContainText("private-user-identifier")
      const dimensions = await page.locator("html").evaluate((html) => ({
        clientWidth: html.clientWidth,
        scrollWidth: html.scrollWidth,
      }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
      expect(await findSplitKoreanWords(page)).toEqual([])
      await page.keyboard.press("Tab")
      await expect(page.locator('input[name="deviceRange"][value="all"]')).toBeFocused()
    })
  }
}

test("invalid draft remains usable at 200 percent zoom", async ({ page }) => {
  // Given
  await page.setViewportSize({
    height: Math.floor(viewports[0].height / 2),
    width: Math.floor(viewports[0].width / 2),
  })
  await page.emulateMedia({ colorScheme: "dark" })
  await page.route(gatewayUrl, fulfillScopeSelection)

  // When
  await submitInvalidLongDraft(page)

  // Then
  await expect(page.locator("#selection-error-summary")).toBeFocused()
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
  expect(overflowingElements).toEqual([])
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
  await expect(page.getByRole("button", { name: "SmartThings에서 계속" })).toBeVisible()
})
