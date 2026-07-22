import { describe, expect, it } from "vitest"
import {
  createPortalBrowserFixture,
  getPortalElement,
  response,
  runPortalClient,
} from "./fixtures/portal-browser.js"

describe("Growful portal connection rendering", () => {
  it("renders a blocked connection with a pseudonymous support reference", async () => {
    // Given
    const token = `grw_st_${"C".repeat(43)}`
    const supportReference = "d".repeat(64)
    const fixture = createPortalBrowserFixture()
    const { elements } = fixture
    const blockedAt = getPortalElement(elements, "blockedAt")
    const blockedNotice = getPortalElement(elements, "blockedNotice")
    const blockReason = getPortalElement(elements, "blockReason")
    const form = getPortalElement(elements, "form")
    const input = getPortalElement(elements, "input")
    const statusActive = getPortalElement(elements, "statusActive")
    const statusBlocked = getPortalElement(elements, "statusBlocked")
    const supportOutput = getPortalElement(elements, "supportReference")
    const fetch = async () =>
      response(200, {
        connected: true,
        expiresAt: "2026-07-23T00:00:00.000Z",
        grantedScopes: ["r:devices:*"],
        lastRefreshedAt: null,
        serviceAccess: {
          blockedAt: "2026-07-22T01:02:03.000Z",
          reason: "security_incident",
          status: "blocked",
        },
        supportReference,
      })
    runPortalClient(fixture, fetch)
    input.value = token

    // When
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Then
    expect(statusActive.hidden).toBe(true)
    expect(statusBlocked.hidden).toBe(false)
    expect(blockedNotice.hidden).toBe(false)
    expect(blockReason.textContent).toContain("보안 위험")
    expect(blockedAt.attributes.get("datetime")).toBe("2026-07-22T01:02:03.000Z")
    expect(supportOutput.textContent).toBe(supportReference)
  })

  it("rejects an unknown blocked reason before rendering", async () => {
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const error = getPortalElement(fixture.elements, "error")
    const status = getPortalElement(fixture.elements, "status")
    runPortalClient(fixture, async () =>
      response(200, {
        connected: true,
        expiresAt: "2026-07-23T00:00:00.000Z",
        grantedScopes: [],
        lastRefreshedAt: null,
        serviceAccess: {
          blockedAt: "2026-07-22T01:02:03.000Z",
          reason: "unknown_reason",
          status: "blocked",
        },
        supportReference: "e".repeat(64),
      }),
    )
    input.value = `grw_st_${"E".repeat(43)}`

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(status.hidden).toBe(true)
    expect(error.hidden).toBe(false)
  })
})
