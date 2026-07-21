import { describe, expect, it } from "vitest"
import { SmartThingsScopesSchema } from "../src/oauth/smartthings-scope.js"

describe("SmartThingsScopesSchema", () => {
  it("accepts every scope documented for API Access Apps", () => {
    // Given
    const documentedScopes = [
      "r:devices:*",
      "r:devices:$",
      "w:devices:*",
      "w:devices:$",
      "x:devices:*",
      "x:devices:$",
      "r:hubs:*",
      "r:locations:*",
      "w:locations:*",
      "x:locations:*",
      "r:scenes:*",
      "x:scenes:*",
      "r:rules:*",
      "w:rules:*",
    ]

    // When
    const parsed = SmartThingsScopesSchema.safeParse(documentedScopes)

    // Then
    expect(parsed.success).toBe(true)
  })
})
