import { renderGatewayPage } from "../http/oauth-page.js"
import { renderSupportSafetyGuidance } from "../http/support-safety-copy.js"

type PrivateBetaAccessGuidance =
  | { readonly kind: "authentication_failed" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number }

const guidanceStyles = `
    .access-status { margin-block-end: var(--space-2); color: var(--error); font-size: var(--font-small); font-weight: var(--weight-bold); letter-spacing: var(--tracking-label); }
    .guidance { margin-block-end: var(--space-6); padding: var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); }
    .guidance h2 { margin: 0 0 var(--space-3); }
    .guidance p { margin-block-end: var(--space-3); color: var(--text); }
    .guidance p:last-child { margin-block-end: 0; }
    .guidance ol { margin: 0 0 var(--space-4); padding-inline-start: var(--space-6); line-height: var(--line-body); }
    .guidance li + li { margin-block-start: var(--space-2); }
    .actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
    .support-safety { margin-block-start: var(--space-6); padding: var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); font-size: var(--font-small); }
    .support-safety p { margin-block-end: var(--space-3); }
    .support-safety p:last-child { margin-block-end: 0; }
    .action { min-height: var(--action-height); display: inline-flex; align-items: center; justify-content: center; padding-inline: var(--space-4); border: 1px solid var(--action); border-radius: var(--radius-action); font-weight: var(--weight-bold); line-height: var(--line-action); text-decoration: none; }
    .action-primary { background: var(--action); color: var(--action-text); }
    .action-secondary { background: var(--surface); color: var(--text); border-color: var(--border); }
    .action:hover { background: var(--action-hover); color: var(--action-text); }
    .action:active { transform: scale(var(--pressed-scale)); }
    .action:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    @media (max-width: 30rem) { .actions { display: grid; } .action { width: 100%; } }
    @media (prefers-reduced-motion: no-preference) { .action { transition: transform 100ms ease; } }`

function renderAuthenticationFailure(): string {
  return renderGatewayPage({
    body: `
    <p class="access-status">비공개 베타 접근</p>
    <h1>초대 확인을 완료하지 못했습니다</h1>
    <p>초대 확인을 취소했거나 입력한 초대 정보가 맞지 않습니다. 아래 항목을 확인한 뒤 다시 시도하세요.</p>
    <section class="guidance" aria-labelledby="credential-guidance">
      <h2 id="credential-guidance">다시 확인할 정보</h2>
      <ol>
        <li>초대 메시지에 적힌 <strong class="phrase">초대 사용자 이름</strong></li>
        <li>초대 메시지에 함께 전달된 <strong class="phrase">초대 비밀번호</strong></li>
      </ol>
      <p><strong>초대 비밀번호는 삼성 계정 비밀번호가 아닙니다.</strong> 삼성 계정 비밀번호는 Growful 초대 확인 창에 입력하지 마세요.</p>
      <p>반복해서 잘못 입력하면 초대 확인 시도가 잠시 제한될 수 있습니다.</p>
    </section>
    <nav class="actions" aria-label="초대 확인 복구">
      <a class="action action-primary" href="/oauth/start">다시 확인하기</a>
      <a class="action action-secondary" href="/">서비스 안내로 돌아가기</a>
    </nav>
    <aside class="support-safety" aria-label="안전한 지원 문의">
      ${renderSupportSafetyGuidance()}
    </aside>`,
    description: "Growful 비공개 베타 초대 확인 복구 안내",
    styles: guidanceStyles,
    title: "비공개 베타 초대 확인 안내 | Growful",
  })
}

function renderRateLimit(retryAfterSeconds: number): string {
  return renderGatewayPage({
    body: `
    <p class="access-status">비공개 베타 접근 일시 제한</p>
    <h1>잠시 후 다시 시도해 주세요</h1>
    <p>반복된 초대 확인 실패로 일시 제한이 적용되었습니다.</p>
    <section class="guidance" aria-labelledby="retry-guidance">
      <h2 id="retry-guidance">다시 시도하는 방법</h2>
      <p><time datetime="PT${retryAfterSeconds}S">약 ${retryAfterSeconds}초 뒤</time> 초대 확인을 다시 시작하세요.</p>
      <p>기다리는 동안 초대 메시지의 <span class="phrase"><strong>초대 사용자 이름</strong>과</span> <span class="phrase"><strong>초대 비밀번호</strong>를</span> 확인하세요. 초대 비밀번호는 삼성 계정 비밀번호가 아닙니다.</p>
    </section>
    <nav class="actions" aria-label="일시 제한 복구">
      <a class="action action-primary" href="/oauth/start">잠시 후 다시 확인하기</a>
      <a class="action action-secondary" href="/">서비스 안내로 돌아가기</a>
    </nav>
    <aside class="support-safety" aria-label="안전한 지원 문의">
      ${renderSupportSafetyGuidance()}
    </aside>`,
    description: "Growful 비공개 베타 초대 확인 일시 제한 안내",
    styles: guidanceStyles,
    title: "비공개 베타 접근 일시 제한 | Growful",
  })
}

export function renderPrivateBetaAccessGuidance(guidance: PrivateBetaAccessGuidance): string {
  switch (guidance.kind) {
    case "authentication_failed":
      return renderAuthenticationFailure()
    case "rate_limited":
      return renderRateLimit(guidance.retryAfterSeconds)
  }
}
