import { describe, expect, it } from "vitest"
import { createPortalContracts } from "../src/http/portal-client-contracts.js"
import { smartThingsScopes } from "../src/oauth/smartthings-scope.js"
import {
  createPortalBrowserFixture,
  getPortalElement,
  response,
  runPortalClient,
} from "./fixtures/portal-browser.js"

describe("Growful portal connection rendering", () => {
  it("renders every known permission in Korean with its source scope and a safe fallback", async () => {
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const scopeList = getPortalElement(fixture.elements, "scopes")
    const unknownScope = "r:future-resources:*"
    runPortalClient(fixture, async () =>
      response(200, {
        authorizationHealth: { status: "active" },
        connected: true,
        expiresAt: "2026-07-23T00:00:00.000Z",
        grantedScopes: [...smartThingsScopes, unknownScope],
        lastRefreshedAt: null,
        serviceAccess: { status: "active" },
        supportReference: "a".repeat(64),
      }),
    )
    input.value = `grw_st_${"A".repeat(43)}`

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    const permissions = scopeList.children.map((item) => ({
      code: item.children[1]?.textContent,
      codeLabel: item.children[1]?.attributes.get("aria-label"),
      kind: item.attributes.get("data-scope-kind"),
      label: item.children[0]?.textContent,
    }))
    expect(permissions).toEqual([
      {
        code: "r:devices:$",
        codeLabel: "원문 권한 코드: r:devices:$",
        kind: "known",
        label: "SmartThings에서 선택한 디바이스 정보와 상태 읽기",
      },
      {
        code: "r:devices:*",
        codeLabel: "원문 권한 코드: r:devices:*",
        kind: "known",
        label: "연결된 모든 디바이스 정보와 상태 읽기",
      },
      {
        code: "x:devices:$",
        codeLabel: "원문 권한 코드: x:devices:$",
        kind: "known",
        label: "SmartThings에서 선택한 디바이스 명령 실행",
      },
      {
        code: "x:devices:*",
        codeLabel: "원문 권한 코드: x:devices:*",
        kind: "known",
        label: "연결된 모든 디바이스 명령 실행",
      },
      {
        code: "w:devices:$",
        codeLabel: "원문 권한 코드: w:devices:$",
        kind: "known",
        label: "SmartThings에서 선택한 디바이스 이름 변경·삭제",
      },
      {
        code: "w:devices:*",
        codeLabel: "원문 권한 코드: w:devices:*",
        kind: "known",
        label: "연결된 모든 디바이스 이름 변경·삭제",
      },
      {
        code: "r:hubs:*",
        codeLabel: "원문 권한 코드: r:hubs:*",
        kind: "known",
        label: "연결에 허용된 허브 정보 읽기",
      },
      {
        code: "r:locations:*",
        codeLabel: "원문 권한 코드: r:locations:*",
        kind: "known",
        label: "연결에 허용된 모든 위치 정보 읽기",
      },
      {
        code: "w:locations:*",
        codeLabel: "원문 권한 코드: w:locations:*",
        kind: "known",
        label: "SmartThings 위치 만들기·정보 변경·삭제",
      },
      {
        code: "x:locations:*",
        codeLabel: "원문 권한 코드: x:locations:*",
        kind: "known",
        label: "연결에 허용된 위치 모드 변경 실행",
      },
      {
        code: "r:scenes:*",
        codeLabel: "원문 권한 코드: r:scenes:*",
        kind: "known",
        label: "연결에 허용된 장면 정보 읽기",
      },
      {
        code: "x:scenes:*",
        codeLabel: "원문 권한 코드: x:scenes:*",
        kind: "known",
        label: "연결에 허용된 장면 실행",
      },
      {
        code: "r:rules:*",
        codeLabel: "원문 권한 코드: r:rules:*",
        kind: "known",
        label: "연결에 허용된 규칙 읽기",
      },
      {
        code: "w:rules:*",
        codeLabel: "원문 권한 코드: w:rules:*",
        kind: "known",
        label: "연결에 허용된 규칙 만들기·수정·삭제",
      },
      {
        code: unknownScope,
        codeLabel: `원문 권한 코드: ${unknownScope}`,
        kind: "unknown",
        label: "알 수 없는 SmartThings 권한",
      },
    ])
  })

  it("accepts future OAuth scope tokens while rejecting malformed scope contract values", () => {
    const contracts = createPortalContracts()
    const connection = {
      authorizationHealth: { status: "active" },
      connected: true,
      expiresAt: "2026-07-23T00:00:00.000Z",
      grantedScopes: ["r:future-resources:*"],
      lastRefreshedAt: null,
      serviceAccess: { status: "active" },
      supportReference: "a".repeat(64),
    }

    expect(contracts.isConnectionStatus(connection)).toBe(true)
    expect(contracts.isConnectionStatus({ ...connection, grantedScopes: [] })).toBe(false)
    expect(
      contracts.isConnectionStatus({
        ...connection,
        grantedScopes: ["r:devices:*", "r:devices:*"],
      }),
    ).toBe(false)
    for (const malformedScope of ["", "scope with spaces", 'r:devices:"', "x".repeat(513)]) {
      expect(contracts.isConnectionStatus({ ...connection, grantedScopes: [malformedScope] })).toBe(
        false,
      )
    }
  })

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
        grantedScopes: ["r:devices:*"],
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
        grantedScopes: ["r:devices:*"],
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
        grantedScopes: ["r:devices:*"],
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
        grantedScopes: ["r:devices:*"],
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
