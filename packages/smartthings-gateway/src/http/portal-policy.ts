import { servicePolicyRevision } from "../config.js"
import { renderGatewayPage } from "./oauth-page.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import {
  type PortalPageName,
  portalSharedStyles,
  renderPortalEmailLink,
  renderPortalNavigation,
} from "./portal-shell.js"

export type PolicyDocumentName = Extract<PortalPageName, "privacy" | "terms">

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function renderPrivacySections(mode: OAuthAccessPolicy["mode"]): string {
  const betaIdentityItem =
    mode === "private_beta" ? ", 동의한 정책 버전, 비공개 베타 사용자명" : ", 동의한 정책 버전"
  const retentionBoundary =
    mode === "private_beta"
      ? "백업과 감사 기록의 구체적인 보존 기간은 공개 서비스 전 확정해야 하는 운영 정책입니다. 확정 전에는 이 서비스를 비공개 베타 범위에서 운영합니다."
      : "백업과 감사 기록의 구체적인 보존 기간은 이 문서에 아직 명시되어 있지 않습니다. 지원 이메일로 적용 중인 보존 범위와 삭제 처리 결과를 문의할 수 있습니다."
  const revokedAccess = mode === "private_beta" ? "비공개 초대·운영 정책" : "운영 정책"
  return `<section aria-labelledby="privacy-purpose">
      <h2 id="privacy-purpose">1. 처리 목적과 항목</h2>
      <p>Gateway는 사용자가 선택한 SmartThings 권한으로 연결을 만들고, 연결 상태 확인과 API 중계를 제공하기 위해 다음 정보를 처리합니다.</p>
      <ul>
        <li>OAuth 진행 정보: 요청 권한, 일회용 상태값의 해시${betaIdentityItem}</li>
        <li>연결 정보: SmartThings 설치 식별자, 승인 권한, 토큰 만료·갱신 시각과 상태</li>
        <li>자격 증명: 암호화된 SmartThings access·refresh token과 해시 처리된 Growful 토큰</li>
        <li>보안·운영 정보: 연결별 요청량, 고정된 접근 제한 사유, 가명화된 감사·지원 참조</li>
      </ul>
      <p>SmartThings API 요청과 응답 본문은 Gateway의 애플리케이션 데이터베이스에 별도 기록하지 않습니다.</p>
    </section>
    <section aria-labelledby="privacy-flow">
      <h2 id="privacy-flow">2. 처리 흐름과 제3자 서비스</h2>
      <p>권한 승인은 SmartThings 화면에서 직접 진행되며, Gateway는 삼성 계정 비밀번호를 받지 않습니다. 토큰 교환과 API 호출 과정에서 요청 정보는 SmartThings로 전달됩니다. SmartThings의 정보 처리는 해당 서비스의 정책이 적용됩니다.</p>
    </section>
    <section aria-labelledby="privacy-retention">
      <h2 id="privacy-retention">3. 보관과 삭제</h2>
      <ul>
        <li>OAuth 상태는 10분 동안 유효하고 한 번 사용하면 즉시 소비됩니다. 정상 실행 중 만료된 행은 최대 5분 안에 정리되므로 생성 후 데이터베이스에 남는 시간은 최대 15분입니다.</li>
        <li>연결 정보는 사용자가 연결을 해제하거나, ${revokedAccess}이 회수되거나, SmartThings 설치 삭제 알림을 받을 때 활성 데이터베이스에서 삭제됩니다.</li>
        <li>활성 데이터베이스에서 삭제하더라도 <span class="phrase">백업·WAL·운영 로그</span>에서 즉시 영구 삭제된다는 의미는 아닙니다.</li>
      </ul>
      <p>${retentionBoundary}</p>
    </section>
    <section aria-labelledby="privacy-security">
      <h2 id="privacy-security">4. 보호 조치와 사용자 권리</h2>
      <p>SmartThings 토큰은 암호화해 저장하고, Growful 토큰은 원문 대신 해시로 검증합니다. 전송 구간 HTTPS, 요청량 제한, 접근 회수와 감사 기록을 적용합니다.</p>
      <p>자신의 연결 정보 확인·삭제 또는 개인정보 관련 문의는 아래 지원 이메일로 요청할 수 있습니다. 연결 관리 화면에서 Growful 연결을 직접 해제할 수도 있습니다.</p>
    </section>`
}

function renderTermsSections(mode: OAuthAccessPolicy["mode"]): string {
  const serviceScope = mode === "private_beta" ? "비공개 베타의" : "공개 서비스의"
  const enforcement =
    mode === "private_beta"
      ? "해당 연결의 API 접근을 제한하거나 비공개 초대를 회수할 수 있습니다."
      : "해당 연결의 API 접근을 제한할 수 있습니다."
  const boundary =
    mode === "private_beta"
      ? "공개·유료 서비스의 가격, 환불, 책임 제한, 준거법과 분쟁 절차는 아직 확정되지 않았으며 이 문서가 해당 조건을 대신하지 않습니다. 공개 전 별도의 법률 검토와 최종 약관 확정이 필요합니다."
      : "유료 서비스의 가격, 환불, 책임 제한, 준거법과 분쟁 절차는 아직 확정되지 않았으며 이 문서가 해당 조건을 대신하지 않습니다. 유료화 전 별도의 법률 검토와 최종 약관 확정이 필요합니다."
  return `<section aria-labelledby="terms-scope">
      <h2 id="terms-scope">1. 서비스 범위</h2>
      <p>이 약관은 Growful SmartThings Gateway ${serviceScope} 기술적 이용 조건입니다. Gateway는 사용자가 승인한 SmartThings OAuth 토큰을 보관·갱신하고, 별도로 발급한 Growful 토큰으로 연결 상태 확인과 API 중계를 제공합니다.</p>
    </section>
    <section aria-labelledby="terms-responsibility">
      <h2 id="terms-responsibility">2. 사용자 책임</h2>
      <ul>
        <li>필요한 최소 SmartThings 권한만 선택하고 Growful 토큰을 비밀로 관리해야 합니다.</li>
        <li>SmartThings 이용 조건과 관계 법령을 준수해야 하며, 타인의 기기나 연결에 무단 접근해서는 안 됩니다.</li>
        <li>토큰 노출이 의심되면 연결 관리 화면에서 연결을 해제하고 지원 이메일로 알려야 합니다.</li>
      </ul>
    </section>
    <section aria-labelledby="terms-limits">
      <h2 id="terms-limits">3. 이용 제한과 중단</h2>
      <p>Gateway 요청은 연결당 분당 60회로 제한됩니다. 할당량 남용, 보안 사고, 약관 위반이 확인되면 ${enforcement}</p>
      <p>점검, 장애, SmartThings API 변경 또는 보안 대응을 위해 서비스 일부가 일시 중단될 수 있습니다.</p>
    </section>
    <section aria-labelledby="terms-disconnect">
      <h2 id="terms-disconnect">4. 연결 해제</h2>
      <p>Growful 연결 해제는 Gateway에 저장된 연결과 토큰을 삭제합니다. SmartThings 측 설치 자체의 삭제와는 별도 작업이므로, 필요한 경우 SmartThings에서도 설치를 삭제해야 합니다.</p>
    </section>
    <section aria-labelledby="terms-boundary">
      <h2 id="terms-boundary">5. 현재 약관의 경계</h2>
      <p>Growful Gateway는 Samsung 또는 SmartThings의 공식 인증을 받았다는 의미가 아닙니다. ${boundary}</p>
    </section>`
}

export function renderPortalPolicy(
  documentName: PolicyDocumentName,
  access: OAuthAccessPolicy,
): string {
  const isPrivacy = documentName === "privacy"
  const operatorName = escapeHtml(access.operatorName)
  const supportEmailLink = renderPortalEmailLink(access.supportEmail)
  const title = isPrivacy ? "개인정보 처리방침" : "이용약관"
  const summary = isPrivacy
    ? "Growful SmartThings Gateway가 연결 과정에서 어떤 정보를 처리하고 보호하는지 설명합니다."
    : `Growful SmartThings Gateway ${access.mode === "private_beta" ? "비공개 베타" : "공개 서비스"}를 안전하게 이용하기 위한 기술적 조건입니다.`
  return renderGatewayPage({
    body: `
    ${renderPortalNavigation(documentName)}
    <article class="policy-document" data-policy-document="${documentName}">
      <header>
        <p class="eyebrow">정책 문서</p>
        <h1>${title}</h1>
        <p class="policy-summary">${summary}</p>
        <p class="policy-revision">개정일 ${servicePolicyRevision}</p>
      </header>
      ${isPrivacy ? renderPrivacySections(access.mode) : renderTermsSections(access.mode)}
      <section class="policy-contact" aria-labelledby="policy-contact-title">
        <h2 id="policy-contact-title">${isPrivacy ? "5. " : "6. "}운영자와 문의</h2>
        <dl><div><dt>운영자</dt><dd>${operatorName}</dd></div><div><dt>지원 이메일</dt><dd>${supportEmailLink}</dd></div></dl>
      </section>
    </article>`,
    description: summary,
    layout: "manage",
    robots: access.mode === "public" ? "index,follow" : "noindex,nofollow",
    styles: `${portalSharedStyles}
    .policy-document { padding-top: var(--space-8); }
    .policy-document header { padding-bottom: var(--space-6); border-bottom: 1px solid var(--border); }
    .policy-document header p:last-child { margin-bottom: 0; }
    .policy-summary { font-size: var(--font-h2); }
    .policy-revision { font-size: var(--font-small); }
    .policy-document section { padding: var(--space-6) 0; border-bottom: 1px solid var(--border); }
    .policy-document section:last-child { border-bottom: 0; padding-bottom: 0; }
    .policy-document section h2 { margin: 0 0 var(--space-4); }
    .policy-document section p:last-child, .policy-document section ul:last-child { margin-bottom: 0; }
    .policy-document ul { display: grid; gap: var(--space-2); margin: 0 0 var(--space-6); padding-left: var(--space-6); color: var(--text-muted); line-height: var(--line-body); }
    .policy-contact dl { display: grid; gap: var(--space-3); margin: 0; }
    .policy-contact dl div { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--space-4); }
    .policy-contact dt { color: var(--text-muted); }
    .policy-contact dd { margin: 0; overflow-wrap: anywhere; }
    .policy-contact a { color: var(--text); }
    @media (max-width: 30rem) { .policy-contact dl div { grid-template-columns: 1fr; gap: var(--space-2); } }`,
    title: `${title} · Growful SmartThings Gateway`,
  })
}
