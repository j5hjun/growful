import { renderGatewayPage } from "./oauth-page.js"
import { portalSharedStyles, renderPortalNavigation } from "./portal-shell.js"
import { renderSupportSafetyGuidance } from "./support-safety-copy.js"

export function renderPortalNotFound(): string {
  return renderGatewayPage({
    body: `
    ${renderPortalNavigation(null)}
    <article class="not-found-document" data-not-found-document>
      <p class="eyebrow">404</p>
      <h1>페이지를 찾을 수 없습니다</h1>
      <p>주소가 바뀌었거나 입력한 경로가 Growful 포털에 없습니다. 아래에서 필요한 화면으로 이동할 수 있습니다.</p>
      <div class="action-row">
        <a class="action action-primary" href="/">서비스 안내로 돌아가기</a>
        <a class="action action-secondary" href="/status">서비스 상태 확인</a>
      </div>
      <p class="not-found-support">찾는 정보를 계속 발견하지 못했다면 <a class="phrase" href="/support">지원 안내</a>에서 문의 방법을 확인해 주세요.</p>
      <aside class="support-safety" aria-label="안전한 지원 문의">
        ${renderSupportSafetyGuidance()}
      </aside>
    </article>`,
    description: "요청한 Growful SmartThings Gateway 포털 페이지를 찾을 수 없습니다.",
    layout: "manage",
    robots: "noindex,nofollow",
    styles: `${portalSharedStyles}
    .not-found-document { max-width: var(--panel-manage); padding: var(--space-12) 0 var(--space-8); }
    .not-found-document > p:not(.eyebrow) { font-size: var(--font-h2); }
    .not-found-support { margin: var(--space-8) 0 0; padding-top: var(--space-6); border-top: 1px solid var(--border); }
    .support-safety { margin-top: var(--space-4); padding: var(--space-4); border-radius: var(--radius-field); background: var(--surface-subtle); font-size: var(--font-small); }
    .support-safety p { margin-bottom: var(--space-3); }
    .support-safety p:last-child { margin-bottom: 0; }
    .not-found-document a:not(.action) { color: var(--text); }`,
    title: "페이지를 찾을 수 없습니다 · Growful SmartThings Gateway",
  })
}
