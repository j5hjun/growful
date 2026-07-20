import { describe, expect, it } from "vitest"
import { InstalledAppIdSchema, type StoredTokens } from "../src/oauth/contracts.js"
import {
  OAuthConnectionRequiredError,
  OAuthScopeMismatchError,
  OAuthService,
} from "../src/oauth/oauth-service.js"
import { GrowfulTokenSchema, hashGrowfulToken } from "../src/security/growful-token.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const now = new Date("2026-07-19T00:00:00.000Z")

function testGrowfulToken(index: number) {
  return GrowfulTokenSchema.parse(`grw_st_${Buffer.alloc(32, index).toString("base64url")}`)
}

function createFixture() {
  const client = new FakeSmartThingsClient()
  const store = new MemoryOAuthStore()
  let tokenIndex = 1
  const service = new OAuthService({
    client,
    growfulTokenGenerator: () => {
      const token = testGrowfulToken(tokenIndex)
      tokenIndex += 1
      return token
    },
    now: () => now,
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  return { client, service, store }
}

function storedTokens(index: number): StoredTokens {
  return {
    accessToken: `access-${index}`,
    expiresAt: new Date("2026-07-19T00:00:30.000Z"),
    installedAppId: InstalledAppIdSchema.parse(`installed-app-${index}`),
    lastRefreshedAt: null,
    refreshToken: `refresh-${index}`,
    scopes: ["r:devices:*"],
    tokenType: "bearer",
  }
}

describe("OAuthService", () => {
  it("stores requested scopes with a one-time OAuth state", async () => {
    // Given
    const fixture = createFixture()

    // When
    const authorizationUrl = await fixture.service.startAuthorization([
      "r:devices:$",
      "x:devices:$",
    ])

    // Then
    expect(authorizationUrl.searchParams.get("scope")).toBe("r:devices:$ x:devices:$")
    expect(fixture.store.states.size).toBe(1)
  })

  it("issues one Growful token for an authorized SmartThings connection", async () => {
    // Given
    const fixture = createFixture()
    const authorizationUrl = await fixture.service.startAuthorization(["r:devices:*"])
    const state = authorizationUrl.searchParams.get("state") ?? ""
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      scopes: ["r:devices:*"],
    }

    // When
    const completion = await fixture.service.completeAuthorization("authorization-code", state)

    // Then
    expect(completion.growfulToken).toBe(testGrowfulToken(1))
    await expect(fixture.service.authenticate(testGrowfulToken(1))).resolves.toBe(
      fixture.client.exchangeGrant.installedAppId,
    )
    expect(completion.connection.grantedScopes).toEqual(["r:devices:*"])
  })

  it("reauthorizes the same connection and invalidates its previous Growful token", async () => {
    // Given
    const fixture = createFixture()
    fixture.client.exchangeGrant = { ...fixture.client.exchangeGrant, scopes: ["r:devices:*"] }
    const firstUrl = await fixture.service.startAuthorization(["r:devices:*"])
    await fixture.service.completeAuthorization(
      "first-code",
      firstUrl.searchParams.get("state") ?? "",
    )
    const secondUrl = await fixture.service.startAuthorization(["r:devices:*"])

    // When
    const completion = await fixture.service.completeAuthorization(
      "second-code",
      secondUrl.searchParams.get("state") ?? "",
    )

    // Then
    expect(completion.growfulToken).toBe(testGrowfulToken(2))
    await expect(fixture.service.authenticate(testGrowfulToken(1))).resolves.toBeNull()
    await expect(fixture.service.authenticate(testGrowfulToken(2))).resolves.toBe(
      fixture.client.exchangeGrant.installedAppId,
    )
    expect(fixture.store.connections).toHaveLength(1)
  })

  it("refreshes every due connection without crossing token pairs", async () => {
    // Given
    const fixture = createFixture()
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
    const fixture = createFixture()
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

  it("preserves an existing connection when reauthorization expands scopes", async () => {
    // Given
    const fixture = createFixture()
    const existing = { ...storedTokens(1), scopes: ["r:devices:$"] }
    fixture.store.seedTokens(existing, hashGrowfulToken(testGrowfulToken(1)))
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      installedAppId: existing.installedAppId,
      scopes: ["r:devices:*"],
    }
    const authorizationUrl = await fixture.service.startAuthorization(["r:devices:$"])

    // When
    const completion = fixture.service.completeAuthorization(
      "authorization-code",
      authorizationUrl.searchParams.get("state") ?? "",
    )

    // Then
    await expect(completion).rejects.toBeInstanceOf(OAuthScopeMismatchError)
    await expect(fixture.store.getTokens(existing.installedAppId)).resolves.toEqual(existing)
    await expect(fixture.service.authenticate(testGrowfulToken(1))).resolves.toBe(
      existing.installedAppId,
    )
  })

  it("rejects status and rotation for a deleted connection", async () => {
    // Given
    const fixture = createFixture()
    const missing = InstalledAppIdSchema.parse("missing-installed-app")

    // When
    const status = fixture.service.getConnectionStatus(missing)
    const rotation = fixture.service.rotateGrowfulToken(missing)

    // Then
    await expect(status).rejects.toBeInstanceOf(OAuthConnectionRequiredError)
    await expect(rotation).rejects.toBeInstanceOf(OAuthConnectionRequiredError)
  })
})
