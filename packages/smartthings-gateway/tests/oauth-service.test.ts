import { describe, expect, it } from "vitest"
import { OAuthService } from "../src/oauth/oauth-service.js"
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
    const authorizationUrl = await fixture.service.startAuthorization()

    // Then
    expect(authorizationUrl.searchParams.get("state")).toBe("test-state-with-sufficient-entropy")
    expect(fixture.store.states.size).toBe(1)
  })

  it("rotates both tokens when a refresh claim is acquired", async () => {
    // Given
    const fixture = createFixture()
    fixture.client.exchangeGrant = { ...fixture.client.exchangeGrant, expiresInSeconds: 30 }
    const authorizationUrl = await fixture.service.startAuthorization()
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
})
