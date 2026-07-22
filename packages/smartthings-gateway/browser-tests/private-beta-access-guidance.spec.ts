import { expect, test } from "@playwright/test"
import { renderPrivateBetaAccessGuidance } from "../src/private-beta/access-guidance.js"

const pageVariants = [
  {
    guidance: { kind: "authentication_failed" },
    name: "authentication-failed",
    title: "인증을 완료하지 못했습니다",
  },
  {
    guidance: { kind: "rate_limited", retryAfterSeconds: 60 },
    name: "rate-limited",
    title: "잠시 후 다시 시도해 주세요",
  },
] as const

const viewportWidths = [375, 1_280] as const
const colorSchemes = ["light", "dark"] as const

for (const variant of pageVariants) {
  for (const width of viewportWidths) {
    for (const colorScheme of colorSchemes) {
      test(`${variant.name} fits ${width}px in ${colorScheme} mode and preserves keyboard flow`, async ({
        page,
      }, testInfo) => {
        // Given
        await page.emulateMedia({ colorScheme })
        await page.setViewportSize({ height: width === 375 ? 812 : 900, width })
        await page.setContent(renderPrivateBetaAccessGuidance(variant.guidance))

        // When
        const layout = await page.locator("main").evaluate((main) => {
          const bounds = main.getBoundingClientRect()
          return {
            bodyBackground: getComputedStyle(main.ownerDocument.body).backgroundColor,
            documentWidth: main.ownerDocument.documentElement.scrollWidth,
            left: bounds.left,
            right: bounds.right,
            viewportWidth: main.ownerDocument.defaultView?.innerWidth ?? 0,
          }
        })
        const splitWords = await page.locator("main").evaluate((main) => {
          const walker = main.ownerDocument.createTreeWalker(main, NodeFilter.SHOW_TEXT)
          const words: string[] = []

          for (let textNode = walker.nextNode(); textNode !== null; textNode = walker.nextNode()) {
            const text = textNode.textContent ?? ""
            for (const match of text.matchAll(/[가-힣]+/gu)) {
              const start = match.index
              if (start === undefined) continue
              const range = main.ownerDocument.createRange()
              range.setStart(textNode, start)
              range.setEnd(textNode, start + match[0].length)
              if (range.getClientRects().length > 1) words.push(match[0])
            }
          }

          return words
        })
        const primaryAction = page.locator(".action-primary")
        const secondaryAction = page.locator(".action-secondary")
        const secretPhrase = page.getByText("원본 invite secret", { exact: true })
        await page.keyboard.press("Tab")

        // Then
        await expect(page.locator("h1")).toHaveText(variant.title)
        expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
        expect(layout.left).toBeGreaterThanOrEqual(0)
        expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth)
        expect(layout.bodyBackground).toBe(
          colorScheme === "light" ? "rgb(247, 246, 243)" : "rgb(16, 24, 32)",
        )
        expect(splitWords).toEqual([])
        expect(await secretPhrase.evaluate((element) => element.getClientRects().length)).toBe(1)
        await expect(primaryAction).toBeFocused()
        expect((await primaryAction.boundingBox())?.height).toBeGreaterThanOrEqual(44)
        expect(
          await primaryAction.evaluate((element) => getComputedStyle(element).outlineStyle),
        ).toBe("solid")
        await page.keyboard.press("Tab")
        await expect(secondaryAction).toBeFocused()
        expect((await secondaryAction.boundingBox())?.height).toBeGreaterThanOrEqual(44)
        await page.screenshot({
          fullPage: true,
          path: testInfo.outputPath(`${variant.name}-${width}-${colorScheme}.png`),
        })
      })
    }
  }
}
