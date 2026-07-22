import { expect, test } from "@playwright/test"
import { renderPortalManagement } from "../src/http/portal-manage.js"

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

test("management Korean error text wraps between words without splitting syllables", async ({
  page,
}) => {
  // Given
  await page.setViewportSize({ height: 812, width: 375 })
  await page.setContent(renderPortalManagement(portalAccess()))
  const errorMessage = page.locator("[data-portal-error-message]")
  await errorMessage.evaluate((element) => {
    element.textContent = "토큰이 교체되었거나 만료되었습니다. 새 Growful 토큰을 입력하세요."
    element.parentElement?.removeAttribute("hidden")
  })

  // When
  const splitWords = await errorMessage.evaluate((paragraph) => {
    const walker = paragraph.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
    const splitWords: string[] = []

    for (let textNode = walker.nextNode(); textNode !== null; textNode = walker.nextNode()) {
      const text = textNode.textContent ?? ""
      for (const match of text.matchAll(/[가-힣]+/gu)) {
        const start = match.index
        if (start === undefined) continue
        const range = paragraph.ownerDocument.createRange()
        range.setStart(textNode, start)
        range.setEnd(textNode, start + match[0].length)
        if (range.getClientRects().length > 1) splitWords.push(match[0])
      }
    }

    return splitWords
  })

  // Then
  expect(splitWords).toEqual([])
})

test("management states share a flexible three-row frame and fixed action slot", async ({
  page,
}) => {
  // Given
  await page.setViewportSize({ height: 812, width: 375 })
  await page.setContent(renderPortalManagement(portalAccess()))
  const form = page.locator("[data-portal-token-form]")
  const submit = page.locator("[data-token-submit]")
  const reveal = page.locator("[data-token-visibility]")
  const input = page.locator("#growful-token")
  const initialFrame = await form.boundingBox()
  const initialAction = await submit.boundingBox()

  // When
  const grid = await form.evaluate((element) => {
    const style = getComputedStyle(element)
    return { minBlockSize: style.minBlockSize, rows: style.gridTemplateRows.split(" ") }
  })
  await submit.evaluate((element) => {
    element.textContent = "확인 중…"
    element.setAttribute("disabled", "")
  })
  const loadingAction = await submit.boundingBox()
  await page.locator("[data-portal-error-message]").evaluate((element) => {
    element.textContent = "네트워크 연결을 확인하세요."
  })
  await page.locator("[data-portal-error]").evaluate((element) => {
    element.removeAttribute("hidden")
  })
  const errorAction = await submit.boundingBox()
  const inputBox = await input.boundingBox()
  const revealBox = await reveal.boundingBox()
  await page.locator("[data-portal-status]").evaluate((element) => {
    element.removeAttribute("hidden")
  })
  const successFrame = await form.boundingBox()

  // Then
  expect(grid.rows).toHaveLength(3)
  expect(grid.minBlockSize).not.toBe("0px")
  if (
    initialFrame === null ||
    initialAction === null ||
    loadingAction === null ||
    errorAction === null ||
    inputBox === null ||
    revealBox === null ||
    successFrame === null
  ) {
    throw new Error("Management frame has a missing browser layout box")
  }
  expect(Math.abs(loadingAction.y - initialAction.y)).toBeLessThanOrEqual(8)
  expect(Math.abs(errorAction.y - initialAction.y)).toBeLessThanOrEqual(8)
  expect(successFrame.x).toBeCloseTo(initialFrame.x, 2)
  expect(successFrame.y).toBeCloseTo(initialFrame.y, 2)
  expect(successFrame.width).toBeCloseTo(initialFrame.width, 2)
  expect(revealBox.y).toBeCloseTo(inputBox.y, 2)
  expect(revealBox.width).toBeLessThan(initialFrame.width / 2)
})
