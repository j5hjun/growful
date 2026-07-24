import { describe, expect, it } from "vitest"
import {
  oauthCallbackResultKinds,
  renderOAuthCallbackResult,
} from "../src/http/oauth-callback-result.js"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { renderOAuthScopeSelection } from "../src/http/oauth-scope-selection.js"
import { oauthStartErrorKinds, renderOAuthStartError } from "../src/http/oauth-start-error.js"
import { renderPortalHome } from "../src/http/portal-home.js"
import { renderPortalManagement } from "../src/http/portal-manage.js"
import { renderPortalNotFound } from "../src/http/portal-not-found.js"
import { renderPortalPolicy } from "../src/http/portal-policy.js"
import { renderPortalStatus } from "../src/http/portal-status.js"
import { renderPortalSupport } from "../src/http/portal-support.js"
import {
  supportSafeInformation,
  supportSecretInformation,
} from "../src/http/support-safety-copy.js"
import { renderPrivateBetaAccessGuidance } from "../src/private-beta/access-guidance.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"
import { privateBetaOAuthAccess, publicOAuthAccess } from "./fixtures/oauth-access.js"

const privateAccess = privateBetaOAuthAccess([])
const noIncidents = { incidents: [], state: "available" } as const

const retiredUserPhrases = [
  "원본 invite secret",
  "초대받은 사용자 이름",
  "비공개 베타 사용자명",
  "SmartThings access·refresh token",
  "OAuth code·state",
  "OAuth 상태",
  "SmartThings OAuth 토큰",
  "HTTP 상태",
  "소비자 설정",
  "Linked Service",
  "공개 출시 전에",
  "백업·WAL",
  "공개 SLA",
  "SmartThings 인증",
  "SmartThings 토큰",
  "SmartThings API 요청이 차단되었습니다",
  "비공개 초대·운영 정책이 회수",
] as const

function expectCurrentUserLanguage(page: string): void {
  for (const phrase of retiredUserPhrases) expect(page).not.toContain(phrase)
}

describe("portal user language", () => {
  it("uses one private-beta credential vocabulary across user surfaces", () => {
    const pages = [
      renderPortalHome(privateAccess),
      renderPortalPolicy("privacy", privateAccess),
      renderPrivateBetaAccessGuidance({ kind: "authentication_failed" }),
      renderPrivateBetaAccessGuidance({ kind: "rate_limited", retryAfterSeconds: 60 }),
    ]

    for (const page of pages) {
      expect(page).toContain("초대 사용자 이름")
      expectCurrentUserLanguage(page)
    }
    expect(pages[0]).toContain("초대 비밀번호")
    expect(pages[0]).toContain("초대 비밀번호는 삼성 계정 비밀번호가 아닙니다")
    expect(pages[2]).toContain("초대 비밀번호")
    expect(pages[3]).toContain("초대 비밀번호")
  })

  it("separates the user-held Growful token from hidden SmartThings connection tokens", () => {
    const token = GrowfulTokenSchema.parse(`grw_st_${"A".repeat(43)}`)
    const pages = [
      renderPortalHome(publicOAuthAccess),
      renderPortalManagement(publicOAuthAccess),
      renderPortalPolicy("privacy", publicOAuthAccess),
      renderPortalPolicy("terms", publicOAuthAccess),
      renderPortalSupport(publicOAuthAccess),
    ]

    for (const page of pages) {
      expect(page).toContain("Growful 토큰")
      expect(page).toContain("SmartThings 연결 토큰")
      expectCurrentUserLanguage(page)
    }
    expect(renderOAuthScopeSelection({ disclosures: publicOAuthAccess })).toContain(
      "SmartThings 연결 토큰",
    )
    expect(renderOAuthCompletion(token)).toContain(
      "Growful 토큰을 요청 헤더에 Bearer 토큰으로 보내면 Gateway가 SmartThings API로 중계합니다.",
    )
    expect(renderPortalManagement(publicOAuthAccess)).toContain(
      "SmartThings 연결 토큰 마지막 자동 갱신",
    )
  })

  it("states the Gateway relay and access boundary on home, management, and completion pages", () => {
    const token = GrowfulTokenSchema.parse(`grw_st_${"B".repeat(43)}`)
    const home = renderPortalHome(publicOAuthAccess)
    const manage = renderPortalManagement(publicOAuthAccess)
    const completion = renderOAuthCompletion(token)

    expect(home).toContain(
      "Growful 토큰으로 이 Gateway에 요청하면 Gateway가 SmartThings API로 중계",
    )
    expect(manage).toContain("Growful Gateway의 SmartThings API 중계가 제한되었습니다")
    expect(manage).toContain("Gateway API 중계 접근 제한")
    expect(completion).toContain("Gateway가 SmartThings API로 중계합니다")
    expect(manage).not.toContain("SmartThings API 요청이 차단되었습니다")
  })

  it("explains both same-connection reauthorization and separate-connection outcomes", () => {
    const token = GrowfulTokenSchema.parse(`grw_st_${"C".repeat(43)}`)
    const pages = [
      renderOAuthCompletion(token),
      renderPortalManagement(publicOAuthAccess),
      renderPortalSupport(publicOAuthAccess),
    ]

    for (const page of pages) {
      expect(page).toContain(
        "같은 SmartThings 연결을 다시 승인하면 이전 Growful 토큰은 더 이상 사용할 수 없습니다.",
      )
      expect(page).toContain(
        "별도 SmartThings 연결로 승인하면 기존 Growful 연결은 자동으로 해제되지 않고 남을 수 있습니다.",
      )
      expect(page).not.toContain(
        "새 연결을 완료해도 기존 Growful 연결은 자동으로 해제되지 않습니다.",
      )
    }
  })

  it("distinguishes deletion, invite revocation, and Gateway access restrictions", () => {
    const privacy = renderPortalPolicy("privacy", privateAccess)
    const terms = renderPortalPolicy("terms", privateAccess)
    const support = renderPortalSupport(privateAccess)
    const manage = renderPortalManagement(privateAccess)

    expect(privacy).toContain("비공개 베타 초대가 회수")
    expect(privacy).toContain("Gateway API 중계 접근이 제한·중단되어도 연결 정보는 유지되며")
    expect(privacy).toContain("연결 관리 화면에서 연결을 해제할 수 있습니다")
    expect(terms).toContain("Gateway API 중계 접근을 제한·중단")
    expect(terms).toContain("비공개 베타 초대를 회수")
    expect(support).toContain("비공개 베타 초대를 회수")
    expect(support).toContain("해당 연결의 Gateway API 중계 접근을 제한·중단")
    for (const page of [terms, support, manage]) {
      expect(page).toContain(
        "이 작업은 Growful Gateway에 저장된 연결 정보만 삭제하며 SmartThings 쪽 상태는 변경하지 않습니다.",
      )
      expect(page).not.toContain("Linked Service")
      expect(page).not.toContain("SmartThings에 남아")
      expect(page).not.toContain("별도로 정리")
    }
  })

  it("keeps unresolved support commitments mode-aware", () => {
    const publicSupport = renderPortalSupport(publicOAuthAccess)
    const privateSupport = renderPortalSupport(privateAccess)

    for (const page of [publicSupport, privateSupport]) {
      expect(page).toContain("본인 확인 절차")
      expect(page).toContain("목표 응답시간")
      expect(page).toContain("아직 확정되지 않았습니다")
    }
    expect(publicSupport).not.toContain("공개 출시 전에")
    expect(publicSupport).not.toContain("공개 서비스로 전환하기 전에")
    expect(privateSupport).toContain("초대 없이 이용 가능한 공개 접근 모드로 전환하기 전에")
  })

  it("uses the same token-exposure response and callback recovery action", () => {
    const terms = renderPortalPolicy("terms", privateAccess)
    const support = renderPortalSupport(privateAccess)

    for (const page of [terms, support]) {
      expect(page).toContain(
        "Growful 토큰 노출이 의심되면 즉시 교체하고, 사용을 끝낼 때 연결을 해제합니다.",
      )
    }
    for (const kind of Object.values(oauthCallbackResultKinds)) {
      expect(renderOAuthCallbackResult(kind)).toContain(">권한 선택 다시 시작</a>")
    }
  })

  it("uses the same safe support boundary on support and error surfaces", () => {
    const errorPages = [
      ...Object.values(oauthStartErrorKinds).map((kind) => renderOAuthStartError(kind)),
      ...Object.values(oauthCallbackResultKinds).map((kind) => renderOAuthCallbackResult(kind)),
      renderPrivateBetaAccessGuidance({ kind: "authentication_failed" }),
      renderPrivateBetaAccessGuidance({ kind: "rate_limited", retryAfterSeconds: 60 }),
      renderPortalNotFound(),
      renderPortalManagement(publicOAuthAccess),
      renderPortalStatus("ready", noIncidents, publicOAuthAccess),
      renderPortalSupport(publicOAuthAccess),
    ]

    for (const page of errorPages) {
      expect(page).toContain(supportSafeInformation)
      expect(page).toContain(supportSecretInformation)
      expectCurrentUserLanguage(page)
    }
  })

  it("preserves the explicit Gateway readiness boundary", () => {
    const status = renderPortalStatus("ready", noIncidents, publicOAuthAccess)

    expect(status).toContain("Gateway 준비됨")
    expect(status).toContain("Gateway 상태만으로 SmartThings 정상 여부를 알 수 없습니다")
    expect(status).toContain("이 신호가 확인하지 않음")
    expect(status).toContain("SmartThings 서비스 자체의 상태")
    expect(status).toContain("공개 가동률 보장 목표와 목표 수치는 아직 확정되지 않았습니다")
  })
})
