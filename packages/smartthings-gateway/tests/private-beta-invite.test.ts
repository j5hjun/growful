import { describe, expect, it } from "vitest"
import {
  generatePrivateBetaInviteCredential,
  hashPrivateBetaCredentialSecret,
  matchesPrivateBetaInvite,
  type PrivateBetaInvite,
} from "../src/private-beta/invite.js"

const invites = [
  {
    passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
    username: "private-user",
  },
  {
    passwordHash: "5b7865cd940ba26f00ee2d535bf8d96aba6308d98c1e290e2d095986e5967f55",
    username: "second-user",
  },
] satisfies readonly PrivateBetaInvite[]

function basicAuthorization(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

describe("matchesPrivateBetaInvite", () => {
  it("generates a unique 256-bit private beta credential with its storage hash", () => {
    // Given
    const expectedByteLength = 32

    // When
    const first = generatePrivateBetaInviteCredential()
    const second = generatePrivateBetaInviteCredential()

    // Then
    expect(Buffer.from(first.secret, "base64url")).toHaveLength(expectedByteLength)
    expect(first.secret).not.toBe(second.secret)
    expect(first.passwordHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("uses the documented SHA-256 storage digest for a capability secret", () => {
    // Given
    const capabilitySecret = "s4A9c-7mL2pQ8vN5xR1zT6uY3wK0jH4fD9bC2gE7"

    // When
    const digest = hashPrivateBetaCredentialSecret(capabilitySecret)

    // Then
    expect(digest).toBe("1c5a43136451b5a916331f57fa18add340ed534a26adb4f9f466c98781239899")
  })

  it("accepts each active invitation independently", () => {
    // Given
    const firstAuthorization = basicAuthorization("private-user", "private-password")
    const secondAuthorization = basicAuthorization("second-user", "second-password")

    // When
    const firstMatches = matchesPrivateBetaInvite(firstAuthorization, invites)
    const secondMatches = matchesPrivateBetaInvite(secondAuthorization, invites)

    // Then
    expect(firstMatches).toBe(true)
    expect(secondMatches).toBe(true)
  })

  it("rejects a wrong password without accepting another invite", () => {
    // Given
    const authorization = basicAuthorization("private-user", "second-password")

    // When
    const matches = matchesPrivateBetaInvite(authorization, invites)

    // Then
    expect(matches).toBe(false)
  })

  it("rejects an invitation removed from the active list", () => {
    // Given
    const authorization = basicAuthorization("private-user", "private-password")
    const activeInvites = invites.filter((invite) => invite.username !== "private-user")

    // When
    const matches = matchesPrivateBetaInvite(authorization, activeInvites)

    // Then
    expect(matches).toBe(false)
  })

  it("rejects missing or malformed Basic authorization", () => {
    // Given
    const malformedAuthorization = "Basic not:base64"

    // When
    const missingMatches = matchesPrivateBetaInvite(undefined, invites)
    const malformedMatches = matchesPrivateBetaInvite(malformedAuthorization, invites)

    // Then
    expect(missingMatches).toBe(false)
    expect(malformedMatches).toBe(false)
  })
})
