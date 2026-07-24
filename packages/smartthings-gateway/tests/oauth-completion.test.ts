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
    expect(page).toMatch(/<button[^>]*data-copy-token[^>]*>Growful 토큰 복사<\/button>/)
    expect(page).toMatch(/<output[^>]*data-token-value[^>]*data-growful-token[^>]*>/)
    expect(page).toContain('data-token-copy-feedback role="status" aria-live="polite"')
    expect(page).toContain('data-token-copy-error role="alert"')
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
