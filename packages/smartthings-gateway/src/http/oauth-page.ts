import { type GatewayPageShell, renderGatewayFooter, renderGatewayHeader } from "./portal-shell.js"

export type GatewayPageOptions = {
  readonly body: string
  readonly description: string
  readonly layout?: "manage" | "panel" | "wide"
  readonly robots?: "index,follow" | "noindex,nofollow"
  readonly scriptSource?: "/portal.js"
  readonly shell?: GatewayPageShell
  readonly styles?: string
  readonly title: string
}

const sharedStyles = `
    :root {
      color-scheme: light dark;
      font-family: "SF Pro Display", "Helvetica Neue", system-ui, sans-serif;
      --canvas: #f7f6f3; --surface: #ffffff; --text: #2f3437; --text-muted: #667085;
      --border: #89919a; --action: #20242a; --action-text: #ffffff;
      --action-hover: #353b43; --surface-subtle: #f2f4f7; --success: #067647;
      --backdrop: #101820b3;
      --focus: #2563eb; --error: #b42318; --shadow-panel: #1f29370a;
      --font-h1: 1.75rem; --font-h1-mobile: 1.5rem; --font-h2: 1.125rem; --font-body: 1rem;
      --font-small: .875rem; --weight-bold: 700; --line-heading: 1.25; --line-body: 1.6;
      --line-action: 1.25; --tracking-h1: -.02em; --tracking-label: .08em;
      --panel-max: 34rem; --panel-manage: 42rem; --panel-wide: 64rem;
      --control-size: 1.125rem; --control-offset: .15rem;
      --radius-panel: .75rem; --radius-field: .5rem; --radius-action: .375rem;
      --action-height: 2.75rem; --focus-ring: 3px; --pressed-scale: .98;
      --safe-area-top: max(var(--page-gutter), env(safe-area-inset-top));
      --safe-area-bottom: max(var(--page-gutter), env(safe-area-inset-bottom));
      --page-gutter: var(--space-8); --shell-padding: var(--space-6);
      --page-title-space: var(--space-12); --section-gap: var(--space-8);
      --card-padding: var(--space-6);
      --space-2: .5rem; --space-3: .75rem; --space-4: 1rem; --space-6: 1.5rem;
      --space-8: 2rem; --space-12: 3rem; --space-16: 4rem;
    }
    * { box-sizing: border-box; }
    html { min-width: 0; }
    body { margin: 0; min-width: 0; min-height: 100dvh; padding: var(--safe-area-top) var(--page-gutter) var(--safe-area-bottom); scroll-padding-block: var(--safe-area-top) calc(var(--action-height) + var(--section-gap) + var(--safe-area-bottom)); background: var(--canvas); color: var(--text); font-size: var(--font-body); }
    .skip-link { position: fixed; z-index: 2; top: var(--safe-area-top); left: var(--page-gutter); min-height: var(--action-height); padding: var(--space-3) var(--space-4); border-radius: var(--radius-action); background: var(--action); color: var(--action-text); font-weight: var(--weight-bold); text-decoration: none; transform: translateY(calc(-100% - var(--space-8))); transition: transform 100ms ease-out; }
    .skip-link:focus { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); transform: translateY(0); }
    .page-shell { width: min(var(--panel-wide), 100%); min-width: 0; margin-inline: auto; padding-inline: var(--shell-padding); border-radius: var(--radius-panel); background: var(--surface); box-shadow: 0 var(--space-2) var(--space-8) var(--shadow-panel); }
    .site-header { display: flex; min-width: 0; min-height: 4rem; align-items: center; border-bottom: 1px solid var(--border); }
    .site-nav { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: var(--space-4); }
    .brand { display: inline-flex; min-width: 0; min-height: var(--action-height); flex-wrap: wrap; align-items: center; color: var(--text); font-weight: var(--weight-bold); text-decoration: none; }
    .brand span { min-width: 0; margin-inline-start: .35em; color: var(--text-muted); font-weight: 400; overflow-wrap: anywhere; }
    .nav-list, .footer-nav-list { display: flex; min-width: 0; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .nav-list li, .footer-nav-list li { min-width: 0; }
    .nav-list a, .nav-list .task-context, .footer-nav-list a { display: inline-flex; min-width: var(--action-height); min-height: var(--action-height); align-items: center; justify-content: center; padding: 0 var(--space-3); border-radius: var(--radius-action); color: var(--text-muted); font-size: var(--font-small); font-weight: var(--weight-bold); text-decoration: none; }
    .nav-list a[aria-current=page], .nav-list .task-context[aria-current=page], .footer-nav-list a[aria-current=page] { background: var(--surface-subtle); color: var(--text); }
    .nav-list a:hover, .footer-nav-list a:hover { color: var(--text); }
    .page-content { width: 100%; min-width: 0; margin-inline: auto; padding: 0; border: 0; background: transparent; }
    .page-content.page-panel { max-width: var(--panel-max); }
    .page-content.page-manage { max-width: var(--panel-manage); }
    .page-content.page-wide { max-width: var(--panel-wide); }
    .touch-link { display: inline-flex; min-width: var(--action-height); min-height: var(--action-height); align-items: center; }
    .page-title { padding-block: var(--page-title-space); }
    .section-flow { display: grid; gap: var(--section-gap); }
    .site-footer { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--section-gap); margin-top: var(--section-gap); padding-block: var(--space-6); border-top: 1px solid var(--border); }
    .site-footer > *, .footer-nav-list li { min-width: 0; }
    .site-footer .footer-meta { display: grid; grid-template-columns: 1fr; gap: var(--space-2); margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
    .site-footer .footer-meta > div { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-3); margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; }
    .site-footer .footer-meta dt { margin: 0; padding: 0; color: var(--text-muted); font-size: var(--font-small); font-weight: 400; }
    .site-footer .footer-meta dd { margin: 0; padding: 0; font-size: var(--font-small); font-weight: 400; overflow-wrap: anywhere; }
    .site-footer .footer-meta a { display: inline-flex; min-height: var(--action-height); align-items: center; color: var(--text); }
    .task-footer-context { display: grid; gap: var(--space-2); margin: 0; }
    .task-footer-context span { color: var(--text-muted); font-size: var(--font-small); line-height: var(--line-body); }
    h1 { margin: 0 0 var(--space-3); font-size: var(--font-h1); line-height: var(--line-heading); letter-spacing: var(--tracking-h1); }
    h2 { font-size: var(--font-h2); line-height: var(--line-heading); }
    p { margin: 0 0 var(--space-6); color: var(--text-muted); line-height: var(--line-body); text-wrap: pretty; }
    h1, h2, h3, p, label, button, a { word-break: keep-all; overflow-wrap: break-word; }
    .phrase { display: inline-block; max-width: 100%; white-space: nowrap; }
    .brand:focus-visible, .nav-list a:focus-visible, .footer-nav-list a:focus-visible, .site-footer a:focus-visible { outline: var(--focus-ring) solid var(--focus); outline-offset: var(--focus-ring); }
    @media (max-width: 64rem) {
      :root { --page-gutter: var(--space-6); }
    }
    @media (max-width: 40rem) {
      :root { --page-gutter: var(--space-4); --shell-padding: var(--space-4); --page-title-space: var(--space-6); --section-gap: var(--space-6); --card-padding: var(--space-4); }
      .site-header { min-height: 3.5rem; padding-block: var(--space-2); }
      .site-nav { align-items: flex-start; flex-direction: column; gap: var(--space-2); }
      .site-footer { grid-template-columns: 1fr; gap: var(--space-4); }
      h1 { font-size: var(--font-h1-mobile); }
      .phrase { white-space: normal; }
    }
    @media (max-width: 30rem) {
      .site-footer .footer-meta > div { grid-template-columns: 1fr; gap: 0; }
    }
    @media (max-width: 20rem) {
      :root { --page-gutter: var(--space-3); --shell-padding: var(--space-3); }
      .site-nav, .site-nav > *, .nav-list, .site-footer, .site-footer > *, .footer-nav-list, .site-footer .footer-meta, .site-footer .footer-meta > div { width: 100%; min-width: 0; }
      .nav-list, .footer-nav-list { gap: 0; }
      .nav-list li, .footer-nav-list li { max-width: 100%; }
      .nav-list a, .nav-list .task-context, .footer-nav-list a { padding-inline: var(--space-2); white-space: normal; }
    }
    @media (prefers-color-scheme: dark) {
      :root { --canvas: #101820; --surface: #19232d; --text: #edf2f7; --text-muted: #aeb8c4; --border: #748396; --action: #e8eef5; --action-text: #17202a; --action-hover: #ffffff; --surface-subtle: #23303c; --success: #6ce9a6; --backdrop: #101820cc; --focus: #60a5fa; --error: #ffb4ab; }
    }
    @media (forced-colors: active) {
      .nav-list a[aria-current="page"], .nav-list .task-context[aria-current="page"], .footer-nav-list a[aria-current="page"] { border: 2px solid ButtonText; }
    }
    @media (prefers-reduced-motion: reduce) { .skip-link { transition: none; } }`

export function renderGatewayPage(options: GatewayPageOptions): string {
  const layout = options.layout ?? "panel"
  const shell = options.shell ?? { variant: "task" }
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${options.description}">
  <meta name="robots" content="${options.robots ?? "noindex,nofollow"}">
  <title>${options.title}</title>
  <style>${sharedStyles}${options.styles ?? ""}
  </style>
</head>
<body>
  <a class="skip-link" href="#main-content">본문 바로가기</a>
  <div class="page-shell" data-page-shell data-body-width="${layout}">
    ${renderGatewayHeader(shell)}
    <main id="main-content" tabindex="-1" class="page-content page-${layout}">${options.body}
    </main>
    ${renderGatewayFooter(shell)}
  </div>
  ${options.scriptSource === undefined ? "" : `<script src="${options.scriptSource}" defer></script>`}
</body>
</html>`
}
