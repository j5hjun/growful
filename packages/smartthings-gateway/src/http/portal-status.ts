import type { ReadinessStatus } from "../health/readiness.js"
import type {
  PublicServiceIncident,
  ServiceIncidentImpact,
  ServiceIncidentStatus,
} from "../status/service-status.js"
import { renderGatewayPage } from "./oauth-page.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import { portalSharedStyles, renderPortalNavigation } from "./portal-shell.js"

type StatusPresentation = {
  readonly label: string
  readonly summary: string
  readonly title: string
}

const statusPresentations = {
  ready: {
    label: "정상",
    summary: "현재 Gateway 프로세스와 필수 저장소가 일반 요청을 처리할 준비가 되었습니다.",
    title: "Gateway가 요청을 처리할 수 있습니다",
  },
  unavailable: {
    label: "이용 불가",
    summary:
      "현재 일반 요청을 처리할 준비가 되지 않았습니다. 복구 예상 시간은 아직 제공하지 않습니다.",
    title: "Gateway 준비 상태를 확인해 주세요",
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

export function renderPortalStatus(
  status: ReadinessStatus,
  incidents: readonly PublicServiceIncident[] | null,
  access: OAuthAccessPolicy,
  checkedAt: Date = new Date(),
): string {
  const presentation = statusPresentations[status]
  const activeIncidents = incidents?.filter((incident) => incident.status !== "resolved") ?? null
  const resolvedIncidents = incidents?.filter((incident) => incident.status === "resolved") ?? null
  const historyUnavailable =
    "<p data-incident-history-unavailable>현재 readiness 장애로 공지 이력을 불러올 수 없습니다.</p>"

  return renderGatewayPage({
    body: `
    ${renderPortalNavigation("status")}
    <article class="status-document" data-status-document data-service-status="${status}">
      <header>
        <p class="eyebrow">서비스 상태</p>
        <h1>Growful readiness</h1>
        <p class="status-summary">${presentation.summary}</p>
      </header>
      <section class="current-status" aria-labelledby="current-status-title" data-status-section="current">
        <div>
          <h2 id="current-status-title">현재 준비 상태</h2>
          <p class="status-label status-label-${status}">${presentation.label}</p>
          <p class="status-title"><span class="phrase">${presentation.title}</span></p>
        </div>
        <div class="status-check">
          <p>이 결과는 페이지를 연 시점의 Gateway readiness 검사입니다.</p>
          <dl><div><dt>마지막 확인 시각</dt><dd><time datetime="${checkedAt.toISOString()}">${formatKoreanDateTime(checkedAt)}</time></dd></div></dl>
          <div class="action-row">
            <a class="action action-secondary" href="/status" data-action="refresh-status">다시 확인</a>
            <a class="action action-secondary" href="/manage" data-action="check-connection">내 연결 확인</a>
          </div>
        </div>
      </section>
      <section class="incident-history" aria-labelledby="active-incidents-title" data-incident-history data-status-section="active-incidents">
        <h2 id="active-incidents-title">진행 중인 장애</h2>
        ${activeIncidents === null ? historyUnavailable : renderIncidentList(activeIncidents, "data-incident-empty", "진행 중인 장애가 없습니다.")}
      </section>
      <section class="incident-history" aria-labelledby="resolved-incidents-title" data-status-section="resolved-incidents">
        <h2 id="resolved-incidents-title">해결 이력</h2>
        ${resolvedIncidents === null ? historyUnavailable : renderIncidentList(resolvedIncidents, "data-resolved-incident-empty", "등록된 해결 이력이 없습니다.")}
      </section>
      <section aria-labelledby="status-scope-title" data-status-section="scope">
        <h2 id="status-scope-title">검사 범위</h2>
        <p>Gateway 프로세스가 실행 중이고 데이터베이스 질의와 감사 체인 검사를 통과했는지를 나타냅니다. 자동 확인에는 <a href="/readyz">기계용 readiness 응답</a>을 사용하세요.</p>
        <p><strong>SmartThings 외부 종단은 <span class="phrase">검사하지 않습니다.</span></strong> 개별 SmartThings 연결, 삼성 계정, SmartThings API의 지역별 상태나 종단 간 성공 여부를 이 신호로 확인하거나 SmartThings 상태를 추정하지 않습니다.</p>
        <p>공개 SLA와 가동률 목표는 아직 확정되지 않았습니다. 이 이력은 운영자가 등록한 공지이며 자동 장애 탐지나 개별 사용자 통지를 보장하지 않습니다.</p>
      </section>
      <section aria-labelledby="status-help-title" data-status-section="support">
        <h2 id="status-help-title">지원</h2>
        <p><a href="/manage">연결 관리</a>에서 자신의 연결 상태를 먼저 확인하세요. 비밀값을 제외한 발생 시각, 작업과 오류 종류를 <a href="/support">지원 안내</a>에 따라 보내 주세요.</p>
      </section>
    </article>`,
    description:
      "Growful SmartThings Gateway의 현재 준비 상태와 상태 신호가 의미하는 범위를 확인합니다.",
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
    .status-title { margin-bottom: 0; color: var(--text); font-size: var(--font-h2); font-weight: var(--weight-bold); line-height: var(--line-heading); }
    .status-check p { margin-bottom: var(--space-4); }
    .status-check dl { margin: 0 0 var(--space-4); }
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
    }`,
    title: "서비스 상태 · Growful SmartThings Gateway",
  })
}
