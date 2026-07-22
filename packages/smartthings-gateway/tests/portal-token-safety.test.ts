import { describe, expect, it } from "vitest"
import { renderPortalManagement } from "../src/http/portal-manage.js"

const access = {
  mode: "public" as const,
  operatorName: "Growful QA",
  policyVersion: "qa-policy",
  privacyPolicyUrl: new URL("https://growful.click/privacy"),
  supportEmail: "support@growful.click",
  termsUrl: new URL("https://growful.click/terms"),
}

describe("portal token safety actions", () => {
  it("requires explicit confirmation before invalidating the current token", () => {
    const page = renderPortalManagement(access)

    expect(page).toContain("data-rotate-token-dialog")
    expect(page).toContain("교체하면 현재 토큰은 즉시 무효화됩니다.")
    expect(page).toContain("모든 소비자 설정을 새 토큰으로 변경해야 합니다.")
    expect(page).toContain("data-rotate-token-confirm>토큰 교체</button>")
  })

  it("makes copying primary and returning to status secondary", () => {
    const page = renderPortalManagement(access)
    const copyAction = page.indexOf('class="primary" type="button" data-copy-token')
    const returnAction = page.indexOf('class="secondary" type="button" data-return-status')

    expect(page).toContain("data-token-safety")
    expect(page).toContain('data-token-copy-feedback role="status" aria-live="polite"')
    expect(page).toContain('data-token-copy-error role="alert"')
    expect(copyAction).toBeGreaterThan(-1)
    expect(returnAction).toBeGreaterThan(copyAction)
  })
})
