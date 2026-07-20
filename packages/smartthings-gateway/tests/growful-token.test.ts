import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  GrowfulTokenHashSchema,
  GrowfulTokenSchema,
  generateGrowfulToken,
  hashGrowfulToken,
} from "../src/security/growful-token.js"

describe("Growful token", () => {
  it("generates a namespaced token from 256 bits of entropy", () => {
    // Given
    const entropy = Buffer.alloc(32, 7)

    // When
    const token = generateGrowfulToken(() => entropy)

    // Then
    expect(token).toBe(GrowfulTokenSchema.parse(`grw_st_${entropy.toString("base64url")}`))
  })

  it("stores a fixed-length hash instead of the bearer token", () => {
    // Given
    const token = GrowfulTokenSchema.parse(`grw_st_${Buffer.alloc(32, 9).toString("base64url")}`)

    // When
    const hash = hashGrowfulToken(token)

    // Then
    expect(hash).toBe(
      GrowfulTokenHashSchema.parse(createHash("sha256").update(token, "utf8").digest("hex")),
    )
    expect(hash).not.toContain(token)
  })
})
