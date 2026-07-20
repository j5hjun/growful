import { describe, expect, it } from "vitest"
import {
  OAuthConnectionRequiredError,
  OAuthScopeMismatchError,
  OAuthService,
} from "../src/oauth/oauth-service.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const now = new Date("2026-07-19T00:00:00.000Z")

function createFixture() {
  const client = new FakeSmartThingsClient()
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    client,
    now: () => now,
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  return { client, service, store }
}

describe("OAuthService", () => {
  it("stores a one-time state when authorization starts", async () => {
    // Given
    const fixture = createFixture()

    // When
    const authorizationUrl = await fixture.service.startAuthorization([
      "r:devices:$",
      "x:devices:$",
    ])

    // Then
    expect(authorizationUrl.searchParams.get("state")).toBe("test-state-with-sufficient-entropy")
    expect(authorizationUrl.searchParams.get("scope")).toBe("r:devices:$ x:devices:$")
    expect(fixture.store.states.size).toBe(1)
  })

  it("rotates both tokens when a refresh claim is acquired", async () => {
    // Given
    const fixture = createFixture()
    fixture.client.exchangeGrant = { ...fixture.client.exchangeGrant, expiresInSeconds: 30 }
    const authorizationUrl = await fixture.service.startAuthorization([
      "r:locations:*",
      "r:devices:*",
    ])
    const state = authorizationUrl.searchParams.get("state") ?? ""
    await fixture.service.completeAuthorization("authorization-code", state)

    // When
    const refreshed = await fixture.service.refreshIfDue()

    // Then
    expect(refreshed).toBe(true)
    expect(fixture.client.refreshedTokens).toEqual(["initial-refresh-token"])
    expect(await fixture.store.getTokens()).toMatchObject({
      accessToken: "rotated-access-token",
      lastRefreshedAt: now,
      refreshToken: "rotated-refresh-token",
    })
  })

  it("returns the stored access token without exposing the refresh token", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens({
      accessToken: "gateway-access-token",
      expiresAt: new Date("2026-07-20T00:00:00.000Z"),
      installedAppId: fixture.client.exchangeGrant.installedAppId,
      lastRefreshedAt: null,
      refreshToken: "gateway-refresh-token",
      scopes: ["r:devices:*"],
      tokenType: "bearer",
    })
    // When
    const accessToken = await fixture.service.getAccessToken()

    // Then
    expect(accessToken).toBe("gateway-access-token")
  })

  it("rejects gateway requests when OAuth is disconnected", async () => {
    // Given
    const fixture = createFixture()

    // When
    const accessToken = fixture.service.getAccessToken()

    // Then
    await expect(accessToken).rejects.toBeInstanceOf(OAuthConnectionRequiredError)
  })

  it("forces one token rotation after SmartThings rejects an access token", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens({
      accessToken: "rejected-access-token",
      expiresAt: new Date("2026-07-20T00:00:00.000Z"),
      installedAppId: fixture.client.exchangeGrant.installedAppId,
      lastRefreshedAt: null,
      refreshToken: "refresh-after-401",
      scopes: ["r:devices:*"],
      tokenType: "bearer",
    })
    fixture.client.refreshGrant = {
      ...fixture.client.refreshGrant,
      scopes: ["r:devices:*"],
    }

    // When
    const refreshed = await fixture.service.refreshAccessToken("rejected-access-token")

    // Then
    expect(refreshed).toBe(true)
    expect(fixture.client.refreshedTokens).toEqual(["refresh-after-401"])
  })

  it("preserves the existing connection when reauthorization grants an unrequested scope", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens({
      accessToken: "existing-access-token",
      expiresAt: new Date("2026-07-20T00:00:00.000Z"),
      installedAppId: fixture.client.exchangeGrant.installedAppId,
      lastRefreshedAt: null,
      refreshToken: "existing-refresh-token",
      scopes: ["r:devices:$"],
      tokenType: "bearer",
    })
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      scopes: ["r:devices:*"],
    }
    const authorizationUrl = await fixture.service.startAuthorization(["r:devices:$"])
    const state = authorizationUrl.searchParams.get("state") ?? ""

    // When
    const completion = fixture.service.completeAuthorization("authorization-code", state)

    // Then
    await expect(completion).rejects.toBeInstanceOf(OAuthScopeMismatchError)
    await expect(fixture.store.getTokens()).resolves.toMatchObject({
      accessToken: "existing-access-token",
      refreshToken: "existing-refresh-token",
      scopes: ["r:devices:$"],
    })
  })

  it("accepts and stores a partial grant within the requested scope boundary", async () => {
    // Given
    const fixture = createFixture()
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      scopes: ["r:devices:$"],
    }
    const authorizationUrl = await fixture.service.startAuthorization([
      "r:devices:$",
      "x:devices:$",
    ])
    const state = authorizationUrl.searchParams.get("state") ?? ""

    // When
    const connection = await fixture.service.completeAuthorization("authorization-code", state)

    // Then
    expect(connection).toMatchObject({
      connected: true,
      grantedScopes: ["r:devices:$"],
    })
    await expect(fixture.store.getTokens()).resolves.toMatchObject({
      scopes: ["r:devices:$"],
    })
  })

  it("accepts a selected-device grant within an all-device request boundary", async () => {
    // Given
    const fixture = createFixture()
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      scopes: ["r:devices:$"],
    }
    const authorizationUrl = await fixture.service.startAuthorization(["r:devices:*"])
    const state = authorizationUrl.searchParams.get("state") ?? ""

    // When
    const connection = await fixture.service.completeAuthorization("authorization-code", state)

    // Then
    expect(connection).toMatchObject({
      connected: true,
      grantedScopes: ["r:devices:$"],
    })
  })

  it("preserves current tokens when refresh attempts to expand granted scopes", async () => {
    // Given
    const fixture = createFixture()
    fixture.store.seedTokens({
      accessToken: "current-access-token",
      expiresAt: new Date("2026-07-19T00:00:30.000Z"),
      installedAppId: fixture.client.exchangeGrant.installedAppId,
      lastRefreshedAt: null,
      refreshToken: "current-refresh-token",
      scopes: ["r:devices:$"],
      tokenType: "bearer",
    })
    fixture.client.refreshGrant = {
      ...fixture.client.refreshGrant,
      scopes: ["r:devices:*"],
    }

    // When
    const refresh = fixture.service.refreshIfDue()

    // Then
    await expect(refresh).rejects.toBeInstanceOf(OAuthScopeMismatchError)
    await expect(fixture.store.getTokens()).resolves.toMatchObject({
      accessToken: "current-access-token",
      refreshToken: "current-refresh-token",
      scopes: ["r:devices:$"],
    })
    expect(fixture.store.failures).toHaveLength(1)
  })

  it("refreshes a legacy granted scope without expanding it", async () => {
    const fixture = createFixture()
    fixture.store.seedTokens({
      accessToken: "legacy-access-token",
      expiresAt: new Date("2026-07-19T00:00:30.000Z"),
      installedAppId: fixture.client.exchangeGrant.installedAppId,
      lastRefreshedAt: null,
      refreshToken: "legacy-refresh-token",
      scopes: ["r:scenes:*"],
      tokenType: "bearer",
    })
    fixture.client.refreshGrant = {
      ...fixture.client.refreshGrant,
      scopes: ["r:scenes:*"],
    }

    const refreshed = await fixture.service.refreshIfDue()

    expect(refreshed).toBe(true)
    await expect(fixture.store.getTokens()).resolves.toMatchObject({ scopes: ["r:scenes:*"] })
  })
})
