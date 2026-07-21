import { describe, expect, it } from "vitest"
import {
  parseOAuthDeviceRangeSelection,
  parseOAuthScopeSelection,
  renderOAuthScopeSelection,
} from "../src/http/oauth-scope-selection.js"
import { smartThingsScopes } from "../src/oauth/smartthings-scope.js"

describe("parseOAuthScopeSelection", () => {
  const everyPermission = [
    {
      body: "deviceRange=selected&devicePermissions=read&devicePermissions=control&devicePermissions=write&hubPermissions=read&locationPermissions=read&locationPermissions=write&locationPermissions=execute&scenePermissions=read&scenePermissions=execute&rulePermissions=read&rulePermissions=write",
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
      body: "deviceRange=all&devicePermissions=read&devicePermissions=control&devicePermissions=write&hubPermissions=read&locationPermissions=read&locationPermissions=write&locationPermissions=execute&scenePermissions=read&scenePermissions=execute&rulePermissions=read&rulePermissions=write",
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
    ["hub", "deviceRange=selected&hubPermissions=read", ["r:hubs:*"]],
    [
      "location",
      "deviceRange=selected&locationPermissions=read&locationPermissions=write&locationPermissions=execute",
      ["r:locations:*", "w:locations:*", "x:locations:*"],
    ],
    [
      "scene",
      "deviceRange=selected&scenePermissions=read&scenePermissions=execute",
      ["r:scenes:*", "x:scenes:*"],
    ],
    [
      "rule",
      "deviceRange=selected&rulePermissions=read&rulePermissions=write",
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

  it("renders controls for all supported resource permissions", () => {
    const html = renderOAuthScopeSelection()

    for (const field of [
      'name="devicePermissions"',
      'name="hubPermissions"',
      'name="locationPermissions"',
      'name="scenePermissions"',
      'name="rulePermissions"',
    ]) {
      expect(html).toContain(field)
    }
    for (const resource of ["디바이스", "허브", "위치", "장면", "규칙"]) {
      expect(html).toContain(resource)
    }
  })

  it("defaults to read-only access for selected devices", () => {
    const html = renderOAuthScopeSelection()

    expect(html).toContain('name="deviceRange" value="selected" checked')
    expect(html).toContain('name="devicePermissions" value="read" checked')
    expect(html).toContain('name="devicePermissions" value="control"><span>')
    expect(html).toContain('name="devicePermissions" value="write"><span>')
  })

  it("preserves the submitted all-device range on the global validation error", () => {
    const html = renderOAuthScopeSelection({ deviceRange: "all", showSelectionError: true })

    expect(html).toContain('name="deviceRange" value="selected">')
    expect(html).toContain('name="deviceRange" value="all" checked>')
    expect(html).toContain(
      'role="group" aria-label="리소스 권한" aria-invalid="true" aria-describedby="permission-error"',
    )
    expect(html).not.toContain('<fieldset aria-invalid="true">')
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
