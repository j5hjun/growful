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
    expect(page).toContain('class="primary" type="button" data-copy-token')
    expect(page).toContain('aria-controls="issued-growful-token"')
    expect(page).toContain('id="issued-growful-token" data-token-value tabindex="-1"')
    expect(page).toContain('data-token-copy-feedback role="status" aria-live="polite"')
    expect(page).toContain('data-token-copy-error role="alert"')
    expect(page).toContain('class="secondary" href="/manage"')
    expect(page).toContain("이 페이지를 떠나면 토큰을 다시 볼 수 없습니다.")
    expect(page).toContain("분실하면 OAuth를 다시 완료해야 합니다.")
    expect(page).not.toContain("beforeunload")
    expect(page).toContain('<script src="/token-safety.js" defer></script>')
  })
})
