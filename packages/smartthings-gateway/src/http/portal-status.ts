import type { ReadinessStatus } from "../health/readiness.js"
import type {
  PublicServiceIncident,
  ServiceIncidentImpact,
  ServiceIncidentStatus,
} from "../status/service-status.js"
import { renderGatewayPage } from "./oauth-page.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import { portalSharedStyles, renderPortalNavigation } from "./portal-shell.js"
import { renderSupportSafetyGuidance } from "./support-safety-copy.js"

type StatusPresentation = {
  readonly label: string
  readonly summary: string
  readonly title: string
}

const statusPresentations = {
  ready: {
    label: "Gateway 준비됨",
    summary: "현재 Growful Gateway가 요청을 처리하는 데 필요한 내부 준비를 마쳤습니다.",
    title: "Gateway 내부 준비 검사를 통과했습니다",
  },
  unavailable: {
    label: "Gateway 준비 안 됨",
    summary:
      "현재 Growful Gateway가 요청을 처리하는 데 필요한 내부 준비를 마치지 못했습니다. 복구 예상 시간은 아직 제공하지 않습니다.",
    title: "Gateway 내부 준비 검사를 통과하지 못했습니다",
  },
} as const satisfies Record<ReadinessStatus, StatusPresentation>

const incidentImpactLabels = {
  degraded: "일부 기능 저하",
  outage: "서비스 중단",
} as const satisfies Record<ServiceIncidentImpact, string>

const incidentStatusLabels = {
  investigating: "조사 중",
  monitoring: "복구 관찰 중",
  resolved: "해결됨",
} as const satisfies Record<ServiceIncidentStatus, string>

const koreanDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  day: "numeric",
  hour: "numeric",
  hour12: true,
  minute: "2-digit",
  month: "numeric",
  timeZone: "Asia/Seoul",
  year: "numeric",
})

function formatKoreanDateTime(value: Date): string {
  return koreanDateTimeFormatter
    .format(value)
    .replace(/\bAM\b/u, "오전")
    .replace(/\bPM\b/u, "오후")
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function renderIncidentList(
  incidents: readonly PublicServiceIncident[],
  emptyAttribute: "data-incident-empty" | "data-resolved-incident-empty",
  emptyMessage: string,
): string {
  if (incidents.length === 0) {
    return `<p ${emptyAttribute}>${emptyMessage}</p>`
  }
  return `<ol class="incident-list">${incidents
    .map(
      (incident) => `<li data-incident data-incident-status="${incident.status}">
            <div class="incident-heading">
              <div><p class="incident-label incident-label-${incident.status}">${incidentStatusLabels[incident.status]} · ${incidentImpactLabels[incident.impact]}</p><h3>${escapeHtml(incident.title)}</h3></div>
              <dl><div><dt>시작</dt><dd><time datetime="${incident.startedAt.toISOString()}">${formatKoreanDateTime(incident.startedAt)}</time></dd></div><div><dt>최근 갱신</dt><dd><time datetime="${incident.updatedAt.toISOString()}">${formatKoreanDateTime(incident.updatedAt)}</time></dd></div></dl>
            </div>
            <p>${escapeHtml(incident.message)}</p>
          </li>`,
    )
    .join("")}</ol>`
}

export type PortalStatusIncidentHistory =
  | {
      readonly incidents: readonly PublicServiceIncident[]
      readonly state: "available"
    }
  | {
      readonly state: "retrieval-failed"
    }
  | {
      readonly state: "skipped"
    }

function renderIncidentHistory(history: PortalStatusIncidentHistory): string {
  if (history.state === "skipped") {
    return `<section class="incident-history" aria-labelledby="incident-history-title" data-incident-history data-incident-history-state="skipped" data-status-section="incidents-skipped">
        <h2 id="incident-history-title">장애 공지</h2>
        <p data-incident-history-skipped>Gateway 내부 준비 검사가 통과되지 않아 이번 요청에서는 공지 이력을 조회하지 않았습니다. 공지 이력 조회 실패와는 별개의 상태입니다.</p>
      </section>`
  }
  if (history.state === "retrieval-failed") {
    return `<section class="incident-history" aria-labelledby="incident-history-title" data-incident-history data-incident-history-state="retrieval-failed" data-status-section="incidents-retrieval-failed">
        <h2 id="incident-history-title">장애 공지</h2>
        <p data-incident-history-retrieval-failed>공지 이력을 불러오지 못했습니다. Gateway 준비 상태와는 별개의 문제입니다. 잠시 후 다시 확인하세요.</p>
      </section>`
  }

  const activeIncidents = history.incidents.filter((incident) => incident.status !== "resolved")
  const resolvedIncidents = history.incidents.filter((incident) => incident.status === "resolved")
  return `<section class="incident-history" aria-labelledby="active-incidents-title" data-incident-history data-incident-history-state="available" data-status-section="active-incidents">
        <h2 id="active-incidents-title">진행 중인 장애</h2>
        ${renderIncidentList(activeIncidents, "data-incident-empty", "진행 중인 장애가 없습니다.")}
      </section>
      <section class="incident-history" aria-labelledby="resolved-incidents-title" data-status-section="resolved-incidents">
        <h2 id="resolved-incidents-title">해결 이력</h2>
        ${renderIncidentList(
          resolvedIncidents,
          "data-resolved-incident-empty",
          "등록된 해결 이력이 없습니다.",
        )}
      </section>`
}

function renderStatusActions(status: ReadinessStatus): string {
  const refreshAction = `<a class="action ${status === "unavailable" ? "action-primary" : "action-secondary"}" href="/status" data-action="refresh-status">다시 확인</a>`
  const connectionAction = `<a class="action ${status === "ready" ? "action-primary" : "action-secondary"}" href="/manage" data-action="check-connection">내 연결 확인</a>`
  return status === "ready"
    ? `${connectionAction}
              ${refreshAction}`
    : `${refreshAction}
              ${connectionAction}`
}

export function renderPortalStatus(
  status: ReadinessStatus,
  incidentHistory: PortalStatusIncidentHistory,
  access: OAuthAccessPolicy,
  respondedAt: Date = new Date(),
): string {
  const presentation = statusPresentations[status]

  return renderGatewayPage({
    body: `
    ${renderPortalNavigation("status")}
    <article class="status-document" data-status-document data-service-status="${status}">
      <header>
        <p class="eyebrow">SmartThings Gateway</p>
        <h1>Growful Gateway 상태</h1>
        <p class="status-summary">${presentation.summary}</p>
      </header>
      <section class="current-status" aria-labelledby="current-status-title" data-status-section="current">
        <div>
          <h2 id="current-status-title">현재 Gateway 준비 상태</h2>
          <p class="status-label status-label-${status}">${presentation.label}</p>
          <p class="status-title"><span class="phrase">${presentation.title}</span></p>
        </div>
        <div class="status-context">
          <aside class="status-boundary" aria-labelledby="status-boundary-title" data-status-boundary>
            <h2 id="status-boundary-title">Gateway 상태만으로 SmartThings 정상 여부를 알 수 없습니다</h2>
            <dl>
              <div><dt>이 신호가 확인함</dt><dd>Gateway 실행·저장소 응답, 최근 감사 기록 검사 결과</dd></div>
              <div><dt>이 신호가 확인하지 않음</dt><dd>SmartThings 서비스 자체의 상태, 개별 연결, 삼성 계정, 실제 SmartThings API 요청의 성공 여부</dd></div>
            </dl>
          </aside>
          <div class="status-check">
            <div class="action-row">
              ${renderStatusActions(status)}
            </div>
            <p>이 결과는 현재 페이지 응답을 위한 Gateway 내부 준비 상태입니다.</p>
            <dl><div><dt>페이지 응답 확인 시각</dt><dd><time datetime="${respondedAt.toISOString()}">${formatKoreanDateTime(respondedAt)}</time></dd></div></dl>
          </div>
        </div>
      </section>
      ${renderIncidentHistory(incidentHistory)}
      <section aria-labelledby="status-scope-title" data-status-section="scope">
        <h2 id="status-scope-title">판정과 공지 범위</h2>
        <p>필수 내부 검사가 통과한 경우에만 <strong>Gateway 준비됨</strong>으로 표시합니다. 자동 확인에는 <a href="/readyz">기계용 Gateway 준비 상태 응답</a>을 사용하세요.</p>
        <p>공개 가동률 보장 목표와 목표 수치는 아직 확정되지 않았습니다. 이 이력은 운영자가 등록한 공지이며 자동 장애 탐지나 개별 사용자 통지를 보장하지 않습니다.</p>
      </section>
      <section aria-labelledby="status-help-title" data-status-section="support">
        <h2 id="status-help-title">지원</h2>
        <p><a href="/manage">연결 관리</a>에서 자신의 연결 상태를 먼저 확인하세요. 자세한 문의 방법은 <a href="/support">지원 안내</a>에서 확인할 수 있습니다.</p>
        ${renderSupportSafetyGuidance()}
      </section>
    </article>`,
    description:
      "Growful Gateway의 내부 준비 상태, 운영자 장애 공지, SmartThings 서비스 자체의 상태를 검사하지 않는 범위를 확인합니다.",
    layout: "manage",
    robots: access.mode === "public" ? "index,follow" : "noindex,nofollow",
    styles: `${portalSharedStyles}
    .status-document { padding-top: var(--space-8); }
    .status-document header { padding-bottom: var(--space-6); border-bottom: 1px solid var(--border); }
    .status-summary { max-width: var(--panel-manage); margin-bottom: 0; font-size: var(--font-h2); }
    .status-document section { padding: var(--space-6) 0; border-bottom: 1px solid var(--border); }
    .status-document section:last-child { border-bottom: 0; padding-bottom: 0; }
    .status-document section h2 { margin: 0 0 var(--space-4); }
    .status-document section p:last-child { margin-bottom: 0; }
    .current-status { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); align-items: start; }
    .current-status h2 { margin-bottom: var(--space-3); }
    .status-context { display: grid; gap: var(--space-4); }
    .status-boundary { padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); background: var(--surface-subtle); }
    .status-boundary h2 { font-size: var(--font-body); }
    .status-boundary dl { display: grid; gap: var(--space-3); margin: 0; }
    .status-boundary dl div { display: grid; gap: var(--space-2); }
    .status-boundary dt { color: var(--text); font-size: var(--font-small); font-weight: var(--weight-bold); }
    .status-boundary dd { margin: 0; color: var(--text-muted); line-height: var(--line-body); }
    .status-title { margin-bottom: 0; color: var(--text); font-size: var(--font-h2); font-weight: var(--weight-bold); line-height: var(--line-heading); }
    .status-check { display: grid; gap: var(--space-3); }
    .status-check p { margin: 0; }
    .status-check dl { margin: 0; }
    .status-check dl div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-3); }
    .status-check dt { color: var(--text-muted); font-size: var(--font-small); }
    .status-check dd { margin: 0; font-size: var(--font-small); }
    .status-label { display: inline-flex; margin-bottom: var(--space-2); font-size: var(--font-small); font-weight: var(--weight-bold); }
    .status-label-ready { color: var(--success); }
    .status-label-unavailable { color: var(--error); }
    .incident-list { display: grid; gap: var(--space-4); margin: 0; padding: 0; list-style: none; }
    .incident-list li { padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); }
    .incident-heading { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-4); }
    .incident-heading h3 { margin: 0; }
    .incident-label { margin-bottom: var(--space-2); color: var(--error); font-size: var(--font-small); font-weight: var(--weight-bold); }
    .incident-label-resolved { color: var(--success); }
    .incident-heading dl { display: grid; gap: var(--space-2); margin: 0; }
    .incident-heading dl div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-2); }
    .incident-heading dt { color: var(--text-muted); font-size: var(--font-small); }
    .incident-heading dd { margin: 0; font-size: var(--font-small); overflow-wrap: anywhere; }
    .incident-list li > p { margin: var(--space-4) 0 0; white-space: pre-wrap; }
    .status-document a { color: var(--text); }
    @media (max-width: 30rem) {
      .current-status, .incident-heading, .status-check dl div { grid-template-columns: 1fr; gap: var(--space-2); }
    }
    @media (max-width: 20rem) {
      .status-document { width: calc(100% - 1px); min-width: 0; padding-top: var(--space-6); }
      .status-document header { padding-bottom: var(--space-3); }
      .status-document .current-status { padding-top: var(--space-3); }
      .status-context { gap: var(--space-3); }
      .status-boundary { padding: var(--space-3); }
      .status-boundary h2 { margin-bottom: var(--space-3); }
      .status-boundary dl { gap: var(--space-2); }
      .status-check .action-row { flex-direction: row; gap: var(--space-2); }
      .status-check .action { width: auto; min-width: 0; flex: 1 1 0; padding-inline: var(--space-2); }
    }
    @media (forced-colors: active) {
      .status-boundary, .status-label { border: 2px solid CanvasText; }
    }`,
    title: "Gateway 상태 · Growful SmartThings Gateway",
  })
}
