import { describe, expect, it } from "vitest"
import {
  decodeEncryptionKey,
  decryptSecret,
  encryptSecret,
} from "../src/security/token-encryption.js"

describe("token encryption", () => {
  it("round-trips a token without embedding the plaintext", () => {
    // Given
    const key = decodeEncryptionKey(Buffer.alloc(32, 7).toString("base64"))

    // When
    const encrypted = encryptSecret("sensitive-access-token", key)

    // Then
    expect(encrypted).not.toContain("sensitive-access-token")
    expect(decryptSecret(encrypted, key)).toBe("sensitive-access-token")
  })

  it("uses a fresh nonce for each encryption", () => {
    // Given
    const key = decodeEncryptionKey(Buffer.alloc(32, 7).toString("base64"))

    // When
    const first = encryptSecret("same-token", key)
    const second = encryptSecret("same-token", key)

    // Then
    expect(first).not.toBe(second)
  })
})
