import { expect, test } from "@playwright/test"
import type { FastifyInstance } from "fastify"
import { ServiceIncidentIdSchema } from "../src/status/service-status.js"
import { createGatewayAppFixture } from "../tests/fixtures/gateway-app-fixture.js"

const checkedAt = new Date("2026-07-24T01:00:00.000Z")
const incidents = [
  {
    id: ServiceIncidentIdSchema.parse("00000000-0000-4000-8000-000000000001"),
    impact: "degraded" as const,
    message: "연결 지연을 확인하고 있습니다.",
    resolvedAt: null,
    startedAt: checkedAt,
    status: "monitoring" as const,
    title: "진행 중인 연결 지연",
    updatedAt: checkedAt,
  },
  {
    id: ServiceIncidentIdSchema.parse("00000000-0000-4000-8000-000000000002"),
    impact: "outage" as const,
    message: "Gateway 저장소 연결을 복구했습니다.",
    resolvedAt: checkedAt,
    startedAt: checkedAt,
    status: "resolved" as const,
    title: "해결된 Gateway 장애",
    updatedAt: checkedAt,
  },
] as const

const viewportCases = [
  { height: 900, width: 320 },
  { height: 900, width: 375 },
  { height: 1_024, width: 768 },
  { height: 900, width: 1_280 },
] as const

async function startStatusApp(options: {
  readonly incidentFailure?: string
  readonly readiness?: "ready" | "unavailable"
  readonly serviceIncidents?: typeof incidents | readonly []
}) {
  const apps: FastifyInstance[] = []
  const { app } = createGatewayAppFixture({
    apps,
    readinessProbe: {
      check: async () => options.readiness ?? "ready",
    },
    serviceStatusSource: {
      listPublicIncidents: async () => {
        if (options.incidentFailure !== undefined) throw new Error(options.incidentFailure)
        return options.serviceIncidents ?? []
      },
    },
  })
  const origin = await app.listen({ host: "127.0.0.1", port: 0 })
  return { app, origin }
}

for (const viewport of viewportCases) {
  test(`Gateway status boundary reflows at ${viewport.width}px`, async ({ page }) => {
    // Given
    const { app, origin } = await startStatusApp({ serviceIncidents: incidents })
    await page.setViewportSize(viewport)

    try {
      // When
      await page.goto(`${origin}/status`)

      // Then
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Growful Gateway 상태")
      await expect(page.locator(".status-label")).toHaveText("Gateway 준비됨")
      await expect(page.locator("[data-status-boundary]")).toContainText(
        "Gateway 상태만으로 SmartThings 정상 여부를 알 수 없습니다",
      )
      await expect(page.locator("[data-status-boundary]")).toContainText(
        "SmartThings 서비스 자체의 상태",
      )
      await expect(page.locator("[data-status-boundary]")).toContainText("최근 감사 기록 검사 결과")
      await expect(page.locator('[data-incident-status="monitoring"]')).toContainText(
        "진행 중인 연결 지연",
      )
      await expect(page.locator('[data-incident-status="resolved"]')).toContainText(
        "해결된 Gateway 장애",
      )

      const currentSummary = await page.locator(".current-status > div").first().boundingBox()
      const boundary = await page.locator("[data-status-boundary]").boundingBox()
      const lastAction = await page.locator(".status-check .action").last().boundingBox()
      const layout = await page.locator("html").evaluate((html) => ({
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        currentColumns: getComputedStyle(
          document.querySelector(".current-status") as HTMLElement,
        ).gridTemplateColumns.split(" ").length,
        documentOverflow: html.scrollWidth - html.clientWidth,
      }))

      if (currentSummary === null || boundary === null || lastAction === null) {
        throw new Error(`Status summary has a missing layout box at ${viewport.width}px`)
      }
      expect(layout.bodyOverflow).toBeLessThanOrEqual(0)
      expect(layout.documentOverflow).toBeLessThanOrEqual(0)
      expect(layout.currentColumns).toBe(viewport.width <= 640 ? 1 : 2)
      if (viewport.width <= 640) {
        expect(boundary.y).toBeGreaterThanOrEqual(currentSummary.y + currentSummary.height)
      } else {
        expect(boundary.x).toBeGreaterThan(currentSummary.x)
        expect(boundary.y).toBeCloseTo(currentSummary.y, 0)
      }
      if (viewport.width === 320) {
        expect(lastAction.y + lastAction.height).toBeLessThanOrEqual(viewport.height)
      }
    } finally {
      await app.close()
    }
  })
}

test("Gateway status metadata and empty incident states stay explicit", async ({ page }) => {
  // Given
  const { app, origin } = await startStatusApp({ serviceIncidents: [] })

  try {
    // When
    await page.goto(`${origin}/status`)

    // Then
    await expect(page).toHaveTitle("Gateway 상태 · Growful SmartThings Gateway")
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Growful Gateway의 내부 준비 상태, 운영자 장애 공지, SmartThings 서비스 자체의 상태를 검사하지 않는 범위를 확인합니다.",
    )
    await expect(page.locator("[data-incident-empty]")).toHaveText("진행 중인 장애가 없습니다.")
    await expect(page.locator("[data-resolved-incident-empty]")).toHaveText(
      "등록된 해결 이력이 없습니다.",
    )
  } finally {
    await app.close()
  }
})

test("unavailable Gateway state explains why incident history was not queried", async ({
  page,
}) => {
  // Given
  const { app, origin } = await startStatusApp({ readiness: "unavailable" })

  try {
    // When
    await page.goto(`${origin}/status`)

    // Then
    await expect(page.locator(".status-label")).toHaveText("Gateway 준비 안 됨")
    await expect(page.locator('[data-incident-history-state="skipped"]')).toHaveCount(1)
    await expect(page.locator("[data-incident-history-skipped]")).toContainText(
      "이번 요청에서는 공지 이력을 조회하지 않았습니다",
    )
    await expect(page.locator("[data-incident-history-skipped]")).toContainText(
      "공지 이력 조회 실패와는 별개의 상태입니다",
    )
    await expect(page.locator("[data-incident-history-retrieval-failed]")).toHaveCount(0)
    await expect(page.locator('[data-status-section="active-incidents"]')).toHaveCount(0)
    await expect(page.locator('[data-status-section="resolved-incidents"]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test("incident retrieval failure leaves the ready Gateway screen intact", async ({ page }) => {
  // Given
  const sensitiveFailure = "database.internal:5432 incident storage unavailable"
  const { app, origin } = await startStatusApp({ incidentFailure: sensitiveFailure })

  try {
    // When
    await page.goto(`${origin}/status`)

    // Then
    await expect(page.locator(".status-label")).toHaveText("Gateway 준비됨")
    await expect(page.locator("[data-status-boundary]")).toBeVisible()
    await expect(page.locator(".status-check .action")).toHaveCount(2)
    await expect(page.locator('[data-incident-history-state="retrieval-failed"]')).toHaveCount(1)
    await expect(page.locator("[data-incident-history-retrieval-failed]")).toHaveText(
      "공지 이력을 불러오지 못했습니다. Gateway 준비 상태와는 별개의 문제입니다. 잠시 후 다시 확인하세요.",
    )
    await expect(page.locator("[data-incident-history-skipped]")).toHaveCount(0)
    await expect(page.locator("body")).not.toContainText(sensitiveFailure)
  } finally {
    await app.close()
  }
})

const actionCases = [
  {
    firstAction: "check-connection",
    firstLabel: "내 연결 확인",
    readiness: "ready",
    secondAction: "refresh-status",
    secondLabel: "다시 확인",
  },
  {
    firstAction: "refresh-status",
    firstLabel: "다시 확인",
    readiness: "unavailable",
    secondAction: "check-connection",
    secondLabel: "내 연결 확인",
  },
] as const

for (const actionCase of actionCases) {
  test(`${actionCase.readiness} status prioritizes and focuses the correct action at 320px`, async ({
    page,
  }) => {
    // Given
    const { app, origin } = await startStatusApp({ readiness: actionCase.readiness })
    await page.setViewportSize({ height: 900, width: 320 })

    try {
      await page.goto(`${origin}/status`)
      const actions = page.locator(".status-check .action")

      // Then
      await expect(actions).toHaveCount(2)
      await expect(actions.nth(0)).toHaveAttribute("data-action", actionCase.firstAction)
      await expect(actions.nth(0)).toHaveText(actionCase.firstLabel)
      await expect(actions.nth(0)).toHaveClass(/\baction-primary\b/u)
      await expect(actions.nth(1)).toHaveAttribute("data-action", actionCase.secondAction)
      await expect(actions.nth(1)).toHaveText(actionCase.secondLabel)
      await expect(actions.nth(1)).toHaveClass(/\baction-secondary\b/u)
      const lastAction = await actions.nth(1).boundingBox()
      if (lastAction === null) throw new Error(`${actionCase.readiness} action has no layout box`)
      expect(lastAction.y + lastAction.height).toBeLessThanOrEqual(900)

      // When
      await page.keyboard.press("Tab")
      const skipLink = page.locator(".skip-link")
      await expect(skipLink).toBeFocused()
      await expect(skipLink).toHaveCSS("outline-style", "solid")
      await page.keyboard.press("Enter")
      await expect(page.locator("main#main-content")).toBeFocused()
      await page.keyboard.press("Tab")

      // Then
      await expect(actions.nth(0)).toBeFocused()
      await expect(actions.nth(0)).toHaveCSS("outline-style", "solid")
      await page.keyboard.press("Tab")
      await expect(actions.nth(1)).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(page.locator('a[href="/readyz"]')).toBeFocused()
    } finally {
      await app.close()
    }
  })
}

test("status content reflows at 200 percent without overlap or horizontal scrolling", async ({
  page,
}) => {
  // Given
  const { app, origin } = await startStatusApp({ serviceIncidents: incidents })
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
    // When
    await page.goto(`${origin}/status`)

    // Then
    const currentSummary = await page.locator(".current-status > div").first().boundingBox()
    const boundary = await page.locator("[data-status-boundary]").boundingBox()
    const layout = await page.locator("html").evaluate((html) => ({
      bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      devicePixelRatio: window.devicePixelRatio,
      documentOverflow: html.scrollWidth - html.clientWidth,
      innerWidth: window.innerWidth,
    }))
    if (currentSummary === null || boundary === null) {
      throw new Error("Status reflow regions have a missing browser layout box")
    }
    expect(boundary.y).toBeGreaterThanOrEqual(currentSummary.y + currentSummary.height)
    expect(layout.bodyOverflow).toBeLessThanOrEqual(0)
    expect(layout.documentOverflow).toBeLessThanOrEqual(0)
    expect(layout.devicePixelRatio).toBe(2)
    expect(layout.innerWidth).toBe(640)
  } finally {
    await app.close()
  }
})

test("forced colors preserve the Gateway state and SmartThings boundary", async ({ page }) => {
  // Given
  const { app, origin } = await startStatusApp({})
  await page.setViewportSize({ height: 900, width: 375 })
  await page.emulateMedia({ forcedColors: "active" })

  try {
    // When
    await page.goto(`${origin}/status`)

    // Then
    const currentMenu = page.locator('.nav-list a[aria-current="page"]')
    await expect(currentMenu).toHaveCSS("border-top-style", "solid")
    await expect(currentMenu).toHaveCSS("border-top-width", "2px")
    await expect(page.locator(".status-label")).toHaveCSS("border-top-style", "solid")
    await expect(page.locator(".status-label")).toHaveCSS("border-top-width", "2px")
    await expect(page.locator("[data-status-boundary]")).toHaveCSS("border-top-style", "solid")
    await expect(page.locator("[data-status-boundary]")).toHaveCSS("border-top-width", "2px")
    await expect(page.locator(".status-check .action-primary")).toHaveCSS("border-top-width", "2px")
  } finally {
    await app.close()
  }
})
