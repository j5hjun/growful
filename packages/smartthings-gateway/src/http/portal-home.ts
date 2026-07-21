import { renderGatewayPage } from "./oauth-page.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import { portalSharedStyles, renderPortalNavigation } from "./portal-shell.js"

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function renderPortalHome(access: OAuthAccessPolicy): string {
  const accessLabel = access.mode === "private_beta" ? "비공개 베타" : "공개 서비스"
  const descriptionSuffix = access.mode === "private_beta" ? "비공개 베타 Gateway" : "Gateway"
  const operatorName = escapeHtml(access.operatorName)
  const privacyPolicyUrl = escapeHtml(access.privacyPolicyUrl.toString())
  const supportEmail = escapeHtml(access.supportEmail)
  const termsUrl = escapeHtml(access.termsUrl.toString())
  return renderGatewayPage({
    body: `
    ${renderPortalNavigation("home")}
    <header class="hero" data-portal-home>
      <p class="eyebrow">${accessLabel}</p>
      <h1><span class="phrase">SmartThings 연결은 한 번,</span><br><span class="phrase">토큰 관리는 안전하게.</span></h1>
      <p class="hero-copy">Growful Gateway가 SmartThings OAuth 토큰을 암호화해 보관하고 갱신합니다. <span class="phrase">삼성 계정 비밀번호 대신</span> <span class="phrase">별도로 발급된 Growful 토큰으로</span> <span class="phrase">SmartThings API를 호출합니다.</span></p>
      <div class="action-row">
        <a class="action action-primary" href="/oauth/start" data-action="connect">SmartThings 연결 시작</a>
        <a class="action action-secondary" href="/manage" data-action="manage">기존 연결 관리</a>
      </div>
    </header>
    <section class="flow" aria-labelledby="flow-title">
      <p class="eyebrow">연결 흐름</p>
      <h2 id="flow-title">세 단계로 연결됩니다</h2>
      <ol>
        <li><span class="step-number">01</span><h3>권한 선택</h3><p>필요한 디바이스와 기능만 고른 뒤 <span class="phrase">SmartThings 화면에서 승인합니다.</span></p></li>
        <li><span class="step-number">02</span><h3>토큰 수령</h3><p>Gateway 전용 Growful 토큰이 <span class="phrase">완료 화면에 한 번 표시됩니다.</span></p></li>
        <li><span class="step-number">03</span><h3>연결 사용</h3><p>Growful 토큰으로 연결 상태를 확인하고 SmartThings API를 호출합니다.</p></li>
      </ol>
    </section>
    <section class="trust-boundary" aria-labelledby="boundary-title">
      <div>
        <p class="eyebrow">보안 경계</p>
        <h2 id="boundary-title"><span class="phrase">삼성 계정 자격 증명은</span> <span class="phrase">받지 않습니다</span></h2>
      </div>
      <p>승인은 SmartThings에서 직접 진행됩니다. 관리 화면에 입력한 Growful 토큰은 URL, 쿠키 또는 브라우저 저장소에 남기지 않습니다. <span class="phrase">이 탭에서만 사용합니다.</span></p>
    </section>
    <section class="service-disclosures" aria-labelledby="disclosures-title">
      <div><p class="eyebrow">운영 및 정책</p><h2 id="disclosures-title">서비스 정보를 확인하세요</h2></div>
      <dl>
        <div><dt>운영자</dt><dd>${operatorName}</dd></div>
        <div><dt>지원</dt><dd><a href="mailto:${supportEmail}">${supportEmail}</a></dd></div>
        <div><dt>정책</dt><dd><a href="${privacyPolicyUrl}">개인정보 처리방침</a> · <a href="${termsUrl}">이용약관</a></dd></div>
      </dl>
    </section>`,
    description: `SmartThings OAuth 토큰을 대신 보관하고 Growful 토큰으로 안전하게 연결하는 ${descriptionSuffix}입니다.`,
    layout: "wide",
    robots: access.mode === "public" ? "index,follow" : "noindex,nofollow",
    styles: `${portalSharedStyles}
    .hero { max-width: var(--panel-manage); padding: var(--space-12) 0 var(--space-16); }
    .hero h1 { margin-bottom: var(--space-6); }
    .hero-copy { font-size: var(--font-h2); }
    .flow { padding: var(--space-8) 0; border-top: 1px solid var(--border); }
    .flow h2 { margin: 0 0 var(--space-8); }
    .flow ol { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-6); margin: 0; padding: 0; list-style: none; }
    .flow li { padding-top: var(--space-4); border-top: 1px solid var(--border); }
    .step-number { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; color: var(--text-muted); font-size: var(--font-small); }
    .flow h3 { margin: var(--space-4) 0 var(--space-2); font-size: var(--font-body); }
    .flow li p { margin: 0; font-size: var(--font-small); }
    .trust-boundary { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-8); align-items: start; margin-top: var(--space-8); padding: var(--space-6); border-radius: var(--radius-field); background: var(--surface-subtle); }
    .trust-boundary h2, .trust-boundary p { margin: 0; }
    .service-disclosures { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-8); align-items: start; margin-top: var(--space-8); padding: var(--space-6) 0; border-top: 1px solid var(--border); }
    .service-disclosures h2, .service-disclosures dl { margin: 0; }
    .service-disclosures dl { display: grid; gap: var(--space-3); }
    .service-disclosures dt { color: var(--text-muted); font-size: var(--font-small); }
    .service-disclosures dd { margin: var(--space-2) 0 0; }
    .service-disclosures a { color: var(--text); }
    @media (max-width: 48rem) {
      .hero { padding: var(--space-8) 0 var(--space-12); }
      .flow ol, .trust-boundary, .service-disclosures { grid-template-columns: 1fr; }
      .flow ol, .trust-boundary, .service-disclosures { gap: var(--space-4); }
    }`,
    title: "Growful SmartThings Gateway",
  })
}
