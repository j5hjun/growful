const portalPageNames = ["home", "status", "manage", "support", "privacy", "terms"] as const

export type PortalPageName = (typeof portalPageNames)[number]

export type GatewayPageShell =
  | {
      readonly currentPage: PortalPageName | null
      readonly operatorName: string
      readonly supportEmail: string
      readonly variant: "standard"
    }
  | {
      readonly sensitiveNavigation?: boolean
      readonly variant: "task"
    }

export const portalSharedStyles = `
    .page-shell a, .page-shell button, .page-shell code, .page-shell output { max-width: 100%; overflow-wrap: anywhere; }
    .action-row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
    .action, button { display: inline-flex; min-width: 0; min-height: var(--action-height); align-items: center; justify-content: center; padding: var(--space-3) var(--space-4); border: 1px solid transparent; border-radius: var(--radius-action); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); text-align: center; white-space: normal; text-decoration: none; cursor: pointer; transition: background-color 100ms ease-out, color 100ms ease-out, transform 100ms ease-out; }
    .action-primary, button.primary { background: var(--action); color: var(--action-text); }
    .action-primary:hover, button.primary:hover { background: var(--action-hover); }
    .action-secondary, button.secondary { border-color: var(--border); background: var(--surface); color: var(--text); }
    .action-secondary:hover, button.secondary:hover { background: var(--surface-subtle); }
    button.destructive { border-color: var(--error); background: var(--surface); color: var(--error); }
    button.destructive:hover { background: var(--surface-subtle); }
    .action:active, button:active { transform: scale(var(--pressed-scale)); }
    .action:focus-visible, button:focus-visible, input:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    button:disabled { cursor: wait; opacity: .65; }
    .eyebrow { margin-bottom: var(--space-3); color: var(--text); font-size: var(--font-small); font-weight: var(--weight-bold); letter-spacing: var(--tracking-label); text-transform: uppercase; }
    [hidden] { display: none !important; }
    @media (max-width: 40rem) {
      .action-row { align-items: stretch; flex-direction: column; }
      .action, button { width: 100%; }
      .page-content .current-status { grid-template-columns: 1fr; gap: var(--space-2); }
    }
    @media (min-width: 40.0625rem) and (max-width: 48rem) {
      .page-content.page-wide .flow ol { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-6); }
    }
    @media (forced-colors: active) { .action-primary, button.primary { border: 2px solid ButtonText; } }
    @media (prefers-reduced-motion: reduce) { .action, button { transition: none; } }`

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function currentAttribute(currentPage: PortalPageName | null, page: PortalPageName): string {
  return currentPage === page ? ' aria-current="page"' : ""
}

export function renderGatewayHeader(shell: GatewayPageShell): string {
  if (shell.variant === "task") {
    const navigationPrefix = shell.sensitiveNavigation ? "토큰 저장 후 " : ""
    const brandLabel = shell.sensitiveNavigation
      ? ' aria-label="Growful 홈, 토큰을 저장한 뒤 이동"'
      : ""
    return `<header class="site-header" data-header-variant="task">
      <nav class="site-nav" aria-label="SmartThings 연결 메뉴">
        <a class="brand" href="/"${brandLabel}>Growful <span>SmartThings Gateway</span></a>
        <ul class="nav-list task-nav-list">
          <li><span class="task-context" aria-current="page">SmartThings 연결</span></li>
          <li><a href="/">${navigationPrefix}서비스 안내</a></li>
          <li><a href="/support">${navigationPrefix}지원</a></li>
        </ul>
      </nav>
    </header>`
  }

  return `<header class="site-header" data-header-variant="standard">
      <nav class="site-nav" aria-label="주요 메뉴">
        <a class="brand" href="/">Growful <span>SmartThings Gateway</span></a>
        <ul class="nav-list">
          <li><a href="/"${currentAttribute(shell.currentPage, "home")}>서비스 안내</a></li>
          <li><a href="/manage"${currentAttribute(shell.currentPage, "manage")}>연결 관리</a></li>
          <li><a href="/status"${currentAttribute(shell.currentPage, "status")}>상태</a></li>
          <li><a href="/support"${currentAttribute(shell.currentPage, "support")}>지원</a></li>
        </ul>
      </nav>
    </header>`
}

type PortalEmailLinkOptions = {
  readonly className?: string
  readonly label?: string
  readonly supportEmailAction?: boolean
}

export function renderPortalEmailLink(
  supportEmail: string,
  options: PortalEmailLinkOptions = {},
): string {
  const safeSupportEmail = escapeHtml(supportEmail)
  const safeLabel = escapeHtml(options.label ?? supportEmail)
  const className = options.className ? ` class="${escapeHtml(options.className)}"` : ""
  const supportEmailAction = options.supportEmailAction ? " data-support-email-action" : ""

  return `<!--email_off--><a${className} href="mailto:${safeSupportEmail}"${supportEmailAction}>${safeLabel}</a><!--/email_off-->`
}

export function renderGatewayFooter(shell: GatewayPageShell): string {
  if (shell.variant === "task") {
    const safetyNote = shell.sensitiveNavigation
      ? "Growful 토큰을 복사해 안전하게 저장한 뒤 다른 화면으로 이동하세요."
      : "연결 과정의 비밀값은 지원 문의에 공유하지 마세요."
    return `<footer class="site-footer">
      <p class="task-footer-context"><strong>SmartThings 연결</strong><span>${safetyNote}</span></p>
      <nav aria-label="정책 메뉴">
        <ul class="footer-nav-list">
          <li><a href="/privacy">개인정보 처리방침</a></li>
          <li><a href="/terms">이용약관</a></li>
        </ul>
      </nav>
    </footer>`
  }

  const safeOperatorName = escapeHtml(shell.operatorName)
  return `<footer class="site-footer">
      <nav aria-label="보조 메뉴">
        <ul class="footer-nav-list">
          <li><a href="/privacy"${currentAttribute(shell.currentPage, "privacy")}>개인정보 처리방침</a></li>
          <li><a href="/terms"${currentAttribute(shell.currentPage, "terms")}>이용약관</a></li>
        </ul>
      </nav>
      <dl class="footer-meta">
        <div><dt>운영자</dt><dd>${safeOperatorName}</dd></div>
        <div><dt>지원 이메일</dt><dd>${renderPortalEmailLink(shell.supportEmail)}</dd></div>
      </dl>
    </footer>`
}
