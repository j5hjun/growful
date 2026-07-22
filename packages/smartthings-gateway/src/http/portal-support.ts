import { renderGatewayPage } from "./oauth-page.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import { portalSharedStyles, renderPortalNavigation } from "./portal-shell.js"

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
  const supportEmail = escapeHtml(access.supportEmail)
  const accessBoundary =
    access.mode === "private_beta"
      ? "보안 사고, 약관 위반 또는 운영상 필요한 경우 비공개 베타 초대나 접근을 회수할 수 있습니다."
      : "보안 사고, 약관 위반 또는 운영상 필요한 경우 해당 연결의 API 접근을 제한할 수 있습니다."

  return renderGatewayPage({
    body: `
    ${renderPortalNavigation("support")}
    <article class="support-document" data-support-document>
      <header>
        <p class="eyebrow">지원 안내</p>
        <h1>민감정보 없이 문제를 알려주세요</h1>
        <p class="support-summary">연결 문제, 토큰 노출 의심, 개인정보 요청과 보안 신고를 아래 지원 이메일로 접수합니다. 아직 공개 응답시간과 본인 확인 절차는 확정되지 않았습니다.</p>
      </header>
      <section aria-labelledby="support-topics-title">
        <h2 id="support-topics-title">문의할 수 있는 내용</h2>
        <ul class="support-topics">
          <li data-support-topic="connection"><strong>연결과 OAuth</strong><span>승인 화면, callback, 연결 상태 확인 또는 API 중계 오류</span></li>
          <li data-support-topic="token-exposure"><strong>토큰 노출 의심</strong><span>Growful 토큰이 다른 사람이나 시스템에 노출되었을 가능성</span></li>
          <li data-support-topic="privacy"><strong>개인정보 요청</strong><span>자신의 연결 정보 확인, 접근 또는 삭제 요청</span></li>
          <li data-support-topic="security"><strong>보안 신고</strong><span>의심스러운 접근, 취약점 또는 서비스 악용 정황</span></li>
        </ul>
      </section>
      <section aria-labelledby="support-safe-context-title">
        <h2 id="support-safe-context-title">안전하게 전달할 정보</h2>
        <p>가능한 경우 연결 관리 화면의 가명 <code>supportReference</code>, 문제가 발생한 대략적인 시각, 시도한 작업, HTTP 상태나 오류 종류, 브라우저·기기 종류만 전달해 주세요.</p>
        <div class="warning" role="note">
          <strong>이메일로 비밀값을 보내지 마세요.</strong>
          <p>Growful 토큰 원문, SmartThings access·refresh token, OAuth code, 비밀번호, 민감한 전체 응답 본문은 요청하지 않으며 보내면 안 됩니다.</p>
        </div>
      </section>
      <section aria-labelledby="support-self-service-title">
        <h2 id="support-self-service-title">먼저 직접 할 수 있는 조치</h2>
        <ol>
          <li><a href="/manage">연결 관리</a>에서 Growful 토큰으로 상태를 확인합니다.</li>
          <li>노출이 의심되지만 연결을 유지해야 한다면 Growful 토큰을 교체합니다.</li>
          <li>사용을 끝내거나 SmartThings 토큰까지 폐기하려면 Growful 연결을 해제합니다.</li>
        </ol>
        <p>Growful 연결 해제는 Gateway의 활성 연결과 저장 토큰을 삭제하지만 SmartThings 설치 자체는 삭제하지 않습니다. 필요한 경우 SmartThings에서도 설치를 별도로 삭제해야 합니다.</p>
      </section>
      <section aria-labelledby="support-boundaries-title">
        <h2 id="support-boundaries-title">현재 지원 절차의 경계</h2>
        <p>Growful 토큰을 잃어버린 사용자의 신원을 확인하고 연결을 복구하는 절차, 개인정보 요청의 본인 확인 방식, 목표 응답시간과 보안 신고의 긴급 단계는 아직 확정되지 않았습니다. 공개 출시 전에 운영·법률 검토를 거쳐 확정해야 합니다.</p>
        <p>${accessBoundary}</p>
      </section>
      <section class="support-contact" aria-labelledby="support-contact-title">
        <h2 id="support-contact-title">운영자와 문의</h2>
        <dl>
          <div><dt>운영자</dt><dd>${operatorName}</dd></div>
          <div><dt>지원 이메일</dt><dd><a href="mailto:${supportEmail}">${supportEmail}</a></dd></div>
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
    .support-document section { padding: var(--space-6) 0; border-bottom: 1px solid var(--border); }
    .support-document section:last-child { border-bottom: 0; padding-bottom: 0; }
    .support-document section h2 { margin: 0 0 var(--space-4); }
    .support-document section p:last-child, .support-document section ol:last-child { margin-bottom: 0; }
    .support-topics { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
    .support-topics li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-4); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); }
    .support-topics span { color: var(--text-muted); }
    .support-document ol { display: grid; gap: var(--space-2); padding-left: var(--space-6); color: var(--text-muted); }
    .warning { margin: var(--space-6) 0 0; padding: var(--space-4); border-left: 1px solid var(--error); background: var(--surface-subtle); }
    .warning p { margin-bottom: 0; }
    .support-contact dl { display: grid; gap: var(--space-3); margin: 0; }
    .support-contact dl div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-4); }
    .support-contact dt { color: var(--text-muted); }
    .support-contact dd { margin: 0; overflow-wrap: anywhere; }
    .support-document a { color: var(--text); }
    .support-document code { overflow-wrap: anywhere; }
    @media (max-width: 30rem) {
      .support-topics li, .support-contact dl div { grid-template-columns: 1fr; gap: var(--space-2); }
    }`,
    title: "지원 안내 · Growful SmartThings Gateway",
  })
}
