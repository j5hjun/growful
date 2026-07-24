import { renderGatewayPage } from "./oauth-page.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import {
  portalSharedStyles,
  renderPortalEmailLink,
  renderPortalNavigation,
} from "./portal-shell.js"
import { renderSupportSafetyGuidance } from "./support-safety-copy.js"

export function renderPortalManagement(access: OAuthAccessPolicy): string {
  const supportEmailLink = renderPortalEmailLink(access.supportEmail)
  return renderGatewayPage({
    body: `
    ${renderPortalNavigation("manage")}
    <header class="manage-header">
      <p class="eyebrow">연결 관리</p>
      <h1><span class="phrase">Growful 토큰으로</span> <span class="phrase">연결 확인</span></h1>
      <p>입력한 Growful 토큰으로 이 Gateway에 연결 상태를 요청합니다. 토큰은 이 탭을 닫거나 새로고침하면 사라지며 <span class="phrase">브라우저에 저장하지 않습니다.</span> SmartThings 연결 토큰은 Gateway가 암호화해 보관·갱신하며 이 화면에 표시하지 않습니다.</p>
    </header>
    <section class="connection-panel" aria-label="Growful 토큰 연결 상태">
      <form class="token-form" action="/manage#javascript-required" method="get" data-portal-token-form novalidate>
        <div class="token-entry-region">
          <label for="growful-token">Growful 토큰</label>
          <div class="token-entry">
            <input id="growful-token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" pattern="grw_st_[A-Za-z0-9_\\-]{43}" minlength="50" maxlength="50" aria-describedby="token-hint management-token-error" required>
            <button class="secondary reveal" type="button" data-token-visibility aria-controls="growful-token" aria-pressed="false">토큰 보기</button>
          </div>
          <p class="hint" id="token-hint">연결 완료 화면에서 한 번 표시된 <span class="phrase"><code>grw_st_</code> 토큰을</span> 붙여 넣으세요.</p>
        </div>
        <div class="connection-state-region">
          <p class="feedback" data-portal-feedback role="status" aria-live="polite" hidden></p>
          <div class="error" data-portal-error role="alert" hidden><p id="management-token-error" data-portal-error-message></p></div>
          <div class="no-js-fallback error" id="javascript-required" data-no-js-fallback role="status" aria-labelledby="javascript-required-title">
            <p id="javascript-required-title"><strong>스크립트를 사용할 수 없습니다.</strong> 스크립트를 허용한 뒤 <span class="phrase">다시 시도하세요.</span> <span class="phrase">토큰은 전송되지 않았습니다.</span></p>
          </div>
        </div>
        <div class="connection-action-slot">
          <button class="primary" type="submit" data-token-submit>연결 상태 확인</button>
          <a class="action action-secondary" href="/oauth/start" data-reconnect hidden>SmartThings 다시 연결</a>
        </div>
      </form>
      <section class="connection-status" data-portal-status aria-labelledby="connection-title" tabindex="-1" hidden>
        <div class="status-heading">
          <div><p class="status-indicator" data-status-active>Gateway API 중계 사용 가능</p><p class="status-indicator status-blocked" data-status-blocked hidden>Gateway API 중계 접근 제한</p><p class="status-indicator status-reauthorization" data-status-reauthorization hidden>Gateway API 중계 사용 불가 · 다시 연결 필요</p><h2 id="connection-title">SmartThings 연결 상태</h2></div>
          <button class="secondary" type="button" data-forget-token>이 탭에서 토큰 지우기</button>
        </div>
        <dl>
          <div><dt>SmartThings 연결 토큰 만료 예정</dt><dd><time data-expires-at></time></dd></div>
          <div><dt>SmartThings 연결 토큰 마지막 자동 갱신</dt><dd><time data-refreshed-at></time></dd></div>
          <div class="support-entry"><dt>지원 참조</dt><dd class="support-value"><output data-support-reference tabindex="-1"></output><button class="secondary compact" type="button" data-copy-support-reference>지원 참조 복사</button></dd></div>
        </dl>
        <section class="restricted-notice" data-blocked-notice role="alert" aria-labelledby="blocked-title" hidden>
          <p class="eyebrow">Gateway API 중계 접근 제한</p>
          <h3 id="blocked-title">Growful Gateway의 SmartThings API 중계가 제한되었습니다</h3>
          <p data-block-reason></p>
          <p>제한 적용 시각: <time data-blocked-at></time></p>
          <p>문의할 때 위 지원 참조를 함께 전달해 주세요. ${supportEmailLink}</p>
        </section>
        <section class="reauthorization-notice" data-reauthorization-notice role="alert" aria-labelledby="reauthorization-title" hidden>
          <p class="eyebrow">연결 다시 승인 필요</p>
          <h3 id="reauthorization-title">SmartThings 연결을 다시 승인해 주세요</h3>
          <p>SmartThings 연결 승인이 만료되었거나 철회되어 Gateway의 API 중계를 사용할 수 없습니다. 다시 연결하면 새 Growful 토큰이 발급되고 현재 토큰은 사용할 수 없게 됩니다. 새 Growful 토큰을 사용하는 앱·자동화·서버 설정을 업데이트하세요.</p>
          <a class="action action-primary" href="/oauth/start">SmartThings 다시 연결</a>
        </section>
        <div class="action-row status-actions">
          <button class="secondary" type="button" data-rotate-token>Growful 토큰 교체</button>
          <button class="destructive" type="button" data-disconnect>연결 해제</button>
        </div>
        <section class="scope-section" aria-labelledby="scope-title">
          <h3 id="scope-title">승인된 권한</h3>
          <ul data-scope-list></ul>
        </section>
      </section>
    </section>
    <section class="token-recovery" data-token-loss-recovery aria-labelledby="token-recovery-title">
      <p class="eyebrow">토큰 분실 도움말</p>
      <h2 id="token-recovery-title">Growful 토큰을 잃어버렸나요?</h2>
      <p>기존 Growful 토큰은 다시 조회하거나 복구할 수 없습니다. 새 연결 시작을 선택해 SmartThings 승인을 완료하면 새 Growful 토큰을 받을 수 있습니다. 같은 SmartThings 연결을 다시 승인하면 이전 Growful 토큰은 더 이상 사용할 수 없습니다. 별도 SmartThings 연결로 승인하면 기존 Growful 연결은 자동으로 해제되지 않고 남을 수 있습니다.</p>
      <a class="action action-secondary" href="/oauth/start" data-token-loss-reconnect>새 연결 시작</a>
    </section>
    <aside class="management-support-safety" aria-label="안전한 지원 문의">
      ${renderSupportSafetyGuidance()}
      <p><a href="/support">지원 안내 보기</a></p>
    </aside>
    <section class="credential-output" data-token-safety data-rotated-token-section aria-labelledby="rotated-token-title" hidden>
      <p class="eyebrow">교체 완료</p>
      <h2 id="rotated-token-title">새 Growful 토큰</h2>
      <p><span class="phrase">이 토큰은 다시 확인할 수 없습니다.</span> 복사하거나 안전한 곳에 저장했는지 확인하기 전에는 <span class="phrase">이 화면을 떠나지 마세요.</span></p>
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
        <p id="rotate-token-description"><span class="phrase">교체하면 현재 토큰은 즉시 무효화됩니다.</span> <span class="phrase">Growful 토큰을 사용하는 모든 앱·자동화·서버 설정을 새 토큰으로 변경해야 합니다.</span></p>
        <div class="action-row">
          <button class="secondary" type="submit" value="cancel">취소</button>
          <button class="destructive" type="submit" value="confirm" data-rotate-token-confirm>토큰 교체</button>
        </div>
      </form>
    </dialog>
    <dialog data-disconnect-dialog aria-labelledby="disconnect-title" aria-describedby="disconnect-description" tabindex="-1">
      <form class="dialog-content" method="dialog" data-disconnect-form>
        <h2 id="disconnect-title">연결을 해제할까요?</h2>
        <p id="disconnect-description">이 작업은 Growful Gateway에 저장된 연결 정보만 삭제하며 SmartThings 쪽 상태는 변경하지 않습니다.</p>
        <div class="action-row">
          <button class="secondary" type="submit" value="cancel" data-disconnect-cancel>취소</button>
          <button class="destructive" type="submit" value="confirm" data-disconnect-confirm>연결 해제</button>
        </div>
      </form>
    </dialog>`,
    description:
      "Growful 토큰으로 SmartThings 연결 상태와 연결 토큰 만료 시각을 확인하고 Growful 토큰을 교체하거나 연결을 해제합니다.",
    layout: "manage",
    robots: access.mode === "public" ? "index,follow" : "noindex,nofollow",
    scriptSource: "/portal.js",
    styles: `${portalSharedStyles}
    .portal-page-shell.page-manage, main.page-manage { align-self: start; }
    .manage-header { padding: var(--space-8) 0 var(--space-4); }
    .manage-header p:last-child { margin-bottom: 0; }
    .token-recovery { margin-top: var(--space-6); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); background: var(--surface-subtle); }
    .token-recovery h2 { margin: 0 0 var(--space-3); font-size: var(--font-body); }
    .token-recovery p:not(.eyebrow) { margin-bottom: var(--space-3); }
    .token-recovery .action { width: 100%; }
    .connection-panel { margin-top: var(--space-6); border-radius: var(--radius-field); background: var(--surface-subtle); word-break: keep-all; overflow-wrap: normal; }
    .token-form { display: grid; grid-template-rows: repeat(3, auto); min-block-size: 0; padding: var(--space-6); }
    .token-entry-region > label { display: block; margin-bottom: var(--space-2); font-weight: var(--weight-bold); }
    .token-entry { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2); }
    input { width: 100%; min-height: var(--action-height); padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-action); background: var(--surface); color: var(--text); font: inherit; font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; }
    .reveal { width: auto; white-space: nowrap; }
    .hint { margin: var(--space-2) 0 0; font-size: var(--font-small); }
    code, output { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; }
    .connection-state-region { min-width: 0; }
    .connection-state-region > :not([hidden]) { margin-top: var(--space-4); }
    .feedback, .error { margin: 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-field); background: var(--surface); font-weight: var(--weight-bold); }
    .error p { margin: 0; color: var(--error); }
    .feedback { color: var(--success); }
    .error { color: var(--error); }
    .no-js-fallback { display: none; font-size: var(--font-small); }
    .no-js-fallback:target { display: block; }
    .connection-status { margin: 0 var(--space-6); padding: var(--space-4) 0 var(--space-6); border-top: 1px solid var(--border); }
    .credential-output { margin-top: var(--space-6); padding-top: var(--space-6); border-top: 1px solid var(--border); }
    .connection-status:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .status-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
    .status-heading h2, .status-indicator { margin: 0; }
    .status-indicator { color: var(--success); font-size: var(--font-small); font-weight: var(--weight-bold); letter-spacing: var(--tracking-label); }
    .status-blocked { color: var(--error); }
    .status-reauthorization { color: var(--error); }
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin: var(--space-6) 0; }
    dl div { padding: var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); }
    dl .support-entry { grid-column: 1 / -1; }
    .connection-status dl, .connection-status dl > div, .connection-status dt, .connection-status dd { min-width: 0; }
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
    .reauthorization-notice { margin-bottom: var(--space-6); padding: var(--space-4); border: 1px solid var(--error); border-radius: var(--radius-field); background: var(--surface-subtle); }
    .reauthorization-notice h3 { margin: 0 0 var(--space-3); color: var(--error); font-size: var(--font-body); }
    .reauthorization-notice p { margin-bottom: var(--space-3); }
    .reauthorization-notice .action { width: 100%; }
    .scope-section { margin-top: var(--space-6); }
    .management-support-safety { margin-top: var(--space-6); padding: var(--space-4); border-radius: var(--radius-field); background: var(--surface); font-size: var(--font-small); }
    .management-support-safety p { margin-bottom: var(--space-3); }
    .management-support-safety p:last-child { margin-bottom: 0; }
    .management-support-safety a { color: var(--text); }
    .scope-section h3 { margin: 0 0 var(--space-3); font-size: var(--font-body); }
    .scope-section ul { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .scope-section li { display: grid; gap: var(--space-2); min-width: 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-action); overflow-wrap: anywhere; }
    .scope-label { font-weight: var(--weight-bold); }
    .scope-code { color: var(--text-muted); font-size: var(--font-small); }
    .scope-section li[data-scope-kind="unknown"] { border-style: dashed; }
    .status-actions { margin-top: var(--space-6); }
    .connection-action-slot { display: grid; grid-auto-rows: minmax(var(--action-height), auto); gap: var(--space-3); padding-top: var(--space-4); }
    .connection-action-slot > * { width: 100%; }
    .credential-output output { display: block; margin: var(--space-4) 0; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); line-height: var(--line-body); overflow-wrap: anywhere; user-select: all; }
    .credential-output output:focus { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
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
    }
    @media (max-width: 22.5rem) {
      .connection-panel { margin-top: var(--space-4); }
      .token-recovery { margin-top: var(--space-4); }
      .token-form { padding: var(--space-4); }
      .token-entry { grid-template-columns: minmax(0, 1fr); }
      .reveal { width: 100%; }
    }
    @media (max-width: 20rem) {
      .manage-header { padding: var(--space-4) 0 var(--space-2); }
      .connection-panel { margin-top: var(--space-2); }
      .token-form { padding: var(--space-3); }
      .token-recovery { padding: var(--space-3); }
      .connection-status { margin-inline: var(--space-2); padding-bottom: var(--space-4); }
      dl { gap: var(--space-2); margin: var(--space-4) 0; }
      dl div, .restricted-notice, .reauthorization-notice { padding: var(--space-2); }
      .connection-status dd { word-break: normal; overflow-wrap: anywhere; }
      button.compact { min-width: 0; }
      .restricted-notice, .reauthorization-notice { margin-bottom: var(--space-4); }
    }
    @media (forced-colors: active) {
      .scope-section li { border-color: CanvasText; }
    }`,
    title: "SmartThings 연결 관리 | Growful",
  })
}
