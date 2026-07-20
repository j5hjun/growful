import { describe, expect, it } from "vitest"
import { parseOAuthScopeSelection } from "../src/http/oauth-scope-selection.js"

describe("parseOAuthScopeSelection", () => {
  it.each([
    {
      body: "deviceRange=selected&permissions=read&permissions=control&permissions=write&locationRead=on",
      expected: ["r:devices:$", "x:devices:$", "w:devices:$", "r:locations:*"],
      label: "selected devices with location access",
    },
    {
      body: "deviceRange=selected&permissions=read&permissions=control&permissions=write",
      expected: ["r:devices:$", "x:devices:$", "w:devices:$"],
      label: "selected devices without location access",
    },
    {
      body: "deviceRange=all&permissions=read&permissions=control&permissions=write&locationRead=on",
      expected: ["r:devices:*", "x:devices:*", "w:devices:*", "r:locations:*"],
      label: "all devices with location access",
    },
    {
      body: "deviceRange=all&permissions=read&permissions=control&permissions=write",
      expected: ["r:devices:*", "x:devices:*", "w:devices:*"],
      label: "all devices without location access",
    },
  ])("maps $label to the server scope allowlist", ({ body, expected }) => {
    expect(parseOAuthScopeSelection(Buffer.from(body))).toEqual(expected)
  })

  it("returns no selection for permission values outside the server allowlist", () => {
    // Given
    const body = Buffer.from("deviceRange=all&permissions=admin")

    // When
    const scopes = parseOAuthScopeSelection(body)

    // Then
    expect(scopes).toBeNull()
  })

  it("rejects submissions without a device permission", () => {
    // Given
    const body = Buffer.from("deviceRange=all&locationRead=on")

    // When
    const scopes = parseOAuthScopeSelection(body)

    // Then
    expect(scopes).toBeNull()
  })

  it("rejects unrecognized form fields", () => {
    // Given
    const body = Buffer.from("deviceRange=all&permissions=read&scope=x%3Adevices%3A%2A")

    // When
    const scopes = parseOAuthScopeSelection(body)

    // Then
    expect(scopes).toBeNull()
  })

  it.each([
    "deviceRange=all&deviceRange=selected&permissions=read",
    "deviceRange=all&permissions=read&permissions=read",
    "deviceRange=all&permissions=read&locationRead=on&locationRead=on",
  ])("rejects duplicate form values: %s", (body) => {
    expect(parseOAuthScopeSelection(Buffer.from(body))).toBeNull()
  })
})
