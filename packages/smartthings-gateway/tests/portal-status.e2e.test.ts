import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { ServiceIncidentIdSchema } from "../src/status/service-status.js"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"
import { publicOAuthAccess } from "./fixtures/oauth-access.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("Growful portal status document", () => {
  it("announces the current-state heading before its status label", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    const currentStateHeadingIndex = response.body.indexOf(
      '<h2 id="current-status-title">현재 준비 상태</h2>',
    )
    const readyLabelIndex = response.body.indexOf(
      '<p class="status-label status-label-ready">정상</p>',
    )
    expect(currentStateHeadingIndex).toBeGreaterThan(-1)
    expect(readyLabelIndex).toBeGreaterThan(currentStateHeadingIndex)
  })

  it("keeps status boundary statements as semantic phrases", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    expect(response.body).toContain(
      '<p class="status-title"><span class="phrase">Gateway가 요청을 처리할 수 있습니다</span></p>',
    )
    expect(response.body).toContain(
      'SmartThings 외부 종단은 <span class="phrase">검사하지 않습니다.</span>',
    )
  })

  it("renders the current ready state with its operational boundary", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.body).toContain("data-status-document")
    expect(response.body).toContain('data-service-status="ready"')
    expect(response.body).toContain('href="/status" aria-current="page"')
    expect(response.body).toContain('href="/readyz"')
    expect(response.body).toContain("Growful readiness")
    expect(response.body).toContain("마지막 확인 시각")
    expect(response.body).toContain('href="/status" data-action="refresh-status"')
    expect(response.body).toContain('href="/manage" data-action="check-connection"')
    expect(response.body).toContain('href="/support"')
    expect(response.body).toContain(publicOAuthAccess.operatorName)
    expect(response.body).toContain(`href="mailto:${publicOAuthAccess.supportEmail}"`)
    expect(response.body).toContain("data-incident-history")
    expect(response.body).toContain("data-incident-empty")
    const renderedText = response.body.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ")
    expect(renderedText).toContain("SmartThings 외부 종단은 검사하지 않습니다.")
    expect(renderedText).toContain("SmartThings 상태를 추정하지 않습니다")

    const currentStatusIndex = response.body.indexOf('data-status-section="current"')
    const activeIncidentsIndex = response.body.indexOf('data-status-section="active-incidents"')
    const resolvedIncidentsIndex = response.body.indexOf('data-status-section="resolved-incidents"')
    const scopeIndex = response.body.indexOf('data-status-section="scope"')
    const supportIndex = response.body.indexOf('data-status-section="support"')
    expect(currentStatusIndex).toBeGreaterThan(-1)
    expect(activeIncidentsIndex).toBeGreaterThan(currentStatusIndex)
    expect(resolvedIncidentsIndex).toBeGreaterThan(activeIncidentsIndex)
    expect(scopeIndex).toBeGreaterThan(resolvedIncidentsIndex)
    expect(supportIndex).toBeGreaterThan(scopeIndex)
  })

  it("keeps the document readable when the gateway is unavailable", async () => {
    // Given
    const { app } = createGatewayAppFixture({
      apps,
      readinessProbe: { check: async () => "unavailable" },
    })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toContain("data-status-document")
    expect(response.body).toContain('data-service-status="unavailable"')
    expect(response.body).toContain("현재 일반 요청을 처리할 준비가 되지 않았습니다")
    expect(response.body).not.toContain('data-service-status="ready"')
  })

  it("renders operator-published incidents without interpreting their HTML", async () => {
    // Given
    const startedAt = new Date("2026-07-22T01:00:00.000Z")
    const updatedAt = new Date("2026-07-22T01:15:00.000Z")
    const { app } = createGatewayAppFixture({
      apps,
      serviceStatusSource: {
        listPublicIncidents: async () => [
          {
            id: ServiceIncidentIdSchema.parse("00000000-0000-4000-8000-000000000001"),
            impact: "degraded",
            message: "Investigating <script>unsafe()</script>",
            resolvedAt: null,
            startedAt,
            status: "investigating",
            title: "Device proxy latency",
            updatedAt,
          },
        ],
      },
    })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    expect(response.body).toContain('data-incident-status="investigating"')
    expect(response.body).toContain(`datetime="${startedAt.toISOString()}"`)
    expect(response.body).toContain(`datetime="${updatedAt.toISOString()}"`)
    expect(response.body).toContain("2026. 7. 22. 오전 10:00")
    expect(response.body).toContain("2026. 7. 22. 오전 10:15")
    expect(response.body).not.toContain(`>${startedAt.toISOString()}</time>`)
    expect(response.body).toContain("&lt;script&gt;unsafe()&lt;/script&gt;")
    expect(response.body).not.toContain("<script>unsafe()</script>")
  })
})
