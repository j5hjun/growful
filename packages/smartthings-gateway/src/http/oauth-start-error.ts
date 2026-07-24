import { renderGatewayPage } from "./oauth-page.js"
import { renderSupportSafetyGuidance } from "./support-safety-copy.js"

export const oauthStartErrorKinds = {
  authorizationExpired: "authorization_expired",
  internal: "internal",
  invalidOrigin: "invalid_origin",
  invalidRequest: "invalid_request",
  rateLimited: "rate_limited",
  requestBodyTooLarge: "request_body_too_large",
  unsupportedMediaType: "unsupported_media_type",
} as const

export type OAuthStartErrorKind = (typeof oauthStartErrorKinds)[keyof typeof oauthStartErrorKinds]

type OAuthStartErrorCopy = {
  readonly description: string
  readonly explanation: string
  readonly label: string
  readonly retryLabel: string
  readonly title: string
}

export type OAuthStartErrorOptions = {
  readonly retryAfterSeconds?: number | undefined
}

const maximumDisplayedRetryAfterSeconds = 3_600

export function parseOAuthStartRetryAfterSeconds(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9][0-9]*$/u.test(value)
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximumDisplayedRetryAfterSeconds
    ? parsed
    : undefined
}

const errorCopy = {
  authorization_expired: {
    description: "변경되거나 만료된 SmartThings 연결 요청을 안전하게 다시 확인하도록 안내합니다.",
    explanation:
      "연결 화면을 연 뒤 연결 요청 정보가 변경되었거나 사용할 수 있는 시간이 지났습니다. 새 Growful 권한 선택 화면을 열어 다시 시작해 주세요.",
    label: "연결 요청 확인",
    retryLabel: "권한 선택 다시 시작",
    title: "연결 요청을 다시 확인해 주세요",
  },
  internal: {
    description: "SmartThings 연결 시작 오류 후 안전한 복구 방법을 안내합니다.",
    explanation:
      "예상하지 못한 문제로 연결을 시작하지 못했습니다. SmartThings 승인 화면으로 이동하는 주소는 제공되지 않았으며, 이 화면에는 오류 상세정보나 입력값을 표시하지 않습니다. 잠시 후 새 Growful 권한 선택 화면에서 다시 시도해 주세요.",
    label: "연결 시작 오류",
    retryLabel: "권한 선택 다시 시작",
    title: "연결을 시작하지 못했습니다",
  },
  invalid_origin: {
    description: "허용되지 않은 출처의 SmartThings 연결 시작 요청을 안전하게 차단했습니다.",
    explanation:
      "보호된 연결 화면과 다른 출처에서 요청되어 연결을 시작하지 않았습니다. 이 탭에서 Growful 권한 선택 화면을 새로 열어 다시 시도해 주세요.",
    label: "요청 출처 확인",
    retryLabel: "권한 선택 다시 시작",
    title: "안전한 Growful 권한 선택 화면에서 다시 시작해 주세요",
  },
  invalid_request: {
    description: "올바르지 않은 SmartThings 연결 시작 요청을 안전하게 복구합니다.",
    explanation:
      "연결에 필요한 선택 정보가 없거나 올바른 형식이 아닙니다. 현재 요청을 다시 보내지 말고 Growful 권한 선택 화면에서 항목을 다시 선택해 주세요.",
    label: "잘못된 요청",
    retryLabel: "권한 선택 다시 시작",
    title: "입력 내용을 확인해 주세요",
  },
  rate_limited: {
    description: "반복된 SmartThings 연결 시작 요청을 안전하게 제한했습니다.",
    explanation:
      "짧은 시간에 요청이 너무 많이 접수되어 연결을 시작하지 않았습니다. 안내된 시간 동안 기다린 뒤 Growful 권한 선택 화면에서 다시 시도해 주세요.",
    label: "요청 일시 제한",
    retryLabel: "권한 선택 다시 시작",
    title: "요청이 너무 많습니다",
  },
  request_body_too_large: {
    description: "허용 크기를 넘은 SmartThings 연결 시작 요청을 안전하게 차단했습니다.",
    explanation:
      "전송된 선택 정보를 처리할 수 없어 연결을 시작하지 않았습니다. 새 Growful 권한 선택 화면을 열어 다시 진행해 주세요.",
    label: "요청 크기 초과",
    retryLabel: "권한 선택 다시 시작",
    title: "새 Growful 권한 선택 화면에서 다시 시작해 주세요",
  },
  unsupported_media_type: {
    description: "지원하지 않는 형식의 SmartThings 연결 시작 요청을 안전하게 차단했습니다.",
    explanation:
      "이 연결 단계는 Growful 권한 선택 화면에서 보낸 선택 정보만 처리합니다. 현재 요청으로는 연결을 만들지 않았으므로 새 Growful 권한 선택 화면을 열어 진행해 주세요.",
    label: "지원하지 않는 요청 형식",
    retryLabel: "권한 선택 다시 시작",
    title: "올바른 Growful 권한 선택 화면에서 다시 시도해 주세요",
  },
} as const satisfies Record<OAuthStartErrorKind, OAuthStartErrorCopy>

export function renderOAuthStartError(
  kind: OAuthStartErrorKind,
  options: OAuthStartErrorOptions = {},
): string {
  const copy = errorCopy[kind]
  const retryAfterSeconds = parseOAuthStartRetryAfterSeconds(options.retryAfterSeconds)
  const retryGuidance =
    kind === oauthStartErrorKinds.rateLimited
      ? `<p class="retry-guidance">${
          retryAfterSeconds === undefined
            ? "잠시 후 권한 선택을 다시 시작할 수 있습니다."
            : `<time datetime="PT${retryAfterSeconds}S">약 ${retryAfterSeconds}초 뒤</time> 권한 선택을 다시 시작할 수 있습니다.`
        }</p>`
      : ""
  const actions =
    kind === oauthStartErrorKinds.rateLimited
      ? `<a class="primary" href="/">서비스 안내</a>
        <a class="secondary" href="/oauth/start">${copy.retryLabel}</a>
        <a class="secondary" href="/support">지원 안내</a>`
      : `<a class="primary" href="/oauth/start">${copy.retryLabel}</a>
        <a class="secondary" href="/">서비스 안내</a>
        <a class="secondary" href="/support">지원 안내</a>`
  return renderGatewayPage({
    body: `
    <section class="error-summary" aria-labelledby="error-title" tabindex="-1" autofocus>
      <p class="error-label">${copy.label}</p>
      <h1 id="error-title">${copy.title}</h1>
      <p>${copy.explanation}</p>
      ${retryGuidance}
    </section>
    <section class="recovery" aria-labelledby="recovery-title">
      <h2 id="recovery-title">다음 행동</h2>
      <nav class="actions" aria-label="연결 시작 복구">
        ${actions}
      </nav>
      <aside class="support-note" aria-label="안전한 지원 문의">
        ${renderSupportSafetyGuidance()}
      </aside>
    </section>`,
    description: copy.description,
    styles: `
    .error-summary:focus { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .error-label { margin-bottom: var(--space-3); color: var(--error); font-size: var(--font-small); font-weight: var(--weight-bold); letter-spacing: var(--tracking-label); }
    .retry-guidance { margin-bottom: 0; color: var(--text); }
    .retry-guidance time { font-weight: var(--weight-bold); }
    .recovery { margin-top: var(--space-8); padding-top: var(--space-6); border-top: 1px solid var(--border); }
    .recovery h2 { margin: 0 0 var(--space-4); }
    .actions { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
    .primary, .secondary { display: inline-flex; width: 100%; min-width: 0; min-height: var(--action-height); align-items: center; justify-content: center; padding: var(--space-3) var(--space-4); border-radius: var(--radius-action); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); overflow-wrap: anywhere; text-align: center; text-decoration: none; }
    .primary { border: 1px solid var(--action); background: var(--action); color: var(--action-text); }
    .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--text); }
    .primary:hover { background: var(--action-hover); }
    .primary:active, .secondary:active { transform: scale(var(--pressed-scale)); }
    .primary:focus-visible, .secondary:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    .support-note { margin: var(--space-6) 0 0; padding: var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); font-size: var(--font-small); }
    .support-note p { margin-bottom: var(--space-3); }
    .support-note p:last-child { margin-bottom: 0; }
    .support-note .phrase { white-space: normal; }
    @media (forced-colors: active) { .primary { border: 2px solid ButtonText; } }
    @media (prefers-reduced-motion: no-preference) { .primary, .secondary { transition: transform 100ms ease; } }`,
    title: copy.title,
  })
}
