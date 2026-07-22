const portalPageNames = ["home", "status", "manage", "support", "privacy", "terms"] as const

export type PortalPageName = (typeof portalPageNames)[number]

export const portalSharedStyles = `
    body { align-items: start; justify-items: center; word-break: keep-all; overflow-wrap: break-word; }
    .skip-link { position: fixed; z-index: 1; top: var(--safe-area-top); left: var(--space-4); padding: var(--space-3) var(--space-4); border-radius: var(--radius-action); background: var(--action); color: var(--action-text); font-weight: var(--weight-bold); text-decoration: none; transform: translateY(calc(-100% - var(--space-8))); transition: transform 100ms ease-out; }
    .skip-link:focus { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); transform: translateY(0); }
    .portal-page-shell { width: min(var(--page-max), 100%); padding: var(--space-8); border-radius: var(--radius-panel); background: var(--surface); box-shadow: 0 var(--space-2) var(--space-8) var(--shadow-panel); }
    .portal-page-shell.page-panel { --page-max: var(--panel-max); }
    .portal-page-shell.page-manage { --page-max: var(--panel-manage); }
    .portal-page-shell.page-wide { --page-max: var(--panel-wide); }
    .portal-page-shell > main { width: 100%; padding: 0; border-radius: 0; background: transparent; box-shadow: none; }
    .site-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding-bottom: var(--space-6); border-bottom: 1px solid var(--border); }
    .brand { display: inline-flex; min-height: var(--action-height); align-items: center; color: var(--text); font-weight: var(--weight-bold); text-decoration: none; }
    .brand span { color: var(--text-muted); font-weight: 400; }
    .nav-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .nav-list a { display: inline-flex; min-height: var(--action-height); align-items: center; padding: 0 var(--space-3); border-radius: var(--radius-action); color: var(--text-muted); font-size: var(--font-small); font-weight: var(--weight-bold); text-decoration: none; }
    .nav-list a[aria-current=page] { background: var(--surface-subtle); color: var(--text); }
    .nav-list a:hover { color: var(--text); }
    .site-footer { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-8); margin-top: var(--space-8); padding-top: var(--space-6); border-top: 1px solid var(--border); }
    .footer-nav-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .footer-nav-list a { display: inline-flex; min-height: var(--action-height); align-items: center; padding: 0 var(--space-3); border-radius: var(--radius-action); color: var(--text-muted); font-size: var(--font-small); font-weight: var(--weight-bold); text-decoration: none; }
    .footer-nav-list a[aria-current=page] { background: var(--surface-subtle); color: var(--text); }
    .footer-nav-list a:hover { color: var(--text); }
    .site-footer .footer-meta { display: grid; grid-template-columns: 1fr; gap: var(--space-2); margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
    .site-footer .footer-meta > div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-3); margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
    .site-footer .footer-meta dt { margin: 0; padding: 0; color: var(--text-muted); font-size: var(--font-small); font-weight: 400; }
    .site-footer .footer-meta dd { margin: 0; padding: 0; font-size: var(--font-small); font-weight: 400; overflow-wrap: anywhere; }
    .site-footer .footer-meta a { display: inline-flex; min-height: var(--action-height); align-items: center; color: var(--text); }
    .action-row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
    .action, button { display: inline-flex; min-height: var(--action-height); align-items: center; justify-content: center; padding: var(--space-3) var(--space-4); border: 1px solid transparent; border-radius: var(--radius-action); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); text-align: center; text-decoration: none; cursor: pointer; transition: background-color 100ms ease-out, color 100ms ease-out, transform 100ms ease-out; }
    .action-primary, button.primary { background: var(--action); color: var(--action-text); }
    .action-primary:hover, button.primary:hover { background: var(--action-hover); }
    .action-secondary, button.secondary { border-color: var(--border); background: var(--surface); color: var(--text); }
    .action-secondary:hover, button.secondary:hover { background: var(--surface-subtle); }
    button.destructive { border-color: var(--error); background: var(--surface); color: var(--error); }
    button.destructive:hover { background: var(--surface-subtle); }
    .action:active, button:active { transform: scale(var(--pressed-scale)); }
    .action:focus-visible, button:focus-visible, input:focus-visible, .brand:focus-visible, .nav-list a:focus-visible, .footer-nav-list a:focus-visible, .footer-meta a:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    button:disabled { cursor: wait; opacity: .65; }
    .eyebrow { margin-bottom: var(--space-3); color: var(--text); font-size: var(--font-small); font-weight: var(--weight-bold); letter-spacing: var(--tracking-label); text-transform: uppercase; }
    [hidden] { display: none !important; }
    @media (max-width: 40rem) {
      .site-nav { align-items: flex-start; flex-direction: column; }
      .site-footer { grid-template-columns: 1fr; gap: var(--space-4); }
      .action-row { align-items: stretch; flex-direction: column; }
      .action, button { width: 100%; }
      .portal-page-shell .current-status, main.page-manage .current-status { grid-template-columns: 1fr; gap: var(--space-2); }
    }
    @media (min-width: 40.0625rem) and (max-width: 48rem) {
      .portal-page-shell.page-wide .flow ol, main.page-wide .flow ol { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-6); }
    }
    @media (max-width: 30rem) { .portal-page-shell { padding: var(--space-6); } }
    @media (max-width: 30rem) { .site-footer .footer-meta > div { grid-template-columns: 1fr; gap: 0; } }
    @media (prefers-reduced-motion: reduce) { .skip-link, .action, button { transition: none; } }`

export function renderPortalNavigation(currentPage: PortalPageName | null): string {
  const homeCurrent = currentPage === "home" ? ' aria-current="page"' : ""
  const statusCurrent = currentPage === "status" ? ' aria-current="page"' : ""
  const manageCurrent = currentPage === "manage" ? ' aria-current="page"' : ""
  return `<nav class="site-nav" aria-label="주요 메뉴">
      <a class="brand" href="/">Growful <span>SmartThings Gateway</span></a>
      <ul class="nav-list">
        <li><a href="/"${homeCurrent}>서비스 안내</a></li>
        <li><a href="/status"${statusCurrent}>상태</a></li>
        <li><a href="/manage"${manageCurrent}>연결 관리</a></li>
      </ul>
    </nav>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function renderPortalFooter(
  currentPage: PortalPageName | null,
  operatorName: string,
  supportEmail: string,
): string {
  const supportCurrent = currentPage === "support" ? ' aria-current="page"' : ""
  const privacyCurrent = currentPage === "privacy" ? ' aria-current="page"' : ""
  const termsCurrent = currentPage === "terms" ? ' aria-current="page"' : ""
  const safeOperatorName = escapeHtml(operatorName)
  const safeSupportEmail = escapeHtml(supportEmail)
  return `<footer class="site-footer">
      <nav aria-label="보조 메뉴">
        <ul class="footer-nav-list">
          <li><a href="/support"${supportCurrent}>지원 안내</a></li>
          <li><a href="/privacy"${privacyCurrent}>개인정보 처리방침</a></li>
          <li><a href="/terms"${termsCurrent}>이용약관</a></li>
        </ul>
      </nav>
      <dl class="footer-meta">
        <div><dt>운영자</dt><dd>${safeOperatorName}</dd></div>
        <div><dt>지원 이메일</dt><dd><a href="mailto:${safeSupportEmail}">${safeSupportEmail}</a></dd></div>
      </dl>
    </footer>`
}
