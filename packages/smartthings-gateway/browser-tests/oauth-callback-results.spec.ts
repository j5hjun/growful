import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import {
  oauthCallbackResultKinds,
  renderOAuthCallbackResult,
} from "../src/http/oauth-callback-result.js"

const resultKinds = Object.values(oauthCallbackResultKinds)
const viewports = [
  { height: 812, name: "mobile", width: 375 },
  { height: 1_024, name: "tablet", width: 768 },
  { height: 900, name: "desktop", width: 1_280 },
] as const

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

for (const viewport of viewports) {
  for (const kind of resultKinds) {
    test(`${kind} recovery page is usable at the ${viewport.name} viewport`, async ({ page }) => {
      // Given
      await page.setViewportSize(viewport)
      await page.setContent(renderOAuthCallbackResult(kind))

      // When
      const pageMetrics = await page.locator("body").evaluate((body) => ({
        clientWidth: body.ownerDocument.documentElement.clientWidth,
        scrollWidth: body.ownerDocument.documentElement.scrollWidth,
      }))
      const splitWords = await findSplitKoreanWords(page)
      const actions = page.locator(".actions a")
      const phrases = page.locator("h1 .phrase, main > p .phrase")

      // Then
      await expect(page.locator("main h1")).toBeVisible()
      await expect(actions).toHaveCount(3)
      expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth)
      expect(splitWords).toEqual([])
      for (const phrase of await phrases.all()) {
        const box = await phrase.boundingBox()
        const lineHeight = await phrase.evaluate((element) =>
          Number.parseFloat(
            element.ownerDocument.defaultView?.getComputedStyle(element).lineHeight ?? "0",
          ),
        )
        expect(box?.height).toBeLessThanOrEqual(lineHeight + 1)
      }
      for (const action of await actions.all()) {
        const box = await action.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
      }
      await page.keyboard.press("Tab")
      await expect(page.getByRole("link", { name: "본문 바로가기" })).toBeFocused()
      await page.keyboard.press("Enter")
      await expect(page.locator("main#main-content")).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(actions.nth(0)).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(actions.nth(1)).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(actions.nth(2)).toBeFocused()
    })
  }
}
