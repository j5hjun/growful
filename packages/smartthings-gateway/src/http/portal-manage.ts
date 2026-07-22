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

export function renderPortalManagement(access: OAuthAccessPolicy): string {
  const supportEmail = escapeHtml(access.supportEmail)
  return renderGatewayPage({
    body: `
    ${renderPortalNavigation("manage")}
    <header class="manage-header">
      <p class="eyebrow">연결 관리</p>
      <h1><span class="phrase">Growful 토큰으로</span> <span class="phrase">연결 확인</span></h1>
      <p>토큰은 이 탭을 닫거나 새로고침하면 사라집니다. <span class="phrase">브라우저에 저장하지 않습니다.</span></p>
    </header>
    <form class="token-form" action="/manage" method="post" data-portal-token-form novalidate>
      <div class="token-entry-region">
        <label for="growful-token">Growful 토큰</label>
        <div class="token-entry">
          <input id="growful-token" name="growfulToken" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" pattern="grw_st_[A-Za-z0-9_\\-]{43}" minlength="50" maxlength="50" aria-describedby="token-hint" required>
          <button class="secondary reveal" type="button" data-token-visibility aria-controls="growful-token" aria-pressed="false">토큰 보기</button>
        </div>
        <p class="hint" id="token-hint">연결 완료 화면에서 한 번 표시된 <span class="phrase"><code>grw_st_</code> 토큰을</span> 붙여 넣으세요.</p>
      </div>
      <div class="connection-state-region">
        <p class="feedback" data-portal-feedback role="status" aria-live="polite" hidden></p>
        <div class="error" data-portal-error role="alert" hidden><p data-portal-error-message></p></div>
        <section class="connection-status" data-portal-status aria-labelledby="connection-title" tabindex="-1" hidden>
          <div class="status-heading">
            <div><p class="status-indicator" data-status-active>API 사용 가능</p><p class="status-indicator status-blocked" data-status-blocked hidden>API 접근 차단</p><h2 id="connection-title">SmartThings 연결 상태</h2></div>
            <button class="secondary" type="button" data-forget-token>이 탭에서 토큰 지우기</button>
          </div>
          <dl>
            <div><dt>토큰 만료 예정</dt><dd><time data-expires-at></time></dd></div>
            <div><dt>마지막 자동 갱신</dt><dd><time data-refreshed-at></time></dd></div>
            <div class="support-entry"><dt>지원 참조</dt><dd class="support-value"><output data-support-reference></output><button class="secondary compact" type="button" data-copy-support-reference>지원 참조 복사</button></dd></div>
          </dl>
          <section class="restricted-notice" data-blocked-notice role="alert" aria-labelledby="blocked-title" hidden>
            <p class="eyebrow">API 접근 차단</p>
            <h3 id="blocked-title">SmartThings API 요청이 차단되었습니다</h3>
            <p data-block-reason></p>
            <p>차단 적용: <time data-blocked-at></time></p>
            <p>문의할 때 위 지원 참조를 함께 전달해 주세요. <a href="mailto:${supportEmail}">${supportEmail}</a></p>
          </section>
          <section class="scope-section" aria-labelledby="scope-title">
            <h3 id="scope-title">승인된 권한</h3>
            <ul data-scope-list></ul>
          </section>
          <div class="action-row status-actions">
            <button class="secondary" type="button" data-rotate-token>Growful 토큰 교체</button>
            <button class="destructive" type="button" data-disconnect>연결 해제</button>
          </div>
        </section>
      </div>
      <div class="connection-action-slot">
        <button class="primary" type="submit" data-token-submit>연결 상태 확인</button>
        <a class="action action-primary" href="/oauth/start" data-reconnect hidden>SmartThings 다시 연결</a>
      </div>
    </form>
    <section class="credential-output" data-token-safety data-rotated-token-section aria-labelledby="rotated-token-title" hidden>
      <p class="eyebrow">교체 완료</p>
      <h2 id="rotated-token-title">새 Growful 토큰</h2>
      <p><span class="phrase">이 토큰은 다시 확인할 수 없습니다.</span> <span class="phrase">지금 복사해 안전한 곳에 보관하세요.</span></p>
      <output id="rotated-growful-token" data-token-value data-rotated-token tabindex="-1"></output>
      <p class="copy-feedback" data-token-copy-feedback role="status" aria-live="polite" hidden>새 Growful 토큰을 클립보드에 복사했습니다.</p>
      <p class="copy-error" data-token-copy-error role="alert" hidden><span class="phrase">자동 복사를 사용할 수 없습니다.</span> <span class="phrase">위 토큰을 직접 복사하세요.</span></p>
      <div class="credential-actions">
        <button class="primary" type="button" data-copy-token aria-controls="rotated-growful-token">새 토큰 복사</button>
        <button class="secondary" type="button" data-return-status>상태로 돌아가기</button>
      </div>
    </section>
    <dialog data-rotate-token-dialog aria-labelledby="rotate-token-title" aria-describedby="rotate-token-description">
      <form class="dialog-content" method="dialog" data-rotate-token-form>
        <h2 id="rotate-token-title">Growful 토큰을 교체할까요?</h2>
        <p id="rotate-token-description"><span class="phrase">교체하면 현재 토큰은 즉시 무효화됩니다.</span> <span class="phrase">모든 소비자 설정을 새 토큰으로 변경해야 합니다.</span></p>
        <div class="action-row">
          <button class="secondary" type="submit" value="cancel">취소</button>
          <button class="destructive" type="submit" value="confirm" data-rotate-token-confirm>토큰 교체</button>
        </div>
      </form>
    </dialog>
    <dialog data-disconnect-dialog aria-labelledby="disconnect-title" aria-describedby="disconnect-description">
      <form class="dialog-content" method="dialog" data-disconnect-form>
        <h2 id="disconnect-title">연결을 해제할까요?</h2>
        <p id="disconnect-description"><span class="phrase">저장된 SmartThings 토큰과</span> <span class="phrase">Growful 토큰이 삭제됩니다.</span> <span class="phrase">SmartThings Linked Service 설치는</span> <span class="phrase">별도로 해제해야 합니다.</span></p>
        <div class="action-row">
          <button class="secondary" type="submit" value="cancel">취소</button>
          <button class="destructive" type="submit" value="confirm" data-disconnect-confirm>연결 해제</button>
        </div>
      </form>
    </dialog>`,
    description:
      "Growful 토큰으로 SmartThings 연결 상태와 만료 시각을 확인하고 토큰을 교체하거나 연결을 해제합니다.",
    layout: "manage",
    robots: access.mode === "public" ? "index,follow" : "noindex,nofollow",
    scriptSource: "/portal.js",
    styles: `${portalSharedStyles}
    main.page-manage { align-self: start; }
    .manage-header { padding: var(--space-8) 0 var(--space-4); }
    .manage-header p:last-child { margin-bottom: 0; }
    .token-form { display: grid; grid-template-rows: auto 1fr auto; min-block-size: 24rem; margin-top: var(--space-6); padding: var(--space-6); border-radius: var(--radius-field); background: var(--surface-subtle); word-break: keep-all; overflow-wrap: normal; }
    .token-entry-region > label { display: block; margin-bottom: var(--space-2); font-weight: var(--weight-bold); }
    .token-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); }
    input { width: 100%; min-height: var(--action-height); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-action); background: var(--surface); color: var(--text); font: inherit; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; }
    .reveal { width: auto; white-space: nowrap; }
    .hint { margin: var(--space-2) 0 0; font-size: var(--font-small); }
    code, output { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; }
    .connection-state-region { min-width: 0; padding-top: var(--space-4); }
    .feedback, .error { margin: 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-field); background: var(--surface); font-weight: var(--weight-bold); }
    .error p { margin: 0; color: var(--error); }
    .feedback { color: var(--success); }
    .error { color: var(--error); }
    .connection-status { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--border); }
    .credential-output { margin-top: var(--space-6); padding-top: var(--space-6); border-top: 1px solid var(--border); }
    .connection-status:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .status-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
    .status-heading h2, .status-indicator { margin: 0; }
    .status-indicator { color: var(--success); font-size: var(--font-small); font-weight: var(--weight-bold); letter-spacing: var(--tracking-label); }
    .status-blocked { color: var(--error); }
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin: var(--space-6) 0; }
    dl div { padding: var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); }
    dl .support-entry { grid-column: 1 / -1; }
    dt { color: var(--text-muted); font-size: var(--font-small); }
    dd { margin: var(--space-2) 0 0; font-weight: var(--weight-bold); line-height: var(--line-body); }
    .support-value { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
    .support-value output { min-width: 0; overflow-wrap: anywhere; user-select: all; }
    button.compact { width: auto; min-width: max-content; }
    .restricted-notice { margin-bottom: var(--space-6); padding: var(--space-4); border: 1px solid var(--error); border-radius: var(--radius-field); background: var(--surface-subtle); }
    .restricted-notice h3 { margin: 0 0 var(--space-3); color: var(--error); font-size: var(--font-body); }
    .restricted-notice p { margin-bottom: var(--space-3); }
    .restricted-notice p:last-child { margin-bottom: 0; }
    .restricted-notice a { color: var(--text); font-weight: var(--weight-bold); }
    .scope-section h3 { margin: 0 0 var(--space-3); font-size: var(--font-body); }
    .scope-section ul { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .scope-section li { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-action); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: var(--font-small); overflow-wrap: anywhere; }
    .status-actions { margin-top: var(--space-6); }
    .connection-action-slot { align-self: end; padding-top: var(--space-4); }
    .connection-action-slot > * { width: 100%; }
    .credential-output output { display: block; margin: var(--space-4) 0; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); line-height: var(--line-body); overflow-wrap: anywhere; user-select: all; }
    .credential-output output:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .copy-feedback, .copy-error { margin: var(--space-3) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); font-size: var(--font-small); font-weight: var(--weight-bold); }
    .copy-feedback { color: var(--success); }
    .copy-error { color: var(--error); }
    .credential-actions { display: grid; gap: var(--space-3); margin-top: var(--space-6); }
    .credential-actions > * { width: 100%; }
    dialog { width: min(var(--panel-max), calc(100% - var(--space-8))); padding: 0; border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--surface); color: var(--text); box-shadow: 0 var(--space-2) var(--space-8) var(--shadow-panel); }
    dialog::backdrop { background: var(--backdrop); }
    .dialog-content { padding: var(--space-6); }
    .dialog-content h2 { margin: 0 0 var(--space-3); }
    @media (max-width: 48rem) {
      dl { grid-template-columns: 1fr; }
      .reveal { width: auto; }
      .status-heading { flex-direction: column; }
      .support-value { align-items: stretch; flex-direction: column; }
      button.compact { width: 100%; }
    }`,
    title: "SmartThings 연결 관리 | Growful",
  })
}
