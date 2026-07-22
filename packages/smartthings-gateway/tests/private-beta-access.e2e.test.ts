import { afterEach, describe, expect, it } from "vitest"
import { type AppOptions, createApp } from "../src/http/app.js"
import { InstalledAppIdSchema, type StoredTokens } from "../src/oauth/contracts.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { ConfiguredPrivateBetaInviteAccess } from "../src/private-beta/invite-access.js"
import { emptyServiceStatusSource } from "../src/status/service-status.js"
import { allowAllGrowfulAbuseControl } from "./fixtures/abuse-control.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore, memoryStoreGrowfulToken } from "./fixtures/memory-oauth-store.js"
import { privateBetaOAuthAccess, testDisclosures } from "./fixtures/oauth-access.js"
import { readyProbe } from "./fixtures/readiness.js"

const apps: ReturnType<typeof createApp>[] = []
const authorizationOrigin = "https://api.smartthings.test"
const redirectOrigin = "https://smartthings.growful.click"

class CountingConfiguredPrivateBetaInviteAccess extends ConfiguredPrivateBetaInviteAccess {
  authenticateCalls = 0

  override async authenticate(authorization: string | undefined) {
    this.authenticateCalls += 1
    return super.authenticate(authorization)
  }
}

function storedTokens(): StoredTokens {
  return {
    accessToken: "access-token",
    expiresAt: new Date("2026-07-20T00:00:00.000Z"),
    installedAppId: InstalledAppIdSchema.parse("removed-user-installed-app"),
    lastRefreshedAt: null,
    refreshToken: "refresh-token",
    scopes: ["r:devices:$"],
    tokenType: "bearer",
  }
}

function createFixture(oauthAccess: AppOptions["oauthAccess"]) {
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    accessPolicy: {
      policyVersion: oauthAccess.policyVersion,
      privateBetaAccess: oauthAccess.mode === "private_beta" ? oauthAccess.inviteAccess : null,
    },
    client: new FakeSmartThingsClient(),
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  const app = createApp({
    abuseControl: allowAllGrowfulAbuseControl,
    authorizationOrigin,
    oauthAccess,
    readinessProbe: readyProbe,
    redirectOrigin,
    serviceStatusSource: emptyServiceStatusSource,
    service,
    smartThingsAppId: "growful-app",
  })
  apps.push(app)
  return { app, store }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("Private-beta OAuth access HTTP surface", () => {
  it("requires Basic authentication for both private beta OAuth start requests", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )
    const authorization = `Basic ${Buffer.from("private-user:private-password").toString("base64")}`

    // When
    const unauthenticatedGet = await fixture.app.inject({ method: "GET", url: "/oauth/start" })
    const unauthenticatedPost = await fixture.app.inject({
      headers: { "content-type": "application/x-www-form-urlencoded", origin: redirectOrigin },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })
    const authenticatedGet = await fixture.app.inject({
      headers: { authorization },
      method: "GET",
      url: "/oauth/start",
    })
    const authenticatedPost = await fixture.app.inject({
      headers: {
        authorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })

    // Then
    expect(unauthenticatedGet.statusCode).toBe(401)
    expect(unauthenticatedGet.headers["www-authenticate"]).toBe(
      'Basic realm="Growful private beta", charset="UTF-8"',
    )
    expect(unauthenticatedGet.headers["cache-control"]).toBe("no-store")
    expect(unauthenticatedGet.json()).toEqual({ error: "private_beta_access_required" })
    expect(unauthenticatedPost.statusCode).toBe(401)
    expect(fixture.store.states.size).toBe(1)
    expect(authenticatedGet.statusCode).toBe(200)
    expect(authenticatedPost.statusCode).toBe(302)
  })

  it("authenticates a private beta OAuth POST only once", async () => {
    // Given
    const inviteAccess = new CountingConfiguredPrivateBetaInviteAccess([
      {
        passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
        username: "private-user",
      },
    ])
    const fixture = createFixture({
      ...testDisclosures,
      inviteAccess,
      mode: "private_beta",
    })
    const authorization = `Basic ${Buffer.from("private-user:private-password").toString("base64")}`

    // When
    const response = await fixture.app.inject({
      headers: {
        authorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(302)
    expect(inviteAccess.authenticateCalls).toBe(1)
  })

  it("renders safe recovery guidance when browser authentication fails", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )
    const leakedUsername = "browser-user-must-not-leak"
    const leakedInviteSecret = "invite-secret-must-not-leak"
    const authorization = `Basic ${Buffer.from(`${leakedUsername}:${leakedInviteSecret}`).toString("base64")}`

    // When
    const response = await fixture.app.inject({
      headers: { accept: "text/html,application/xhtml+xml", authorization },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers.vary).toBe("Accept")
    expect(response.headers["www-authenticate"]).toBe(
      'Basic realm="Growful private beta", charset="UTF-8"',
    )
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.headers["referrer-policy"]).toBe("no-referrer")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(response.headers["x-frame-options"]).toBe("DENY")
    expect(response.body).toContain("초대 사용자 이름")
    expect(response.body).toContain("원본 invite secret")
    expect(response.body).toContain("삼성 계정 비밀번호가 아닙니다")
    expect(response.body).toContain("반복해서 잘못 입력하면")
    expect(response.body).not.toContain(leakedUsername)
    expect(response.body).not.toContain(leakedInviteSecret)
    expect(response.body).not.toContain(authorization)
    expect(response.body).not.toContain("private_beta_access_required")
  })

  it("keeps the JSON authentication error contract when HTML is not acceptable", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )

    // When
    const response = await fixture.app.inject({
      headers: { accept: "application/json, text/html;q=0" },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(response.headers["content-type"]).toContain("application/json")
    expect(response.headers.vary).toBe("Accept")
    expect(response.headers["www-authenticate"]).toBe(
      'Basic realm="Growful private beta", charset="UTF-8"',
    )
    expect(response.json()).toEqual({ error: "private_beta_access_required" })
  })

  it("keeps JSON when the client prefers it over acceptable HTML", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )

    // When
    const response = await fixture.app.inject({
      headers: { accept: "application/json;q=1, text/html;q=0.1" },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(response.headers["content-type"]).toContain("application/json")
    expect(response.headers.vary).toBe("Accept")
    expect(response.json()).toEqual({ error: "private_beta_access_required" })
  })

  it("keeps JSON when XHTML is accepted without HTML", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )

    // When
    const response = await fixture.app.inject({
      headers: { accept: "application/xhtml+xml" },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(response.headers["content-type"]).toContain("application/json")
    expect(response.headers.vary).toBe("Accept")
    expect(response.json()).toEqual({ error: "private_beta_access_required" })
    expect(response.headers["www-authenticate"]).toBe(
      'Basic realm="Growful private beta", charset="UTF-8"',
    )
  })

  it.each([
    { accept: "*/*", contentType: "application/json" },
    { accept: "application/json, text/html", contentType: "application/json" },
    { accept: "text/*;q=1, application/json;q=0.8", contentType: "text/html" },
    {
      accept: "text/html;q=0.2, text/*;q=1, application/json;q=0.5",
      contentType: "application/json",
    },
    { accept: "application/json;q=0, text/html;q=1", contentType: "text/html" },
  ])("honors Accept specificity and quality for $accept", async ({ accept, contentType }) => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )

    // When
    const response = await fixture.app.inject({
      headers: { accept },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(response.headers["content-type"]).toContain(contentType)
    expect(response.headers.vary).toBe("Accept")
  })

  it.each(["text/html/invalid", "text/html;q=0x1"])(
    "keeps the JSON contract for malformed browser media preference %s",
    async (accept) => {
      // Given
      const fixture = createFixture(
        privateBetaOAuthAccess([
          {
            passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
            username: "private-user",
          },
        ]),
      )

      // When
      const response = await fixture.app.inject({
        headers: { accept },
        method: "GET",
        url: "/oauth/start",
      })

      // Then
      expect(response.statusCode).toBe(401)
      expect(response.headers["content-type"]).toContain("application/json")
      expect(response.headers.vary).toBe("Accept")
      expect(response.json()).toEqual({ error: "private_beta_access_required" })
    },
  )

  it("rejects a private beta user removed from the invitation list", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "5b7865cd940ba26f00ee2d535bf8d96aba6308d98c1e290e2d095986e5967f55",
          username: "second-user",
        },
      ]),
    )
    const removedAuthorization = `Basic ${Buffer.from("private-user:private-password").toString("base64")}`

    // When
    const response = await fixture.app.inject({
      headers: { authorization: removedAuthorization },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
  })

  it("rate limits repeated invalid private beta credentials", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )
    const invalidAuthorization = `Basic ${Buffer.from("private-user:wrong-password").toString("base64")}`

    // When
    const responses = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(
        await fixture.app.inject({
          headers: {
            authorization: invalidAuthorization,
            "x-forwarded-for": "192.0.2.10",
          },
          method: "GET",
          url: "/oauth/start",
        }),
      )
    }
    const otherClient = await fixture.app.inject({
      headers: {
        authorization: invalidAuthorization,
        "x-forwarded-for": "192.0.2.11",
      },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(responses.slice(0, 5).map((response) => response.statusCode)).toEqual(Array(5).fill(401))
    expect(responses[5]?.statusCode).toBe(429)
    expect(responses[5]?.headers["content-type"]).toContain("application/json")
    expect(responses[5]?.headers.vary).toBe("Accept")
    expect(responses[5]?.headers["retry-after"]).toBe("60")
    expect(responses[5]?.headers["cache-control"]).toBe("no-store")
    expect(responses[5]?.json()).toEqual({ error: "private_beta_access_rate_limited" })
    expect(otherClient.statusCode).toBe(401)
  })

  it("renders Retry-After guidance when a browser reaches the private beta limit", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )
    const leakedUsername = "rate-limited-user-must-not-leak"
    const leakedInviteSecret = "rate-limited-secret-must-not-leak"
    const authorization = `Basic ${Buffer.from(`${leakedUsername}:${leakedInviteSecret}`).toString("base64")}`
    const headers = {
      accept: "text/html,application/xhtml+xml",
      authorization,
      "x-forwarded-for": "192.0.2.20",
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await fixture.app.inject({ headers, method: "GET", url: "/oauth/start" })
    }

    // When
    const response = await fixture.app.inject({ headers, method: "GET", url: "/oauth/start" })

    // Then
    expect(response.statusCode).toBe(429)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers.vary).toBe("Accept")
    expect(response.headers["retry-after"]).toBe("60")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.headers["referrer-policy"]).toBe("no-referrer")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(response.headers["x-frame-options"]).toBe("DENY")
    expect(response.body).toContain('datetime="PT60S"')
    expect(response.body).toContain("60초 뒤")
    expect(response.body).toContain("원본 invite secret")
    expect(response.body).not.toContain(leakedUsername)
    expect(response.body).not.toContain(leakedInviteSecret)
    expect(response.body).not.toContain(authorization)
    expect(response.body).not.toContain("private_beta_access_rate_limited")
  })

  it("clears the client failure bucket after valid private beta credentials", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "dca6861589d640c028853cee4c51e8c222c3a6b52ad396864e1cf0c742571f42",
          username: "private-user",
        },
      ]),
    )
    const validAuthorization = `Basic ${Buffer.from("private-user:private-password").toString("base64")}`
    const invalidAuthorization = `Basic ${Buffer.from("private-user:wrong-password").toString("base64")}`
    const forwardedFor = "192.0.2.12"
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await fixture.app.inject({
        headers: { authorization: invalidAuthorization, "x-forwarded-for": forwardedFor },
        method: "GET",
        url: "/oauth/start",
      })
    }
    await fixture.app.inject({
      headers: { authorization: validAuthorization, "x-forwarded-for": forwardedFor },
      method: "GET",
      url: "/oauth/start",
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: invalidAuthorization, "x-forwarded-for": forwardedFor },
      method: "GET",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(401)
  })

  it("rejects an existing Growful token that is not bound to an active invitation", async () => {
    // Given
    const fixture = createFixture(
      privateBetaOAuthAccess([
        {
          passwordHash: "5b7865cd940ba26f00ee2d535bf8d96aba6308d98c1e290e2d095986e5967f55",
          username: "second-user",
        },
      ]),
    )
    fixture.store.seedTokens(storedTokens())

    // When
    const response = await fixture.app.inject({
      headers: { authorization: `Bearer ${memoryStoreGrowfulToken}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(response.statusCode).toBe(401)
  })
})
