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
    expect(page).toContain("분실하면 OAuth를 다시 완료해야 합니다.")
    expect(page).toContain('<script src="/token-safety.js" defer></script>')
  })
})
