import { expect, type Page, test } from "@playwright/test"
import type { FastifyInstance } from "fastify"
import {
  createGatewayAppFixture,
  gatewayRedirectOrigin,
} from "../tests/fixtures/gateway-app-fixture.js"
import { privateBetaOAuthAccess, publicOAuthAccess } from "../tests/fixtures/oauth-access.js"

const portalPaths = [
  "/",
  "/status",
  "/manage",
  "/support",
  "/privacy",
  "/terms",
  "/missing-page",
] as const
const publicUserPaths = [...portalPaths, "/oauth/start", "/oauth/callback"] as const
const modes = [
  { access: publicOAuthAccess, name: "public" },
  { access: privateBetaOAuthAccess([]), name: "private" },
] as const
const viewportWidths = [160, 320, 375, 768, 1_280] as const

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const initial = await page.locator("html").evaluate((html) => {
    const viewportWidth = html.clientWidth
    const elementSelector = (element: Element): string => {
      const parts: string[] = []
      let current: Element | null = element
      while (current !== null && current !== document.documentElement && parts.length < 5) {
        const id = current.id === "" ? "" : `#${current.id}`
        const classes = current.classList.length === 0 ? "" : `.${[...current.classList].join(".")}`
        parts.unshift(`${current.tagName.toLowerCase()}${id}${classes}`)
        current = current.parentElement
      }
      return parts.join(" > ")
    }
    const elements = [...document.querySelectorAll<HTMLElement>("body *")].map((element) => {
      const bounds = element.getBoundingClientRect()
      const textNodes = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
        .flatMap((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          return [...range.getClientRects()].map((rect) => ({
            left: rect.left,
            right: rect.right,
            text: node.textContent?.trim().slice(0, 80) ?? "",
            width: rect.width,
          }))
        })
      return {
        rect: {
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
        },
        selector: elementSelector(element),
        textNodes,
      }
    })
    const textNodeEdges = elements.flatMap((element) =>
      element.textNodes
        .filter((rect) => rect.left < 0 || rect.right > viewportWidth)
        .map((rect) => ({ ...rect, selector: element.selector })),
    )
    const rootBounds = html.getBoundingClientRect()
    const bodyBounds = document.body.getBoundingClientRect()
    return {
      elementEdges: elements.filter(({ rect }) => rect.left < 0 || rect.right > viewportWidth),
      layout: {
        body: {
          clientWidth: document.body.clientWidth,
          rect: { left: bodyBounds.left, right: bodyBounds.right, width: bodyBounds.width },
          scrollWidth: document.body.scrollWidth,
        },
        html: {
          clientWidth: html.clientWidth,
          rect: { left: rootBounds.left, right: rootBounds.right, width: rootBounds.width },
          scrollWidth: html.scrollWidth,
        },
      },
      textNodeEdges,
    }
  })
  const hasOverflow =
    initial.layout.html.scrollWidth > initial.layout.html.clientWidth ||
    initial.elementEdges.length > 0 ||
    initial.textNodeEdges.length > 0

  if (!hasOverflow) return

  const details = await page.locator("html").evaluate((html) => {
    const elementSelector = (element: Element): string => {
      const parts: string[] = []
      let current: Element | null = element
      while (current !== null && current !== document.documentElement && parts.length < 5) {
        const id = current.id === "" ? "" : `#${current.id}`
        const classes = current.classList.length === 0 ? "" : `.${[...current.classList].join(".")}`
        parts.unshift(`${current.tagName.toLowerCase()}${id}${classes}`)
        current = current.parentElement
      }
      return parts.join(" > ")
    }
    const pseudoDetails = (element: Element, pseudo: "::before" | "::after") => {
      const style = getComputedStyle(element, pseudo)
      return {
        borderInline: `${style.borderLeftWidth} ${style.borderRightWidth}`,
        content: style.content,
        display: style.display,
        marginInline: `${style.marginLeft} ${style.marginRight}`,
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`,
        paddingInline: `${style.paddingLeft} ${style.paddingRight}`,
        position: style.position,
        transform: style.transform,
        width: style.width,
      }
    }
    const elements = [...document.querySelectorAll<HTMLElement>("body *")].map((element) => {
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const textNodes = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
        .flatMap((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          return [...range.getClientRects()].map((rect) => ({
            left: rect.left,
            right: rect.right,
            text: node.textContent?.trim().slice(0, 80) ?? "",
            width: rect.width,
          }))
        })
      return {
        after: pseudoDetails(element, "::after"),
        before: pseudoDetails(element, "::before"),
        box: {
          borderInline: `${style.borderLeftWidth} ${style.borderRightWidth}`,
          boxSizing: style.boxSizing,
          marginInline: `${style.marginLeft} ${style.marginRight}`,
          maxWidth: style.maxWidth,
          minWidth: style.minWidth,
          outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset}`,
          overflowX: style.overflowX,
          paddingInline: `${style.paddingLeft} ${style.paddingRight}`,
          position: style.position,
          transform: style.transform,
          width: style.width,
        },
        clientWidth: element.clientWidth,
        offsetWidth: element.offsetWidth,
        rect: {
          left: bounds.left,
          right: bounds.right,
          width: bounds.width,
        },
        scrollWidth: element.scrollWidth,
        selector: elementSelector(element),
        textNodes,
      }
    })
    const hasPseudoSignal = (pseudo: ReturnType<typeof pseudoDetails>) =>
      (pseudo.content !== "none" && pseudo.content !== "normal") ||
      !pseudo.outline.startsWith("none ") ||
      pseudo.transform !== "none"
    return {
      ancestorScrollDifferences: [
        {
          clientWidth: html.clientWidth,
          scrollWidth: html.scrollWidth,
          selector: "html",
        },
        {
          clientWidth: document.body.clientWidth,
          scrollWidth: document.body.scrollWidth,
          selector: "body",
        },
        ...elements.map(({ clientWidth, scrollWidth, selector }) => ({
          clientWidth,
          scrollWidth,
          selector,
        })),
      ].filter(({ clientWidth, scrollWidth }) => scrollWidth - clientWidth >= 1),
      pseudoSignals: elements
        .filter(({ before, after }) => hasPseudoSignal(before) || hasPseudoSignal(after))
        .map(({ after, before, selector }) => ({ after, before, selector })),
      rightmostElements: [...elements]
        .sort((left, right) => right.rect.right - left.rect.right)
        .slice(0, 8)
        .map(({ box, clientWidth, offsetWidth, rect, scrollWidth, selector }) => ({
          box,
          clientWidth,
          offsetWidth,
          rect,
          scrollWidth,
          selector,
        })),
      rightmostTextNodes: elements
        .flatMap((element) =>
          element.textNodes.map((rect) => ({ ...rect, selector: element.selector })),
        )
        .sort((left, right) => right.right - left.right)
        .slice(0, 8),
      transformedElements: elements
        .filter(({ box }) => box.transform !== "none")
        .map(({ box, rect, selector }) => ({ rect, selector, transform: box.transform })),
    }
  })
  const diagnosticLabel = `${label}\n${JSON.stringify({ details, initial })}`

  expect(initial.elementEdges, diagnosticLabel).toEqual([])
  expect(initial.textNodeEdges, diagnosticLabel).toEqual([])
  expect(initial.layout.html.scrollWidth, diagnosticLabel).toBeLessThanOrEqual(
    initial.layout.html.clientWidth,
  )
}

async function createAuthorizationState(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: gatewayRedirectOrigin,
    },
    method: "POST",
    payload:
      "deviceRange=selected&devicePermissions=read&devicePermissions=control&locationPermissions=read&policyConsent=accepted",
    url: "/oauth/start",
  })
  expect(response.statusCode).toBe(302)
  return new URL(response.headers.location ?? "").searchParams.get("state") ?? ""
}

for (const mode of modes) {
  for (const width of viewportWidths) {
    test(`${mode.name} HTTP portal pages reflow without horizontal overflow at ${width}px`, async ({
      page,
    }) => {
      const apps: FastifyInstance[] = []
      const { app } = createGatewayAppFixture({ apps, oauthAccess: mode.access })
      const origin = await app.listen({ host: "127.0.0.1", port: 0 })
      await page.setViewportSize({ height: width <= 375 ? 812 : 1_024, width })

      try {
        for (const path of portalPaths) {
          const response = await page.goto(`${origin}${path}`)
          expect(response?.status(), `${mode.name} ${path}`).toBe(
            path === "/missing-page" ? 404 : 200,
          )
          await expectNoHorizontalOverflow(page, `${mode.name} ${path} at ${width}px`)
          await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
          await expect(page.locator(".portal-page-shell")).toHaveCount(1)
          await expect(page.locator(".site-footer")).toHaveCount(1)
        }

        if (mode.name === "public") {
          for (const path of ["/oauth/start", "/oauth/callback"] as const) {
            const response = await page.goto(`${origin}${path}`)
            expect(response?.status(), `${mode.name} ${path}`).toBe(
              path === "/oauth/callback" ? 400 : 200,
            )
            await expectNoHorizontalOverflow(page, `${mode.name} ${path} at ${width}px`)
            await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)
          }
          const state = await createAuthorizationState(app)
          const completionResponse = await page.goto(
            `${origin}/oauth/callback?code=browser-authorization-code&state=${encodeURIComponent(state)}`,
          )
          expect(completionResponse?.status()).toBe(200)
          await expectNoHorizontalOverflow(page, `public OAuth completion at ${width}px`)
          await expect(page.getByRole("heading", { level: 1 })).toHaveText("SmartThings 연결 완료")
        } else {
          const leakedUsername = `browser-user-${width}-must-not-leak`
          const leakedPassword = `invite-password-${width}-must-not-leak`
          const authorization = `Basic ${Buffer.from(`${leakedUsername}:${leakedPassword}`).toString("base64")}`
          await page.setExtraHTTPHeaders({ authorization })
          const response = await page.goto(`${origin}/oauth/start`)
          expect(response?.status()).toBe(401)
          await expectNoHorizontalOverflow(page, `private invite failure at ${width}px`)
          await expect(page.getByRole("heading", { level: 1 })).toHaveText(
            "초대 확인을 완료하지 못했습니다",
          )
          await expect(page.locator("body")).not.toContainText(leakedUsername)
          await expect(page.locator("body")).not.toContainText(leakedPassword)
          await expect(page.locator("body")).not.toContainText(authorization)
          await page.setExtraHTTPHeaders({})
        }

        await page.goto(origin)
        await expect(page.getByRole("link", { name: "SmartThings 연결 시작" })).toBeVisible()
        await expect(
          page.getByText("SmartThings 연결 토큰", { exact: false }).first(),
        ).toBeVisible()

        if (mode.name === "private") {
          const invitation = page.getByRole("complementary", { name: "초대 정보를 준비하세요" })
          await expect(invitation).toContainText("초대 사용자 이름과 초대 비밀번호")
          await expect(invitation).toContainText("초대 비밀번호는 삼성 계정 비밀번호가 아닙니다")
        } else {
          await expect(page.locator("[data-private-beta-entry-guidance]")).toHaveCount(0)
        }
      } finally {
        await app.close()
      }
    })
  }
}

test("public HTTP pages reflow in the DPR 2 / 640px surrogate", async ({ page }) => {
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
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

  try {
    for (const path of publicUserPaths) {
      const response = await page.goto(`${origin}${path}`)
      expect(response?.status(), path).toBe(
        path === "/missing-page" ? 404 : path === "/oauth/callback" ? 400 : 200,
      )
      expect(await page.evaluate(() => window.devicePixelRatio), path).toBe(2)
      await expectNoHorizontalOverflow(page, `${path} in DPR 2 / 640px surrogate`)
    }
    const state = await createAuthorizationState(app)
    const completionResponse = await page.goto(
      `${origin}/oauth/callback?code=zoom-authorization-code&state=${encodeURIComponent(state)}`,
    )
    expect(completionResponse?.status()).toBe(200)
    await expectNoHorizontalOverflow(page, "OAuth completion in DPR 2 / 640px surrogate")
  } finally {
    await app.close()
  }
})

test("private HTTP home keeps keyboard and screen-reader semantics in reading order", async ({
  page,
}) => {
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({
    apps,
    oauthAccess: privateBetaOAuthAccess([]),
  })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  await page.setViewportSize({ height: 812, width: 375 })

  try {
    await page.goto(origin)

    await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible()
    await expect(page.getByRole("complementary", { name: "초대 정보를 준비하세요" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "세 단계로 연결됩니다" })).toBeVisible()
    await page.keyboard.press("Tab")
    await expect(page.getByRole("link", { name: "본문 바로가기" })).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.locator("main#main-content")).toBeFocused()
  } finally {
    await app.close()
  }
})

test("private HTTP home preserves its primary action boundary in forced colors", async ({
  page,
}) => {
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({
    apps,
    oauthAccess: privateBetaOAuthAccess([]),
  })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  await page.setViewportSize({ height: 812, width: 375 })
  await page.emulateMedia({ forcedColors: "active" })

  try {
    await page.goto(origin)
    const action = page.getByRole("link", { name: "SmartThings 연결 시작" })
    await expect(action).toHaveCSS("border-top-style", "solid")
    await expect(action).toHaveCSS("border-top-width", "2px")
  } finally {
    await app.close()
  }
})

test("support HTTP page keeps its semantic secret warning", async ({ page }) => {
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({ apps })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })

  try {
    await page.goto(`${origin}/support`)
    await expect(page.getByRole("note")).toContainText("이메일로 비밀값을 보내지 마세요")
    await expect(page.getByText("지원에 보내도 되는 정보:", { exact: true })).toBeVisible()
    await expect(page.getByText("보내지 마세요:", { exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})
