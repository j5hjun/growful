const portalPageNames = ["home", "manage"] as const

export type PortalPageName = (typeof portalPageNames)[number]

export const portalSharedStyles = `
    .site-nav { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding-bottom: var(--space-6); border-bottom: 1px solid var(--border); }
    .brand { color: var(--text); font-weight: var(--weight-bold); text-decoration: none; }
    .brand span { color: var(--text-muted); font-weight: 400; }
    .nav-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .nav-list a { display: inline-flex; min-height: var(--action-height); align-items: center; padding: 0 var(--space-3); border-radius: var(--radius-action); color: var(--text-muted); font-size: var(--font-small); font-weight: var(--weight-bold); text-decoration: none; }
    .nav-list a[aria-current=page] { background: var(--surface-subtle); color: var(--text); }
    .nav-list a:hover { color: var(--text); }
    .action-row { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
    .action, button { display: inline-flex; min-height: var(--action-height); align-items: center; justify-content: center; padding: var(--space-3) var(--space-4); border: 1px solid transparent; border-radius: var(--radius-action); font: inherit; font-weight: var(--weight-bold); line-height: var(--line-action); text-align: center; text-decoration: none; cursor: pointer; transition: background-color 100ms ease-out, color 100ms ease-out, transform 100ms ease-out; }
    .action-primary, button.primary { background: var(--action); color: var(--action-text); }
    .action-primary:hover, button.primary:hover { background: var(--action-hover); }
    .action-secondary, button.secondary { border-color: var(--border); background: var(--surface); color: var(--text); }
    .action-secondary:hover, button.secondary:hover { background: var(--surface-subtle); }
    button.destructive { border-color: var(--error); background: var(--surface); color: var(--error); }
    button.destructive:hover { background: var(--surface-subtle); }
    .action:active, button:active { transform: scale(var(--pressed-scale)); }
    .action:focus-visible, button:focus-visible, input:focus-visible, .brand:focus-visible, .nav-list a:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    button:disabled { cursor: wait; opacity: .65; }
    .eyebrow { margin-bottom: var(--space-3); color: var(--text); font-size: var(--font-small); font-weight: var(--weight-bold); letter-spacing: var(--tracking-label); text-transform: uppercase; }
    [hidden] { display: none !important; }
    @media (max-width: 48rem) {
      .site-nav { align-items: flex-start; flex-direction: column; }
      .action-row { align-items: stretch; flex-direction: column; }
      .action, button { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) { .action, button { transition: none; } }`

export function renderPortalNavigation(currentPage: PortalPageName): string {
  const homeCurrent = currentPage === "home" ? ' aria-current="page"' : ""
  const manageCurrent = currentPage === "manage" ? ' aria-current="page"' : ""
  return `<nav class="site-nav" aria-label="주요 메뉴">
      <a class="brand" href="/">Growful <span>SmartThings Gateway</span></a>
      <ul class="nav-list">
        <li><a href="/"${homeCurrent}>서비스 안내</a></li>
        <li><a href="/manage"${manageCurrent}>연결 관리</a></li>
      </ul>
    </nav>`
}
