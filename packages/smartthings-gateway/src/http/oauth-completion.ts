import type { GrowfulToken } from "../security/growful-token.js"
import { renderGatewayPage } from "./oauth-page.js"

export function renderOAuthCompletion(growfulToken: GrowfulToken): string {
  return renderGatewayPage({
    body: `
    <h1>SmartThings 연결 완료</h1>
    <section aria-labelledby="growful-token-title" data-token-safety>
      <h2 id="growful-token-title">Growful 토큰</h2>
      <p><span class="phrase">이 페이지를 떠나면 토큰을 다시 볼 수 없습니다.</span> 복사하거나 안전한 곳에 저장했는지 확인하기 전에는 <span class="phrase">페이지를 닫거나 이동하지 마세요.</span> <span class="phrase">분실하면 SmartThings 연결을 다시 완료해야 합니다.</span> 같은 SmartThings 연결을 다시 승인하면 이전 Growful 토큰은 더 이상 사용할 수 없습니다. 별도 SmartThings 연결로 승인하면 기존 Growful 연결은 자동으로 해제되지 않고 남을 수 있습니다. <span class="phrase">이 Gateway에 보내는 요청에는 Bearer 토큰으로 사용하세요.</span></p>
      <textarea id="issued-growful-token" data-token-value data-growful-token aria-labelledby="growful-token-title" aria-describedby="growful-token-copy-guidance" rows="2" readonly autocomplete="off" autocapitalize="off" spellcheck="false">${growfulToken}</textarea>
      <p id="growful-token-copy-guidance" class="manual-copy-guidance" data-token-manual-copy><span class="phrase">자동 복사를 사용할 수 없으면 토큰 필드에 초점을 둔 뒤 토큰 전체를 선택하세요.</span> <span class="phrase">Ctrl+C 또는 Command+C를 눌러 직접 복사할 수 있습니다.</span></p>
      <p class="copy-feedback" data-token-copy-feedback role="status" aria-live="polite" hidden>Growful 토큰을 클립보드에 복사했습니다.</p>
      <p class="copy-error" data-token-copy-error role="alert" hidden><span class="phrase">자동 복사를 사용할 수 없습니다.</span> <span class="phrase">토큰 전체를 선택했습니다.</span> <span class="phrase">Ctrl+C 또는 Command+C를 눌러 직접 복사하세요.</span></p>
      <div class="actions">
        <button class="primary" type="button" data-copy-token aria-controls="issued-growful-token" hidden disabled>Growful 토큰 복사</button>
        <a class="secondary" href="/manage" data-action="manage-issued-token">관리 화면에서 연결 확인</a>
      </div>
    </section>
    <section class="api-quickstart" aria-labelledby="api-quickstart-title">
      <h2 id="api-quickstart-title">첫 API 요청</h2>
      <p>이 Gateway와 같은 주소의 <code>/v1</code> 아래에 SmartThings API 경로를 붙이세요. Growful 토큰을 요청 헤더에 Bearer 토큰으로 보내면 Gateway가 SmartThings API로 중계합니다.</p>
      <p>디바이스 읽기 권한을 선택한 경우 아래처럼 요청할 수 있습니다. 다른 권한만 승인했다면 <code>/v1</code> 뒤에 자신이 승인한 SmartThings API 경로를 사용하세요.</p>
      <pre class="api-request-example" aria-label="첫 API 요청 예시"><code>GET /v1/devices
Authorization: Bearer &lt;Growful 토큰&gt;</code></pre>
      <p class="api-token-safety">실제 토큰은 위 자리표시자 대신 Authorization 헤더에만 넣으세요. URL, 쿼리, 요청 본문 또는 공유 문서에는 넣지 마세요.</p>
    </section>
    <script src="/token-safety.js" defer></script>`,
    description:
      "SmartThings 연결이 완료되어 Growful 토큰을 한 번 표시하고 Gateway의 SmartThings API 중계 사용법을 안내합니다.",
    styles: `
    section { margin-top: var(--space-6); }
    h2 { margin: 0 0 var(--space-3); font-size: var(--font-body); line-height: var(--line-body); }
    textarea[data-token-value] { display: block; width: 100%; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); background: var(--surface); color: var(--text); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: var(--font-body); line-height: var(--line-body); overflow-wrap: anywhere; resize: none; }
    textarea[data-token-value]:focus { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .manual-copy-guidance { margin: var(--space-3) 0 0; font-size: var(--font-small); }
    .copy-feedback, .copy-error { margin: var(--space-3) 0 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); font-size: var(--font-small); font-weight: var(--weight-bold); }
    .copy-feedback { color: var(--success); }
    .copy-error { color: var(--error); }
    .actions { display: grid; gap: var(--space-3); margin-top: var(--space-6); }
    .api-quickstart { padding-top: var(--space-6); border-top: 1px solid var(--border); }
    .api-quickstart p { margin-bottom: var(--space-3); }
    .api-request-example { margin: 0 0 var(--space-3); padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); background: var(--surface-subtle); color: var(--text); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: var(--font-small); line-height: var(--line-body); white-space: pre-wrap; overflow-wrap: anywhere; }
    .api-quickstart .api-token-safety { margin-bottom: 0; }
    .primary, .secondary { display: inline-flex; width: 100%; min-height: var(--action-height); align-items: center; justify-content: center; padding: var(--space-3) var(--space-4); border-radius: var(--radius-action); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); text-decoration: none; cursor: pointer; }
    .primary[hidden] { display: none; }
    .primary { border: 1px solid var(--action); background: var(--action); color: var(--action-text); }
    .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .primary:hover { background: var(--action-hover); }
    .primary:active, .secondary:active { transform: scale(var(--pressed-scale)); }
    .primary:focus-visible, .secondary:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    @media (forced-colors: active) { .api-request-example { border: 2px solid CanvasText; } }
    @media (prefers-reduced-motion: no-preference) { .primary, .secondary { transition: transform 100ms ease; } }`,
    title: "SmartThings 연결 완료",
  })
}
