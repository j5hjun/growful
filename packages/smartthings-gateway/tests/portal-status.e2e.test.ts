import { Writable } from "node:stream"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ServiceIncidentIdSchema } from "../src/status/service-status.js"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"
import { publicOAuthAccess } from "./fixtures/oauth-access.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  vi.useRealTimers()
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
      '<h2 id="current-status-title">현재 Gateway 준비 상태</h2>',
    )
    const readyLabelIndex = response.body.indexOf(
      '<p class="status-label status-label-ready">Gateway 준비됨</p>',
    )
    expect(currentStateHeadingIndex).toBeGreaterThan(-1)
    expect(readyLabelIndex).toBeGreaterThan(currentStateHeadingIndex)
  })

  it("places the SmartThings boundary beside the current Gateway summary", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    expect(response.body).toContain(
      '<p class="status-title"><span class="phrase">Gateway 내부 준비 검사를 통과했습니다</span></p>',
    )
    const currentStatusIndex = response.body.indexOf('data-status-section="current"')
    const boundaryIndex = response.body.indexOf("data-status-boundary")
    const statusCheckIndex = response.body.indexOf('class="status-check"')
    const incidentHistoryIndex = response.body.indexOf("data-incident-history")
    expect(boundaryIndex).toBeGreaterThan(currentStatusIndex)
    expect(statusCheckIndex).toBeGreaterThan(boundaryIndex)
    expect(incidentHistoryIndex).toBeGreaterThan(statusCheckIndex)
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
    expect(response.body).toContain("<h1>Growful Gateway 상태</h1>")
    expect(response.body).toContain("Gateway 준비됨")
    expect(response.body).toContain("페이지 응답 확인 시각")
    const connectionAction =
      '<a class="action action-primary" href="/manage" data-action="check-connection">내 연결 확인</a>'
    const refreshAction =
      '<a class="action action-secondary" href="/status" data-action="refresh-status">다시 확인</a>'
    expect(response.body).toContain(connectionAction)
    expect(response.body).toContain(refreshAction)
    expect(response.body.indexOf(connectionAction)).toBeLessThan(
      response.body.indexOf(refreshAction),
    )
    expect(response.body).toContain('href="/support"')
    expect(response.body).toContain(publicOAuthAccess.operatorName)
    expect(response.body).toContain(
      `<!--email_off--><a href="mailto:${publicOAuthAccess.supportEmail}">${publicOAuthAccess.supportEmail}</a><!--/email_off-->`,
    )
    expect(response.body).not.toContain("/cdn-cgi/l/email-protection")
    expect(response.body).not.toContain("[email protected]")
    expect(response.headers["content-security-policy"]).not.toContain("script-src 'unsafe-inline'")
    expect(response.body).toContain("data-incident-history")
    expect(response.body).toContain("data-incident-empty")
    expect(response.body).toContain("data-resolved-incident-empty")
    expect(response.body).toContain("<title>Gateway 상태 · Growful SmartThings Gateway</title>")
    expect(response.body).toContain(
      '<meta name="description" content="Growful Gateway의 내부 준비 상태, 운영자 장애 공지, SmartThings 서비스 자체의 상태를 검사하지 않는 범위를 확인합니다.">',
    )
    const renderedText = response.body.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ")
    expect(renderedText).toContain(
      "SmartThings 서비스 자체의 상태, 개별 연결, 삼성 계정, 실제 SmartThings API 요청의 성공 여부",
    )
    expect(renderedText).toContain("Gateway 상태만으로 SmartThings 정상 여부를 알 수 없습니다")
    expect(renderedText).toContain("Gateway 실행·저장소 응답, 최근 감사 기록 검사 결과")
    expect(renderedText).toContain("필수 내부 검사가 통과한 경우")
    expect(renderedText).not.toContain("세 검사가 모두 통과")
    expect(renderedText.match(/SmartThings 서비스 자체의 상태/gu)).toHaveLength(1)

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
    const listPublicIncidents = vi.fn(async () => [])
    const { app } = createGatewayAppFixture({
      apps,
      readinessProbe: { check: async () => "unavailable" },
      serviceStatusSource: { listPublicIncidents },
    })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toContain("data-status-document")
    expect(response.body).toContain('data-service-status="unavailable"')
    expect(response.body).toContain("Gateway 준비 안 됨")
    expect(response.body).toContain(
      "현재 Growful Gateway가 요청을 처리하는 데 필요한 내부 준비를 마치지 못했습니다",
    )
    expect(response.body).toContain('data-incident-history-state="skipped"')
    expect(response.body).toContain('data-status-section="incidents-skipped"')
    expect(response.body).toContain(
      "Gateway 내부 준비 검사가 통과되지 않아 이번 요청에서는 공지 이력을 조회하지 않았습니다.",
    )
    expect(response.body).toContain("공지 이력 조회 실패와는 별개의 상태입니다.")
    expect(response.body.match(/data-incident-history-skipped/gu)).toHaveLength(1)
    const refreshAction =
      '<a class="action action-primary" href="/status" data-action="refresh-status">다시 확인</a>'
    const connectionAction =
      '<a class="action action-secondary" href="/manage" data-action="check-connection">내 연결 확인</a>'
    expect(response.body.indexOf(refreshAction)).toBeGreaterThan(-1)
    expect(response.body.indexOf(connectionAction)).toBeGreaterThan(
      response.body.indexOf(refreshAction),
    )
    expect(response.body).not.toContain('data-service-status="ready"')
    expect(response.body).not.toContain('data-status-section="active-incidents"')
    expect(response.body).not.toContain('data-status-section="resolved-incidents"')
    expect(response.body).not.toContain("data-incident-history-retrieval-failed")
    expect(listPublicIncidents).not.toHaveBeenCalled()
  })

  it("keeps the ready HTML available when incident retrieval fails", async () => {
    // Given
    const logChunks: string[] = []
    const sensitiveFailure = "postgresql://gateway:secret@database.internal incident failure"
    const { app } = createGatewayAppFixture({
      apps,
      logger: {
        level: "warn",
        stream: new Writable({
          write(chunk, _encoding, done) {
            logChunks.push(String(chunk))
            done()
          },
        }),
      },
      serviceStatusSource: {
        listPublicIncidents: async () => {
          throw new Error(sensitiveFailure)
        },
      },
    })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.body).toContain("data-status-document")
    expect(response.body).toContain('data-service-status="ready"')
    expect(response.body).toContain('data-incident-history-state="retrieval-failed"')
    expect(response.body).toContain('data-status-section="incidents-retrieval-failed"')
    expect(response.body).toContain(
      "공지 이력을 불러오지 못했습니다. Gateway 준비 상태와는 별개의 문제입니다. 잠시 후 다시 확인하세요.",
    )
    expect(response.body).toContain('data-action="check-connection"')
    expect(response.body).toContain("data-status-boundary")
    expect(response.body).not.toContain("data-incident-history-skipped")
    expect(response.body).not.toContain(sensitiveFailure)
    const logs = logChunks.join("")
    expect(logs).toContain("portal.status.incident_history_retrieval_failed")
    expect(logs).not.toContain(sensitiveFailure)
  })

  it("records the page response time after the asynchronous readiness probe", async () => {
    // Given
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-22T01:00:00.000Z"))
    const { app } = createGatewayAppFixture({
      apps,
      readinessProbe: {
        check: async () => {
          vi.setSystemTime(new Date("2026-07-22T01:30:00.000Z"))
          return "ready"
        },
      },
    })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    expect(response.body).toContain("페이지 응답 확인 시각")
    expect(response.body).toContain('<time datetime="2026-07-22T01:30:00.000Z">')
    expect(response.body).not.toContain('<time datetime="2026-07-22T01:00:00.000Z">')
  })

  it("separates active incidents from resolved history", async () => {
    // Given
    const startedAt = new Date("2026-07-22T01:00:00.000Z")
    const { app } = createGatewayAppFixture({
      apps,
      serviceStatusSource: {
        listPublicIncidents: async () => [
          {
            id: ServiceIncidentIdSchema.parse("00000000-0000-4000-8000-000000000001"),
            impact: "degraded",
            message: "Active incident message",
            resolvedAt: null,
            startedAt,
            status: "monitoring",
            title: "Active incident title",
            updatedAt: startedAt,
          },
          {
            id: ServiceIncidentIdSchema.parse("00000000-0000-4000-8000-000000000002"),
            impact: "outage",
            message: "Resolved incident message",
            resolvedAt: startedAt,
            startedAt,
            status: "resolved",
            title: "Resolved incident title",
            updatedAt: startedAt,
          },
        ],
      },
    })

    // When
    const response = await app.inject({ method: "GET", url: "/status" })

    // Then
    const activeStart = response.body.indexOf('data-status-section="active-incidents"')
    const resolvedStart = response.body.indexOf('data-status-section="resolved-incidents"')
    const scopeStart = response.body.indexOf('data-status-section="scope"')
    const activeSection = response.body.slice(activeStart, resolvedStart)
    const resolvedSection = response.body.slice(resolvedStart, scopeStart)
    expect(activeSection).toContain("Active incident title")
    expect(activeSection).not.toContain("Resolved incident title")
    expect(resolvedSection).toContain("Resolved incident title")
    expect(resolvedSection).not.toContain("Active incident title")
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
