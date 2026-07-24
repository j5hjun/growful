import { renderGatewayPage } from "./oauth-page.js"

export const oauthCallbackResultKinds = {
  cancelled: "cancelled",
  invalidRequest: "invalid_request",
  invalidState: "invalid_state",
  rateLimited: "rate_limited",
  scopeMismatch: "scope_mismatch",
  tokenExchangeFailed: "token_exchange_failed",
  unexpected: "unexpected",
} as const

export type OAuthCallbackResultKind =
  (typeof oauthCallbackResultKinds)[keyof typeof oauthCallbackResultKinds]

type OAuthCallbackResultCopy = {
  readonly description: string
  readonly explanation: string
  readonly heading?: string
  readonly label: string
  readonly title: string
}

const resultCopy = {
  cancelled: {
    description: "SmartThings 승인이 취소되어 연결을 완료하지 않았습니다.",
    explanation:
      "SmartThings 승인 화면에서 연결을 취소했습니다. Growful에는 새 연결이나 토큰이 저장되지 않았습니다.",
    heading: 'SmartThings <span class="phrase">연결이 취소되었습니다</span>',
    label: "승인 취소",
    title: "SmartThings 연결이 취소되었습니다",
  },
  invalid_request: {
    description: "올바르지 않은 SmartThings OAuth 연결 요청을 안전하게 복구합니다.",
    explanation:
      '연결 완료에 필요한 정보가 없거나 <span class="phrase">올바른 형식이 아닙니다.</span> 현재 주소를 수정하거나 다시 사용하지 말고 <span class="phrase">새 OAuth 요청을 시작해 주세요.</span>',
    label: "잘못된 요청",
    title: "올바르지 않은 연결 요청입니다",
  },
  invalid_state: {
    description: "만료되었거나 이미 사용한 SmartThings OAuth 연결 요청을 안전하게 복구합니다.",
    explanation:
      '보안을 위해 연결 요청은 일정 시간이 지나면 만료되며 한 번만 사용할 수 있습니다. 새 OAuth 요청을 시작하면 <span class="phrase">다시 연결할 수 있습니다.</span>',
    label: "요청 만료",
    title: "연결 요청을 다시 시작해 주세요",
  },
  rate_limited: {
    description: "SmartThings 승인 후 돌아오는 요청이 반복되면 안전하게 제한합니다.",
    explanation:
      '짧은 시간에 연결 완료 요청이 너무 많이 접수되었습니다. 잠시 기다린 뒤 <span class="phrase">새 OAuth 요청을 시작해 주세요.</span>',
    label: "요청 제한",
    title: "요청이 너무 많습니다",
  },
  scope_mismatch: {
    description: "SmartThings 권한 확인이 일치하지 않아 연결을 완료하지 않았습니다.",
    explanation:
      'SmartThings가 요청한 범위와 다른 <span class="phrase">권한 정보를 반환해</span> 연결을 중단했습니다. 잠시 후 OAuth를 다시 시작하고, 반복되면 지원 안내를 확인해 주세요.',
    label: "권한 확인 실패",
    title: "권한 확인 실패",
  },
  token_exchange_failed: {
    description: "SmartThings 토큰 교환 실패 후 안전하게 다시 연결하도록 안내합니다.",
    explanation:
      "SmartThings와 연결 정보를 교환하는 동안 작업을 완료하지 못했습니다. 잠시 후 OAuth를 다시 시작하고, 반복되면 지원 안내를 확인해 주세요.",
    label: "연결 처리 실패",
    title: "SmartThings 연결 실패",
  },
  unexpected: {
    description: "예상하지 못한 SmartThings 연결 오류 후 안전한 복구 방법을 안내합니다.",
    explanation:
      "예상하지 못한 문제로 연결을 완료하지 못했습니다. 이 화면에는 오류 상세정보나 연결 정보를 표시하지 않습니다. 잠시 후 다시 시도해 주세요.",
    label: "일시적 오류",
    title: "연결 중 문제가 발생했습니다",
  },
} as const satisfies Record<OAuthCallbackResultKind, OAuthCallbackResultCopy>

export function renderOAuthCallbackResult(kind: OAuthCallbackResultKind): string {
  const copy = resultCopy[kind]
  return renderGatewayPage({
    body: `
    <p class="result-label">${copy.label}</p>
    <h1>${"heading" in copy ? copy.heading : copy.title}</h1>
    <p>${copy.explanation}</p>
    <section aria-labelledby="recovery-title">
      <h2 id="recovery-title">다음 단계</h2>
      <div class="actions">
        <a class="primary" href="/oauth/start">OAuth 다시 시작</a>
        <a class="secondary" href="/">서비스 안내</a>
        <a class="secondary" href="/support">지원 안내</a>
      </div>
      <p class="support-note"><span class="phrase">지원이 필요해도 OAuth code, state 또는 토큰을 보내지 마세요.</span> <span class="phrase">전체 오류 응답 대신 발생 시각과 이 화면의 제목만 알려 주세요.</span></p>
    </section>`,
    description: copy.description,
    styles: `
    .result-label { margin-bottom: var(--space-3); color: var(--error); font-size: var(--font-small); font-weight: var(--weight-bold); letter-spacing: var(--tracking-label); }
    section { margin-top: var(--space-8); padding-top: var(--space-6); border-top: 1px solid var(--border); }
    h2 { margin: 0 0 var(--space-4); }
    .actions { display: grid; gap: var(--space-3); }
    .primary, .secondary { display: inline-flex; width: 100%; min-height: var(--action-height); align-items: center; justify-content: center; padding: var(--space-3) var(--space-4); border-radius: var(--radius-action); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); text-align: center; text-decoration: none; }
    .primary { border: 1px solid var(--action); background: var(--action); color: var(--action-text); }
    .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .primary:hover { background: var(--action-hover); }
    .primary:active, .secondary:active { transform: scale(var(--pressed-scale)); }
    .primary:focus-visible, .secondary:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .support-note { margin: var(--space-6) 0 0; padding: var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); font-size: var(--font-small); }
    .support-note .phrase { white-space: normal; }
    @media (prefers-reduced-motion: no-preference) { .primary, .secondary { transition: transform 100ms ease; } }`,
    title: copy.title,
  })
}
