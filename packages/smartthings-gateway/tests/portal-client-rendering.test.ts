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
        authorizationHealth: { status: "active" },
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
        authorizationHealth: { status: "active" },
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

  it.each([
    ["missing", {}],
    ["null", { authorizationHealth: null }],
    ["an unknown status", { authorizationHealth: { status: "degraded" } }],
    ["a scalar", { authorizationHealth: "active" }],
  ])("fails closed when authorization health is %s", async (_case, authorizationFields) => {
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const error = getPortalElement(fixture.elements, "error")
    const status = getPortalElement(fixture.elements, "status")
    runPortalClient(fixture, async () =>
      response(200, {
        ...authorizationFields,
        connected: true,
        expiresAt: "2026-07-23T00:00:00.000Z",
        grantedScopes: [],
        lastRefreshedAt: null,
        serviceAccess: { status: "active" },
        supportReference: "e".repeat(64),
      }),
    )
    input.value = `grw_st_${"E".repeat(43)}`

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(status.hidden).toBe(true)
    expect(error.hidden).toBe(false)
  })

  it("renders reauthorization ahead of active while keeping disconnect and hiding rotation", async () => {
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const statusActive = getPortalElement(fixture.elements, "statusActive")
    const statusReauthorization = getPortalElement(fixture.elements, "statusReauthorization")
    const reauthorizationNotice = getPortalElement(fixture.elements, "reauthorizationNotice")
    const rotate = getPortalElement(fixture.elements, "rotate")
    const disconnect = getPortalElement(fixture.elements, "disconnect")
    runPortalClient(fixture, async () =>
      response(200, {
        authorizationHealth: { status: "reauthorization_required" },
        connected: true,
        expiresAt: "2026-07-23T00:00:00.000Z",
        grantedScopes: [],
        lastRefreshedAt: null,
        serviceAccess: { status: "active" },
        supportReference: "f".repeat(64),
      }),
    )
    input.value = `grw_st_${"F".repeat(43)}`

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(statusActive.hidden).toBe(true)
    expect(statusReauthorization.hidden).toBe(false)
    expect(reauthorizationNotice.hidden).toBe(false)
    expect(rotate.hidden).toBe(true)
    expect(disconnect.hidden).toBe(false)
  })

  it("gives an operator block precedence over simultaneous reauthorization health", async () => {
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const blockedNotice = getPortalElement(fixture.elements, "blockedNotice")
    const reauthorizationNotice = getPortalElement(fixture.elements, "reauthorizationNotice")
    const statusBlocked = getPortalElement(fixture.elements, "statusBlocked")
    const statusReauthorization = getPortalElement(fixture.elements, "statusReauthorization")
    const rotate = getPortalElement(fixture.elements, "rotate")
    runPortalClient(fixture, async () =>
      response(200, {
        authorizationHealth: { status: "reauthorization_required" },
        connected: true,
        expiresAt: "2026-07-23T00:00:00.000Z",
        grantedScopes: [],
        lastRefreshedAt: null,
        serviceAccess: {
          blockedAt: "2026-07-22T01:02:03.000Z",
          reason: "quota_abuse",
          status: "blocked",
        },
        supportReference: "a".repeat(64),
      }),
    )
    input.value = `grw_st_${"A".repeat(43)}`

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(statusBlocked.hidden).toBe(false)
    expect(blockedNotice.hidden).toBe(false)
    expect(statusReauthorization.hidden).toBe(true)
    expect(reauthorizationNotice.hidden).toBe(true)
    expect(rotate.hidden).toBe(false)
  })
})
