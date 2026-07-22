import type { GrowfulToken } from "../security/growful-token.js"
import { renderGatewayPage } from "./oauth-page.js"

export function renderOAuthCompletion(growfulToken: GrowfulToken): string {
  return renderGatewayPage({
    body: `
    <h1>SmartThings 연결 완료</h1>
    <section aria-labelledby="growful-token-title" data-token-safety>
      <h2 id="growful-token-title">Growful 토큰</h2>
      <p><span class="phrase">이 페이지를 떠나면 토큰을 다시 볼 수 없습니다.</span> <span class="phrase">분실하면 OAuth를 다시 완료해야 합니다.</span> <span class="phrase">Gateway 요청에는 Bearer 토큰으로 사용하세요.</span></p>
      <output id="issued-growful-token" data-token-value tabindex="-1" data-growful-token>${growfulToken}</output>
      <p class="copy-feedback" data-token-copy-feedback role="status" aria-live="polite" hidden>Growful 토큰을 클립보드에 복사했습니다.</p>
      <p class="copy-error" data-token-copy-error role="alert" hidden>자동 복사를 사용할 수 없습니다. 위 토큰을 직접 선택해 복사하세요.</p>
      <div class="actions">
        <button class="primary" type="button" data-copy-token aria-controls="issued-growful-token">Growful 토큰 복사</button>
        <a class="secondary" href="/manage" data-action="manage-issued-token">관리 화면에서 연결 확인</a>
      </div>
    </section>
    <script src="/token-safety.js" defer></script>`,
    description: "SmartThings 연결이 완료되어 Growful 토큰을 한 번 표시합니다.",
    styles: `
    section { margin-top: var(--space-6); }
    h2 { margin: 0 0 var(--space-3); font-size: var(--font-body); line-height: var(--line-body); }
    output { display: block; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; line-height: var(--line-body); overflow-wrap: anywhere; user-select: all; }
    output:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .copy-feedback, .copy-error { margin: var(--space-3) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); font-size: var(--font-small); font-weight: var(--weight-bold); }
    .copy-feedback { color: var(--success); }
    .copy-error { color: var(--error); }
    .actions { display: grid; gap: var(--space-3); margin-top: var(--space-6); }
    .primary, .secondary { display: inline-flex; width: 100%; min-height: var(--action-height); align-items: center; justify-content: center; padding: var(--space-3) var(--space-4); border-radius: var(--radius-action); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); text-decoration: none; cursor: pointer; }
    .primary { border: 1px solid var(--action); background: var(--action); color: var(--action-text); }
    .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .primary:hover { background: var(--action-hover); }
    .primary:active, .secondary:active { transform: scale(var(--pressed-scale)); }
    .primary:focus-visible, .secondary:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    @media (prefers-reduced-motion: no-preference) { .primary, .secondary { transition: transform 100ms ease; } }`,
    title: "SmartThings 연결 완료",
  })
}
