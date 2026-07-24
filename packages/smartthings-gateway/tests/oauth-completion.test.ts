import { describe, expect, it } from "vitest"
import { renderOAuthCompletion } from "../src/http/oauth-completion.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"

describe("OAuth completion one-time token actions", () => {
  it("renders explicit copy and management actions without gating navigation", () => {
    // Given
    const token = GrowfulTokenSchema.parse(`grw_st_${"A".repeat(43)}`)

    // When
    const page = renderOAuthCompletion(token)

    // Then
    expect(page).toContain("data-token-safety")
    expect(page).toMatch(
      /<button[^>]*data-copy-token[^>]*hidden disabled[^>]*>Growful 토큰 복사<\/button>/,
    )
    expect(page).toMatch(
      /<textarea[^>]*data-token-value[^>]*data-growful-token[^>]*readonly[^>]*>grw_st_[A]+<\/textarea>/,
    )
    expect(page).not.toMatch(/<textarea[^>]*data-token-value[^>]*\sname=/)
    expect(page).not.toMatch(/<textarea[^>]*data-token-value[^>]*\sform=/)
    expect(page).toContain("data-token-manual-copy")
    expect(page).toContain("Ctrl+C 또는 Command+C를 눌러 직접 복사할 수 있습니다.")
    expect(page).toContain('data-token-copy-feedback role="status" aria-live="polite"')
    expect(page).toContain('data-token-copy-error role="alert"')
    expect(page).toContain("토큰 전체를 선택했습니다.")
    expect(page).toMatch(
      /<a[^>]*href="\/manage"[^>]*data-action="manage-issued-token"[^>]*>관리 화면에서 연결 확인<\/a>/,
    )
    expect(page).toContain("이 페이지를 떠나면 토큰을 다시 볼 수 없습니다.")
    expect(page).toContain("복사하거나 안전한 곳에 저장했는지 확인하기 전에는")
    expect(page).toContain("페이지를 닫거나 이동하지 마세요.")
    expect(page).toContain("분실하면 SmartThings 연결을 다시 완료해야 합니다.")
    expect(page).toContain(
      "같은 SmartThings 연결을 다시 승인하면 이전 Growful 토큰은 더 이상 사용할 수 없습니다.",
    )
    expect(page).toContain(
      "별도 SmartThings 연결로 승인하면 기존 Growful 연결은 자동으로 해제되지 않고 남을 수 있습니다.",
    )
    expect(page).toContain(
      '<section class="api-quickstart" aria-labelledby="api-quickstart-title">',
    )
    expect(page).toContain('<h2 id="api-quickstart-title">첫 API 요청</h2>')
    expect(page).toContain(
      "이 Gateway와 같은 주소의 <code>/v1</code> 아래에 SmartThings API 경로를 붙이세요. Growful 토큰을 요청 헤더에 Bearer 토큰으로 보내면 Gateway가 SmartThings API로 중계합니다.",
    )
    expect(page).toContain(
      "디바이스 읽기 권한을 선택한 경우 아래처럼 요청할 수 있습니다. 다른 권한만 승인했다면 <code>/v1</code> 뒤에 자신이 승인한 SmartThings API 경로를 사용하세요.",
    )
    expect(page).toContain(`<code>GET /v1/devices
Authorization: Bearer &lt;Growful 토큰&gt;</code>`)
    expect(page).toContain(
      "실제 토큰은 위 자리표시자 대신 Authorization 헤더에만 넣으세요. URL, 쿼리, 요청 본문 또는 공유 문서에는 넣지 마세요.",
    )
    expect(page.split(token)).toHaveLength(2)
    expect(page).not.toContain(`Authorization: Bearer ${token}`)
    expect(page).toContain("토큰 저장 후 서비스 안내")
    expect(page).toContain("토큰 저장 후 지원")
    expect(page).not.toMatch(/<header[\s\S]*target="_blank"/u)
    expect(page).toContain('<script src="/token-safety.js" defer></script>')
  })
})
