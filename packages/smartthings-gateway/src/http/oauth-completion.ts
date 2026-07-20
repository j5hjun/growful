import type { GrowfulToken } from "../security/growful-token.js"
import { renderOAuthPage } from "./oauth-page.js"

export function renderOAuthCompletion(growfulToken: GrowfulToken): string {
  return renderOAuthPage({
    body: `
    <h1>SmartThings 연결 완료</h1>
    <section aria-labelledby="growful-token-title">
      <h2 id="growful-token-title">Growful 토큰</h2>
      <p><span class="phrase">토큰은 이 화면에서만 보입니다.</span> <span class="phrase">안전한 곳에 복사하세요.</span> <span class="phrase">Gateway 요청에</span> <span class="phrase">Bearer 토큰으로 사용하세요.</span></p>
      <output data-growful-token>${growfulToken}</output>
    </section>`,
    description: "SmartThings 연결이 완료되어 Growful 토큰을 한 번 표시합니다.",
    styles: `
    section { margin-top: var(--space-6); }
    h2 { margin: 0 0 var(--space-3); font-size: var(--font-body); line-height: var(--line-body); }
    output { display: block; padding: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius-field); font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; line-height: var(--line-body); overflow-wrap: anywhere; user-select: all; }`,
    title: "SmartThings 연결 완료",
  })
}
