import { describe, expect, it } from "vitest"
import { hashGrowfulToken } from "../src/security/growful-token.js"
import {
  createOAuthServiceFixture,
  storedTokens,
  testGrowfulToken,
} from "./fixtures/oauth-service-fixture.js"

describe("OAuth refresh service", () => {
  it("refreshes every due connection without crossing token pairs", async () => {
    // Given
    const fixture = createOAuthServiceFixture()
    const first = storedTokens(1)
    const second = storedTokens(2)
    fixture.store.seedTokens(first, hashGrowfulToken(testGrowfulToken(1)))
    fixture.store.seedTokens(second, hashGrowfulToken(testGrowfulToken(2)))
    fixture.client.refreshGrants.set(first.refreshToken, {
      accessToken: "rotated-access-1",
      expiresInSeconds: 86_400,
      installedAppId: first.installedAppId,
      refreshToken: "rotated-refresh-1",
      scopes: first.scopes,
      tokenType: "bearer",
    })
    fixture.client.refreshGrants.set(second.refreshToken, {
      accessToken: "rotated-access-2",
      expiresInSeconds: 86_400,
      installedAppId: second.installedAppId,
      refreshToken: "rotated-refresh-2",
      scopes: second.scopes,
      tokenType: "bearer",
    })

    // When
    const result = await fixture.service.refreshDueConnections()

    // Then
    expect(result).toEqual({ failureNames: [], refreshedCount: 2 })
    expect(fixture.client.refreshedTokens).toEqual(["refresh-1", "refresh-2"])
    await expect(fixture.store.getTokens(first.installedAppId)).resolves.toMatchObject({
      accessToken: "rotated-access-1",
    })
    await expect(fixture.store.getTokens(second.installedAppId)).resolves.toMatchObject({
      accessToken: "rotated-access-2",
    })
  })

  it("forces refresh only for the connection whose access token was rejected", async () => {
    // Given
    const fixture = createOAuthServiceFixture()
    const first = storedTokens(1)
    const second = storedTokens(2)
    fixture.store.seedTokens(first, hashGrowfulToken(testGrowfulToken(1)))
    fixture.store.seedTokens(second, hashGrowfulToken(testGrowfulToken(2)))
    fixture.client.refreshGrant = {
      ...fixture.client.refreshGrant,
      installedAppId: second.installedAppId,
      scopes: second.scopes,
    }

    // When
    const refreshed = await fixture.service.refreshAccessToken(
      second.installedAppId,
      second.accessToken,
    )

    // Then
    expect(refreshed).toBe(true)
    expect(fixture.client.refreshedTokens).toEqual([second.refreshToken])
    await expect(fixture.store.getTokens(first.installedAppId)).resolves.toEqual(first)
  })
})
