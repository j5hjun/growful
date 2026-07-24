import { describe, expect, it } from "vitest"
import {
  RefreshClaimIdSchema,
  SMARTTHINGS_REAUTHORIZATION_REQUIRED,
} from "../src/oauth/contracts.js"
import { hashGrowfulToken } from "../src/security/growful-token.js"
import { SmartThingsReauthorizationRequiredError } from "../src/smartthings/smartthings-client.js"
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

  it("persists explicit invalid_grant as terminal and stops due and forced refresh attempts", async () => {
    const fixture = createOAuthServiceFixture()
    const tokens = storedTokens(1)
    fixture.store.seedTokens(tokens, hashGrowfulToken(testGrowfulToken(1)))
    fixture.client.refreshError = new SmartThingsReauthorizationRequiredError(400)

    const firstResult = await fixture.service.refreshDueConnections()
    const secondResult = await fixture.service.refreshDueConnections()
    const forced = await fixture.service.refreshAccessToken(
      tokens.installedAppId,
      tokens.accessToken,
    )

    expect(firstResult).toEqual({
      failureNames: ["SmartThingsReauthorizationRequiredError"],
      refreshedCount: 0,
    })
    expect(secondResult).toEqual({ failureNames: [], refreshedCount: 0 })
    expect(forced).toBe(false)
    expect(fixture.client.refreshedTokens).toEqual([tokens.refreshToken])
    await expect(fixture.store.getTokens(tokens.installedAppId)).resolves.toMatchObject({
      lastRefreshError: SMARTTHINGS_REAUTHORIZATION_REQUIRED,
    })
  })

  it("keeps a timeout transient, reports active authorization health, and retries after the lease", async () => {
    const fixture = createOAuthServiceFixture()
    const tokens = storedTokens(1)
    const timeout = new Error("request timed out")
    timeout.name = "TimeoutError"
    fixture.store.seedTokens(tokens, hashGrowfulToken(testGrowfulToken(1)))
    fixture.client.refreshError = timeout

    const result = await fixture.service.refreshDueConnections()
    const status = await fixture.service.getConnectionStatus(tokens.installedAppId)
    const retried = await fixture.store.claimTokensForRefresh({
      claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000031"),
      kind: "due",
      leaseMs: 60_000,
      now: new Date("2026-07-19T00:01:00.000Z"),
      refreshBeforeExpiryMs: 60 * 60 * 1_000,
    })

    expect(result).toEqual({ failureNames: ["TimeoutError"], refreshedCount: 0 })
    expect(status.authorizationHealth).toEqual({ status: "active" })
    expect(retried?.installedAppId).toBe(tokens.installedAppId)
  })
})
