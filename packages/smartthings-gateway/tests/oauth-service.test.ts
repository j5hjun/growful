import { describe, expect, it } from "vitest"
import { InstalledAppIdSchema, OAuthStateHashSchema } from "../src/oauth/contracts.js"
import {
  InvalidOAuthStateError,
  OAuthConnectionRequiredError,
  OAuthScopeMismatchError,
  OAuthService,
} from "../src/oauth/oauth-service.js"
import { ConfiguredPrivateBetaInviteAccess } from "../src/private-beta/invite-access.js"
import { hashGrowfulToken } from "../src/security/growful-token.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"
import { oauthAuthorization } from "./fixtures/oauth-access.js"
import {
  createOAuthServiceFixture as createFixture,
  oauthServiceNow as now,
  storedTokens,
  testGrowfulToken,
} from "./fixtures/oauth-service-fixture.js"

describe("OAuthService", () => {
  it("stores requested scopes with a one-time OAuth state", async () => {
    // Given
    const fixture = createFixture()

    // When
    const authorizationUrl = await fixture.service.startAuthorization(
      oauthAuthorization(["r:devices:$", "x:devices:$"]),
    )

    // Then
    expect(authorizationUrl.searchParams.get("scope")).toBe("r:devices:$ x:devices:$")
    expect(fixture.store.states.size).toBe(1)
  })

  it("purges only OAuth states that have reached their retention deadline", async () => {
    // Given
    const fixture = createFixture()
    const expiredState = OAuthStateHashSchema.parse("a".repeat(64))
    const activeState = OAuthStateHashSchema.parse("b".repeat(64))
    fixture.store.states.set(expiredState, {
      consentedAt: now,
      expiresAt: new Date(now.getTime() - 1),
      policyVersion: "test-policy",
      privateBetaInviteGeneration: null,
      privateBetaUsername: null,
      requestedScopes: ["r:devices:$"],
    })
    fixture.store.states.set(activeState, {
      consentedAt: now,
      expiresAt: new Date(now.getTime() + 1),
      policyVersion: "test-policy",
      privateBetaInviteGeneration: null,
      privateBetaUsername: null,
      requestedScopes: ["r:devices:$"],
    })

    // When
    const purgedCount = await fixture.service.purgeExpiredAuthorizationStates()

    // Then
    expect(purgedCount).toBe(1)
    expect([...fixture.store.states.keys()]).toEqual([activeState])
  })

  it("issues one Growful token for an authorized SmartThings connection", async () => {
    // Given
    const fixture = createFixture()
    const authorizationUrl = await fixture.service.startAuthorization(
      oauthAuthorization(["r:devices:*"]),
    )
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

  it("revokes a private beta connection after its invitation is removed", async () => {
    // Given
    const client = new FakeSmartThingsClient()
    client.exchangeGrant = { ...client.exchangeGrant, scopes: ["r:devices:*"] }
    const store = new MemoryOAuthStore()
    const createPrivateService = (privateBetaUsernames: readonly string[]) =>
      new OAuthService({
        accessPolicy: {
          policyVersion: "test-policy",
          privateBetaAccess: new ConfiguredPrivateBetaInviteAccess(
            privateBetaUsernames.map((username) => ({ passwordHash: "0".repeat(64), username })),
          ),
        },
        client,
        growfulTokenGenerator: () => testGrowfulToken(1),
        now: () => now,
        refreshBeforeExpiryMs: 60 * 60 * 1_000,
        refreshLeaseMs: 60_000,
        stateGenerator: () => "private-beta-revocation-state",
        store,
      })
    const activeService = createPrivateService(["private-user"])
    const authorizationUrl = await activeService.startAuthorization(
      oauthAuthorization(["r:devices:*"], "private-user"),
    )
    await activeService.completeAuthorization(
      "authorization-code",
      authorizationUrl.searchParams.get("state") ?? "",
    )
    const restartedService = createPrivateService(["second-user"])

    // When
    const revokedCount = await restartedService.revokeUnauthorizedConnections()

    // Then
    expect(revokedCount).toBe(1)
    await expect(restartedService.authenticate(testGrowfulToken(1))).resolves.toBeNull()
    await expect(store.getTokens(client.exchangeGrant.installedAppId)).resolves.toBeNull()
  })

  it("rejects an unfinished authorization after its invitation is removed", async () => {
    // Given
    const client = new FakeSmartThingsClient()
    client.exchangeGrant = { ...client.exchangeGrant, scopes: ["r:devices:*"] }
    const store = new MemoryOAuthStore()
    const createPrivateService = (privateBetaUsernames: readonly string[]) =>
      new OAuthService({
        accessPolicy: {
          policyVersion: "test-policy",
          privateBetaAccess: new ConfiguredPrivateBetaInviteAccess(
            privateBetaUsernames.map((username) => ({ passwordHash: "0".repeat(64), username })),
          ),
        },
        client,
        now: () => now,
        refreshBeforeExpiryMs: 60 * 60 * 1_000,
        refreshLeaseMs: 60_000,
        stateGenerator: () => "removed-invite-pending-state",
        store,
      })
    const authorizationUrl = await createPrivateService(["private-user"]).startAuthorization(
      oauthAuthorization(["r:devices:*"], "private-user"),
    )

    // When
    const completion = createPrivateService(["second-user"]).completeAuthorization(
      "authorization-code",
      authorizationUrl.searchParams.get("state") ?? "",
    )

    // Then
    await expect(completion).rejects.toBeInstanceOf(InvalidOAuthStateError)
    expect(client.exchangedCodes).toEqual([])
    await expect(store.getTokens(client.exchangeGrant.installedAppId)).resolves.toBeNull()
  })

  it("reauthorizes the same connection and invalidates its previous Growful token", async () => {
    // Given
    const fixture = createFixture()
    fixture.client.exchangeGrant = { ...fixture.client.exchangeGrant, scopes: ["r:devices:*"] }
    const firstUrl = await fixture.service.startAuthorization(oauthAuthorization(["r:devices:*"]))
    await fixture.service.completeAuthorization(
      "first-code",
      firstUrl.searchParams.get("state") ?? "",
    )
    const secondUrl = await fixture.service.startAuthorization(oauthAuthorization(["r:devices:*"]))

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
    const authorizationUrl = await fixture.service.startAuthorization(
      oauthAuthorization(["r:devices:$"]),
    )

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
