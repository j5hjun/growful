import { describe, expect, it } from "vitest"
import {
  oauthScopeSelectionIssueKinds,
  parseOAuthDeviceRangeSelection,
  parseOAuthScopeSelection,
  parseOAuthScopeSelectionSubmission,
  renderOAuthScopeSelection,
} from "../src/http/oauth-scope-selection.js"
import { smartThingsScopes } from "../src/oauth/smartthings-scope.js"
import { testDisclosures } from "./fixtures/oauth-access.js"

describe("parseOAuthScopeSelection", () => {
  const everyPermission = [
    {
      body: "deviceRange=selected&devicePermissions=read&devicePermissions=control&devicePermissions=write&hubPermissions=read&locationPermissions=read&locationPermissions=write&locationPermissions=execute&scenePermissions=read&scenePermissions=execute&rulePermissions=read&rulePermissions=write&policyConsent=accepted",
      expected: [
        "r:devices:$",
        "x:devices:$",
        "w:devices:$",
        "r:hubs:*",
        "r:locations:*",
        "w:locations:*",
        "x:locations:*",
        "r:scenes:*",
        "x:scenes:*",
        "r:rules:*",
        "w:rules:*",
      ],
      label: "every permission with selected devices",
    },
    {
      body: "deviceRange=all&devicePermissions=read&devicePermissions=control&devicePermissions=write&hubPermissions=read&locationPermissions=read&locationPermissions=write&locationPermissions=execute&scenePermissions=read&scenePermissions=execute&rulePermissions=read&rulePermissions=write&policyConsent=accepted",
      expected: [
        "r:devices:*",
        "x:devices:*",
        "w:devices:*",
        "r:hubs:*",
        "r:locations:*",
        "w:locations:*",
        "x:locations:*",
        "r:scenes:*",
        "x:scenes:*",
        "r:rules:*",
        "w:rules:*",
      ],
      label: "every permission with all devices",
    },
  ] as const

  it.each(everyPermission)("maps $label to the server scope allowlist", ({ body, expected }) => {
    expect(parseOAuthScopeSelection(Buffer.from(body))).toEqual(expected)
  })

  it("makes every documented scope selectable across the two device ranges", () => {
    const selectableScopes = new Set(
      everyPermission.flatMap(({ body }) => parseOAuthScopeSelection(Buffer.from(body)) ?? []),
    )

    expect(selectableScopes).toEqual(new Set(smartThingsScopes))
  })

  it.each([
    ["hub", "deviceRange=selected&hubPermissions=read&policyConsent=accepted", ["r:hubs:*"]],
    [
      "location",
      "deviceRange=selected&locationPermissions=read&locationPermissions=write&locationPermissions=execute&policyConsent=accepted",
      ["r:locations:*", "w:locations:*", "x:locations:*"],
    ],
    [
      "scene",
      "deviceRange=selected&scenePermissions=read&scenePermissions=execute&policyConsent=accepted",
      ["r:scenes:*", "x:scenes:*"],
    ],
    [
      "rule",
      "deviceRange=selected&rulePermissions=read&rulePermissions=write&policyConsent=accepted",
      ["r:rules:*", "w:rules:*"],
    ],
  ])("accepts a %s-only selection", (_label, body, expected) => {
    expect(parseOAuthScopeSelection(Buffer.from(body))).toEqual(expected)
  })

  it("returns no selection for permission values outside the server allowlist", () => {
    // Given
    const body = Buffer.from("deviceRange=all&devicePermissions=admin")

    // When
    const scopes = parseOAuthScopeSelection(body)

    // Then
    expect(scopes).toBeNull()
  })

  it("rejects submissions without any resource permission", () => {
    // Given
    const body = Buffer.from("deviceRange=all")

    // When
    const scopes = parseOAuthScopeSelection(body)

    // Then
    expect(scopes).toBeNull()
  })

  it("rejects a permission selection without policy consent", () => {
    expect(
      parseOAuthScopeSelection(Buffer.from("deviceRange=all&devicePermissions=read")),
    ).toBeNull()
  })

  it("rejects unrecognized form fields", () => {
    // Given
    const body = Buffer.from("deviceRange=all&devicePermissions=read&scope=x%3Adevices%3A%2A")

    // When
    const scopes = parseOAuthScopeSelection(body)

    // Then
    expect(scopes).toBeNull()
  })

  it.each([
    "deviceRange=all&deviceRange=selected&devicePermissions=read",
    "deviceRange=all&devicePermissions=read&devicePermissions=read",
    "deviceRange=all&hubPermissions=read&hubPermissions=read",
    "deviceRange=all&locationPermissions=read&locationPermissions=read",
    "deviceRange=all&scenePermissions=read&scenePermissions=read",
    "deviceRange=all&rulePermissions=read&rulePermissions=read",
  ])("rejects duplicate form values: %s", (body) => {
    expect(parseOAuthScopeSelection(Buffer.from(body))).toBeNull()
  })

  it("preserves only allowlisted draft values when the submission is invalid", () => {
    // Given
    const body = Buffer.from(
      "deviceRange=all&devicePermissions=read&devicePermissions=control&devicePermissions=admin&hubPermissions=read&locationPermissions=execute&scenePermissions=read&rulePermissions=write&policyConsent=accepted&unexpectedField=private-user-value",
    )

    // When
    const result = parseOAuthScopeSelectionSubmission(body)

    // Then
    expect(result).toEqual({
      draft: {
        devicePermissions: ["read", "control"],
        deviceRange: "all",
        hubPermissions: ["read"],
        locationPermissions: ["execute"],
        policyConsent: true,
        rulePermissions: ["write"],
        scenePermissions: ["read"],
      },
      issues: [oauthScopeSelectionIssueKinds.invalidSelection],
      kind: "invalid",
    })
  })

  it.each([
    {
      expectedIssues: [oauthScopeSelectionIssueKinds.missingPermission],
      payload: "deviceRange=all&policyConsent=accepted",
    },
    {
      expectedIssues: [oauthScopeSelectionIssueKinds.missingPolicyConsent],
      payload: "deviceRange=all&devicePermissions=read",
    },
  ])("classifies the server validation issue for $payload", ({ expectedIssues, payload }) => {
    // Given
    const body = Buffer.from(payload)

    // When
    const result = parseOAuthScopeSelectionSubmission(body)

    // Then
    expect(result).toMatchObject({ issues: expectedIssues, kind: "invalid" })
  })

  it("renders controls for all supported resource permissions", () => {
    const html = renderOAuthScopeSelection({ disclosures: testDisclosures })

    for (const control of [
      'name="devicePermissions" value="read"',
      'name="devicePermissions" value="control"',
      'name="devicePermissions" value="write"',
      'name="hubPermissions" value="read"',
      'name="locationPermissions" value="read"',
      'name="locationPermissions" value="write"',
      'name="locationPermissions" value="execute"',
      'name="scenePermissions" value="read"',
      'name="scenePermissions" value="execute"',
      'name="rulePermissions" value="read"',
      'name="rulePermissions" value="write"',
    ]) {
      expect(html).toContain(control)
    }
    for (const resource of ["디바이스", "허브", "위치", "장면", "규칙"]) {
      expect(html).toContain(resource)
    }
  })

  it("defaults to read-only access for selected devices", () => {
    const html = renderOAuthScopeSelection({ disclosures: testDisclosures })

    expect(html).toContain('name="deviceRange" value="selected" checked')
    expect(html).toContain('name="devicePermissions" value="read" checked')
    expect(html).toContain('name="devicePermissions" value="control"><span>')
    expect(html).toContain('name="devicePermissions" value="write"><span>')
    expect(html.match(/ checked/g)).toHaveLength(2)
  })

  it("explains which resources each permission group affects", () => {
    const html = renderOAuthScopeSelection({ disclosures: testDisclosures })

    for (const hint of [
      "위에서 고른 디바이스 범위에 적용됩니다.",
      "이 연결에 허용된 모든 허브에 적용됩니다.",
      "이 연결에 허용된 모든 위치에 적용됩니다.",
      "이 연결에 허용된 모든 장면에 적용됩니다.",
      "이 연결에 허용된 모든 규칙에 적용됩니다.",
    ]) {
      expect(html).toContain(`<p class="hint">${hint}</p>`)
    }
  })

  it("renders the permission decision path in the required order", () => {
    // Given
    const html = renderOAuthScopeSelection({ disclosures: testDisclosures })

    // When
    const stepPositions = ["range", "basic-read", "additional", "policy", "actions"].map((step) =>
      html.indexOf(`data-permission-step="${step}"`),
    )

    // Then
    expect(stepPositions.every((position) => position >= 0)).toBe(true)
    expect(stepPositions).toEqual([...stepPositions].sort((left, right) => left - right))
  })

  it("keeps additional permissions grouped in collapsed resource disclosures", () => {
    // Given
    const html = renderOAuthScopeSelection({ disclosures: testDisclosures })

    // When
    const resources = ["device", "hub", "location", "scene", "rule"] as const

    // Then
    for (const resource of resources) {
      expect(html).toContain(
        `<details class="permission-resource" data-permission-resource="${resource}">`,
      )
    }
    expect(html).not.toContain('<details class="permission-resource" open')
    expect(html.match(/data-selection-summary/g)).toHaveLength(resources.length)
    expect(html.match(/<span class="summary-state" data-risk-summary/g)).toHaveLength(
      resources.length,
    )
    expect(html.match(/<span class="summary-label">선택:<\/span>/g)).toHaveLength(resources.length)
    expect(html.match(/<span class="summary-label">영향:<\/span>/g)).toHaveLength(resources.length)
  })

  it("keeps collapsed summaries specific to the selected permissions", () => {
    const html = renderOAuthScopeSelection({ disclosures: testDisclosures })

    for (const summary of [
      'data-summary-permission="control">명령 실행</span>',
      'data-summary-permission="write">이름 변경·삭제</span>',
      'data-summary-permission="execute">위치 모드 변경</span>',
      'data-summary-permission="execute">여러 디바이스 상태 변경</span>',
      'data-summary-permission="write">자동화 동작 변경</span>',
    ]) {
      expect(html).toContain(summary)
    }
    expect(html).not.toContain('<span class="selection-selected">선택됨</span>')
  })

  it("describes the concrete impact of elevated permissions", () => {
    const html = renderOAuthScopeSelection({ disclosures: testDisclosures })

    for (const impact of [
      "전원·밝기·온도처럼 디바이스가 지원하는 명령을 즉시",
      "디바이스 이름을 바꾸거나 SmartThings에서 디바이스를",
      "위치 이름·좌표·온도 단위 같은 설정을 변경할 수 있습니다.",
      "위치 모드를 변경해 해당 모드를 조건으로 쓰는 자동화가 동작할 수 있습니다.",
      "장면을 실행해 여러 디바이스 상태를 한 번에 바꿀 수 있습니다.",
      "규칙을 만들고 수정하거나 삭제해 자동화 동작을 바꿀 수 있습니다.",
    ]) {
      expect(html).toContain(impact)
    }
    expect(html).toContain('<span class="phrase">실행할 수 있습니다.</span>')
    expect(html).toContain('<span class="phrase">삭제할 수 있습니다.</span>')
  })

  it("offers a return path to the service guide beside the final action", () => {
    const html = renderOAuthScopeSelection({ disclosures: testDisclosures })

    expect(html).toContain('href="/" data-action="cancel-oauth">서비스 안내로 돌아가기</a>')
  })

  it("preserves the full submitted draft in an accessible error summary", () => {
    const html = renderOAuthScopeSelection({
      disclosures: testDisclosures,
      draft: {
        devicePermissions: ["control", "write"],
        deviceRange: "all",
        hubPermissions: ["read"],
        locationPermissions: ["write", "execute"],
        policyConsent: true,
        rulePermissions: ["write"],
        scenePermissions: ["execute"],
      },
      issues: [oauthScopeSelectionIssueKinds.invalidSelection],
    })

    expect(html).toContain('name="deviceRange" value="selected">')
    expect(html).toContain('name="deviceRange" value="all" checked>')
    for (const selection of [
      'name="devicePermissions" value="control" checked',
      'name="devicePermissions" value="write" checked',
      'name="hubPermissions" value="read" checked',
      'name="locationPermissions" value="write" checked',
      'name="locationPermissions" value="execute" checked',
      'name="scenePermissions" value="execute" checked',
      'name="rulePermissions" value="write" checked',
      'name="policyConsent" value="accepted" required checked',
    ]) {
      expect(html).toContain(selection)
    }
    expect(html).toContain(
      'id="selection-error-summary" class="error-summary" role="alert" aria-labelledby="selection-error-title" tabindex="-1" autofocus',
    )
    expect(html).toContain('<h2 id="selection-error-title">입력 내용을 확인하세요</h2>')
  })

  it.each([
    ["deviceRange=selected", "selected"],
    ["deviceRange=all", "all"],
  ] as const)("reads a valid device range from %s", (body, expected) => {
    expect(parseOAuthDeviceRangeSelection(Buffer.from(body))).toBe(expected)
  })

  it.each(["", "deviceRange=unknown", "deviceRange=selected&deviceRange=all"])(
    "does not preserve an invalid device range from %s",
    (body) => {
      expect(parseOAuthDeviceRangeSelection(Buffer.from(body))).toBeNull()
    },
  )
})
