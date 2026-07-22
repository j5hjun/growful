export type GatewayPageOptions = {
  readonly body: string
  readonly description: string
  readonly layout?: "manage" | "panel" | "wide"
  readonly robots?: "index,follow" | "noindex,nofollow"
  readonly scriptSource?: "/portal.js"
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
      --safe-area-bottom: max(var(--space-4), env(safe-area-inset-bottom));
      --space-2: .5rem; --space-3: .75rem; --space-4: 1rem; --space-6: 1.5rem;
      --space-8: 2rem; --space-12: 3rem; --space-16: 4rem;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: var(--space-4); scroll-padding-block-end: calc(var(--action-height) + var(--space-8) + var(--safe-area-bottom)); background: var(--canvas); color: var(--text); font-size: var(--font-body); }
    main { width: min(var(--page-max), 100%); min-width: 0; padding: var(--space-8); border-radius: var(--radius-panel); background: var(--surface); box-shadow: 0 var(--space-2) var(--space-8) var(--shadow-panel); }
    main.page-panel { --page-max: var(--panel-max); }
    main.page-manage { --page-max: var(--panel-manage); }
    main.page-wide { --page-max: var(--panel-wide); }
    h1 { margin: 0 0 var(--space-3); font-size: var(--font-h1); line-height: var(--line-heading); letter-spacing: var(--tracking-h1); }
    h2 { font-size: var(--font-h2); line-height: var(--line-heading); }
    p { margin: 0 0 var(--space-6); color: var(--text-muted); line-height: var(--line-body); text-wrap: pretty; }
    h1, h2, h3, p, label, button, a { word-break: keep-all; overflow-wrap: break-word; }
    .phrase { display: inline-block; max-width: 100%; white-space: nowrap; }
    @media (max-width: 30rem) { main { padding: var(--space-6); } h1 { font-size: var(--font-h1-mobile); } }
    @media (prefers-color-scheme: dark) {
      :root { --canvas: #101820; --surface: #19232d; --text: #edf2f7; --text-muted: #aeb8c4; --border: #748396; --action: #e8eef5; --action-text: #17202a; --action-hover: #ffffff; --surface-subtle: #23303c; --success: #6ce9a6; --backdrop: #101820cc; --focus: #60a5fa; --error: #ffb4ab; }
    }`

export function renderGatewayPage(options: GatewayPageOptions): string {
  const layout = options.layout ?? "panel"
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
  <main class="page-${layout}">${options.body}
  </main>
  ${options.scriptSource === undefined ? "" : `<script src="${options.scriptSource}" defer></script>`}
</body>
</html>`
}
