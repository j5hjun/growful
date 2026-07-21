import { describe, expect, it } from "vitest"
import { SmartThingsScopesSchema, smartThingsScopes } from "../src/oauth/smartthings-scope.js"

describe("SmartThingsScopesSchema", () => {
  it("accepts every scope documented for API Access Apps", () => {
    // Given
    const documentedScopes = [
      "r:devices:$",
      "r:devices:*",
      "x:devices:$",
      "x:devices:*",
      "w:devices:$",
      "w:devices:*",
      "r:hubs:*",
      "r:locations:*",
      "w:locations:*",
      "x:locations:*",
      "r:scenes:*",
      "x:scenes:*",
      "r:rules:*",
      "w:rules:*",
    ] as const

    // When
    const parsed = SmartThingsScopesSchema.safeParse(documentedScopes)

    // Then
    expect(parsed.success).toBe(true)
    expect(smartThingsScopes).toEqual(documentedScopes)
    expect(new Set(smartThingsScopes).size).toBe(documentedScopes.length)
  })
})
