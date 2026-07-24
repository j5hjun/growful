import { renderGatewayPage } from "./oauth-page.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import {
  portalSharedStyles,
  renderPortalEmailLink,
  renderPortalNavigation,
} from "./portal-shell.js"
import { renderSupportSafetyGuidance } from "./support-safety-copy.js"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function renderPortalSupport(access: OAuthAccessPolicy): string {
  const operatorName = escapeHtml(access.operatorName)
  const supportEmailAction = renderPortalEmailLink(access.supportEmail, {
    className: "action action-primary",
    label: "이메일 문의하기",
    supportEmailAction: true,
  })
  const supportEmailLink = renderPortalEmailLink(access.supportEmail)
  const accessBoundary =
    access.mode === "private_beta"
      ? "보안 사고, 약관 위반 또는 운영상 필요한 경우 비공개 베타 초대를 회수하거나 해당 연결의 Gateway API 중계 접근을 제한·중단할 수 있습니다."
      : "보안 사고, 약관 위반 또는 운영상 필요한 경우 해당 연결의 Gateway API 중계 접근을 제한·중단할 수 있습니다."
  const unresolvedProcessBoundary =
    access.mode === "private_beta"
      ? "분실한 토큰의 기존 연결을 찾아 정리하기 위한 본인 확인 절차, 개인정보 요청의 본인 확인 방식, 목표 응답시간과 보안 신고의 긴급 단계는 아직 확정되지 않았습니다. 초대 없이 이용 가능한 공개 접근 모드로 전환하기 전에 운영·법률 검토와 결정이 필요합니다."
      : "분실한 토큰의 기존 연결을 찾아 정리하기 위한 본인 확인 절차, 개인정보 요청의 본인 확인 방식, 목표 응답시간과 보안 신고의 긴급 단계는 아직 확정되지 않았습니다."

  return renderGatewayPage({
    body: `
    ${renderPortalNavigation("support")}
    <article class="support-document" data-support-document>
      <header>
        <p class="eyebrow">지원 안내</p>
        <h1>민감정보 없이 문제를 알려주세요</h1>
        <p class="support-summary">연결 문제, 토큰 노출 의심, 개인정보 요청과 보안 신고를 아래 지원 이메일로 접수합니다. 아직 목표 응답시간과 본인 확인 절차는 확정되지 않았습니다.</p>
        <div class="action-row support-actions">
          ${supportEmailAction}
        </div>
      </header>
      <section aria-labelledby="support-topics-title">
        <h2 id="support-topics-title">문의할 수 있는 내용</h2>
        <dl class="support-topics">
          <div data-support-topic="connection"><dt>SmartThings 연결 승인</dt><dd>승인 화면, 승인 후 돌아오는 단계, 연결 상태 확인 또는 Gateway의 API 중계 오류</dd></div>
          <div data-support-topic="token-exposure"><dt>토큰 노출 의심</dt><dd>Growful 토큰이 다른 사람이나 시스템에 노출되었을 가능성</dd></div>
          <div data-support-topic="privacy"><dt>개인정보 요청</dt><dd>자신의 연결 정보 확인, 접근 또는 삭제 요청</dd></div>
          <div data-support-topic="security"><dt>보안 신고</dt><dd>의심스러운 접근, 취약점 또는 서비스 악용 정황</dd></div>
        </dl>
      </section>
      <section aria-labelledby="support-safe-context-title">
        <h2 id="support-safe-context-title">안전하게 전달할 정보</h2>
        ${renderSupportSafetyGuidance()}
        <div class="warning" role="note">
          <strong>이메일로 비밀값을 보내지 마세요.</strong>
          <p>Growful은 위의 보내면 안 되는 비밀값이나 민감한 전체 응답 본문을 이메일로 요청하지 않습니다.</p>
        </div>
      </section>
      <section aria-labelledby="support-self-service-title">
        <h2 id="support-self-service-title">먼저 직접 할 수 있는 조치</h2>
        <div class="token-recovery" data-token-loss-recovery aria-labelledby="support-token-recovery-title">
          <h3 id="support-token-recovery-title">Growful 토큰을 잃어버린 경우</h3>
          <p>기존 Growful 토큰은 다시 조회하거나 복구할 수 없습니다. 새 연결 시작을 선택해 SmartThings 승인을 완료하면 새 Growful 토큰을 받을 수 있습니다. 같은 SmartThings 연결을 다시 승인하면 이전 Growful 토큰은 더 이상 사용할 수 없습니다. 별도 SmartThings 연결로 승인하면 기존 Growful 연결은 자동으로 해제되지 않고 남을 수 있습니다.</p>
          <a class="action action-primary" href="/oauth/start" data-token-loss-reconnect>새 연결 시작</a>
        </div>
        <ol>
          <li><a href="/manage">연결 관리</a>에서 Growful 토큰으로 상태를 확인합니다.</li>
          <li>Growful 토큰 노출이 의심되면 즉시 교체하고, 사용을 끝낼 때 연결을 해제합니다.</li>
        </ol>
        <p>이 작업은 Growful Gateway에 저장된 연결 정보만 삭제하며 SmartThings 쪽 상태는 변경하지 않습니다.</p>
      </section>
      <section aria-labelledby="support-boundaries-title">
        <h2 id="support-boundaries-title">현재 지원 절차의 경계</h2>
        <p>${unresolvedProcessBoundary}</p>
        <p>${accessBoundary}</p>
      </section>
      <section class="support-contact" aria-labelledby="support-contact-title">
        <h2 id="support-contact-title">운영자와 문의</h2>
        <dl>
          <div><dt>운영자</dt><dd>${operatorName}</dd></div>
          <div><dt>지원 이메일</dt><dd>${supportEmailLink}</dd></div>
        </dl>
      </section>
    </article>`,
    description:
      "Growful SmartThings Gateway 연결, 토큰 노출, 개인정보와 보안 문제를 민감정보 없이 문의하는 방법입니다.",
    layout: "manage",
    robots: access.mode === "public" ? "index,follow" : "noindex,nofollow",
    styles: `${portalSharedStyles}
    .support-document { padding-top: var(--space-8); }
    .support-document header { padding-bottom: var(--space-6); border-bottom: 1px solid var(--border); }
    .support-summary { max-width: var(--panel-manage); margin-bottom: 0; font-size: var(--font-h2); }
    .support-actions { margin-top: var(--space-6); }
    .support-document section { padding: var(--space-6) 0; border-bottom: 1px solid var(--border); }
    .support-document section:last-child { border-bottom: 0; padding-bottom: 0; }
    .support-document section h2 { margin: 0 0 var(--space-4); }
    .support-document section p:last-child, .support-document section ol:last-child { margin-bottom: 0; }
    .support-topics { display: grid; gap: var(--space-4); margin: 0; }
    .support-topics > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-4); }
    .support-topics dt { font-weight: var(--weight-bold); }
    .support-topics dd { margin: 0; color: var(--text-muted); }
    .support-document ol { display: grid; gap: var(--space-2); padding-left: var(--space-6); color: var(--text-muted); }
    .token-recovery { margin-bottom: var(--space-6); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); background: var(--surface-subtle); }
    .token-recovery h3 { margin: 0 0 var(--space-3); }
    .token-recovery p { margin-bottom: var(--space-3); }
    .token-recovery .action { width: 100%; }
    .warning { margin: var(--space-6) 0 0; padding: var(--space-4); border-left: 1px solid var(--error); background: var(--surface-subtle); }
    .warning p { margin-bottom: 0; }
    .support-contact dl { display: grid; gap: var(--space-3); margin: 0; }
    .support-contact dl div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-4); }
    .support-contact dt { color: var(--text-muted); }
    .support-contact dd { margin: 0; overflow-wrap: anywhere; }
    .support-document a:not(.action) { color: var(--text); }
    .support-document code { overflow-wrap: anywhere; }
    @media (max-width: 30rem) {
      .support-topics > div, .support-contact dl div { grid-template-columns: 1fr; gap: var(--space-2); }
    }`,
    title: "지원 안내 · Growful SmartThings Gateway",
  })
}
