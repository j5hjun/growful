import { Writable } from "node:stream"
import type { FastifyInstance, LightMyRequestResponse } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { SmartThingsTokenRequestError } from "../src/smartthings/smartthings-client.js"
import {
  createGatewayAppFixture,
  gatewayRedirectOrigin,
  testGrowfulToken,
} from "./fixtures/gateway-app-fixture.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

async function startAuthorization(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: gatewayRedirectOrigin,
    },
    method: "POST",
    payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
    url: "/oauth/start",
  })
  return new URL(response.headers.location ?? "").searchParams.get("state") ?? ""
}

function expectRecoveryPage(
  response: LightMyRequestResponse,
  expectedStatus: 400 | 429 | 500 | 502,
  expectedTitle: string,
): void {
  expect(response.statusCode).toBe(expectedStatus)
  expect(response.headers["cache-control"]).toBe("no-store")
  expect(response.headers["content-type"]).toContain("text/html; charset=utf-8")
  expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
  expect(response.headers["content-security-policy"]).toContain("script-src 'none'")
  expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'")
  expect(response.headers["referrer-policy"]).toBe("no-referrer")
  expect(response.headers["x-frame-options"]).toBe("DENY")
  expect(response.headers["x-content-type-options"]).toBe("nosniff")
  expect(response.body).toContain(`<h1>${expectedTitle}</h1>`)
  expect(response.body).toContain('href="/oauth/start"')
  expect(response.body).toContain('href="/"')
  expect(response.body).toContain('href="/support"')
}

describe("OAuth callback browser results", () => {
  it("renders a recovery page when the user denies SmartThings access", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const state = await startAuthorization(fixture.app)
    const providerDescription = "provider-description-with-sensitive-value"

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?error=access_denied&error_description=${encodeURIComponent(providerDescription)}&state=${encodeURIComponent(state)}`,
    })

    // Then
    expectRecoveryPage(response, 400, "SmartThings 연결이 취소되었습니다")
    expect(fixture.store.states.size).toBe(0)
    expect(fixture.client.exchangedCodes).toHaveLength(0)
    expect(response.body).not.toContain(state)
    expect(response.body).not.toContain(providerDescription)
  })

  it("renders a recovery page when the OAuth state is invalid", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const invalidState = "invalid-state-with-sensitive-value"
    const code = "authorization-code-with-sensitive-value"

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(invalidState)}`,
    })

    // Then
    expectRecoveryPage(response, 400, "연결 요청을 다시 시작해 주세요")
    expect(response.body).not.toContain(invalidState)
    expect(response.body).not.toContain(code)
  })

  it("renders a recovery page when the callback query is malformed", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: "/oauth/callback?code=authorization-code-without-state",
    })

    // Then
    expectRecoveryPage(response, 400, "올바르지 않은 연결 요청입니다")
    expect(response.body).not.toContain("authorization-code-without-state")
    expect(response.body).not.toContain(testGrowfulToken(1))
  })

  it("renders a recovery page when the callback contains both a code and an error", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const state = await startAuthorization(fixture.app)

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=ambiguous-code&error=access_denied&state=${encodeURIComponent(state)}`,
    })

    // Then
    expectRecoveryPage(response, 400, "올바르지 않은 연결 요청입니다")
    expect(response.body).not.toContain("ambiguous-code")
    expect(response.body).not.toContain(state)
    expect(fixture.client.exchangedCodes).toHaveLength(0)
  })

  it("renders a recovery page when the OAuth state has expired", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const state = await startAuthorization(fixture.app)
    const storedState = fixture.store.states.entries().next().value
    if (storedState === undefined) {
      throw new Error("Expected a stored OAuth state")
    }
    const [stateHash, authorization] = storedState
    fixture.store.states.set(stateHash, {
      ...authorization,
      expiresAt: new Date("2026-07-19T00:00:00.000Z"),
    })

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=expired-code&state=${encodeURIComponent(state)}`,
    })

    // Then
    expectRecoveryPage(response, 400, "연결 요청을 다시 시작해 주세요")
    expect(response.body).not.toContain(state)
    expect(response.body).not.toContain("expired-code")
  })

  it("renders a recovery page when the OAuth state is reused", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const state = await startAuthorization(fixture.app)
    await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    })

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=replayed-code&state=${encodeURIComponent(state)}`,
    })

    // Then
    expectRecoveryPage(response, 400, "연결 요청을 다시 시작해 주세요")
    expect(response.body).not.toContain(state)
    expect(response.body).not.toContain("replayed-code")
  })

  it("renders a recovery page when SmartThings returns mismatched scopes", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const state = await startAuthorization(fixture.app)
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      scopes: ["r:rules:*"],
    }

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=scope-code&state=${encodeURIComponent(state)}`,
    })

    // Then
    expectRecoveryPage(response, 502, "권한 확인 실패")
    expect(response.body).not.toContain(state)
    expect(response.body).not.toContain("scope-code")
    expect(response.body).not.toContain(fixture.client.exchangeGrant.installedAppId)
  })

  it("renders a recovery page when the SmartThings token exchange fails", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const state = await startAuthorization(fixture.app)
    const originalError = "upstream-error-with-sensitive-value"
    fixture.client.exchangeError = new SmartThingsTokenRequestError(503, {
      cause: new Error(originalError),
    })

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=failed-exchange-code&state=${encodeURIComponent(state)}`,
    })

    // Then
    expectRecoveryPage(response, 502, "SmartThings 연결 실패")
    expect(response.body).not.toContain(state)
    expect(response.body).not.toContain("failed-exchange-code")
    expect(response.body).not.toContain(originalError)
  })

  it("renders a recovery page and logs no raw details for unexpected errors", async () => {
    // Given
    const logChunks: string[] = []
    const fixture = createGatewayAppFixture({
      apps,
      logger: {
        level: "error",
        stream: new Writable({
          write(chunk, _encoding, done) {
            logChunks.push(String(chunk))
            done()
          },
        }),
      },
    })
    const state = await startAuthorization(fixture.app)
    const originalError = "unexpected-error-with-sensitive-value"
    const code = "unexpected-code-with-sensitive-value"
    fixture.client.exchangeError = new Error(originalError)

    // When
    const response = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    })

    // Then
    expectRecoveryPage(response, 500, "연결 중 문제가 발생했습니다")
    const logs = logChunks.join("")
    expect(logs).not.toContain(originalError)
    expect(logs).not.toContain(code)
    expect(logs).not.toContain(state)
    expect(logs).not.toContain(fixture.client.exchangeGrant.installedAppId)
    expect(response.body).not.toContain(originalError)
    expect(response.body).not.toContain(code)
    expect(response.body).not.toContain(state)
  })

  it("rate limits repeated callback requests with a recovery page", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    for (let requestIndex = 0; requestIndex < 60; requestIndex += 1) {
      const response = await fixture.app.inject({
        headers: {
          "cf-connecting-ip": "198.51.100.1",
          "x-forwarded-for": `198.51.100.${requestIndex + 1}`,
        },
        method: "GET",
        url: `/oauth/callback?code=invalid-code-${requestIndex}`,
      })
      expect(response.statusCode).toBe(400)
    }

    // When
    const response = await fixture.app.inject({
      headers: {
        "cf-connecting-ip": "198.51.100.1",
        "x-forwarded-for": "203.0.113.1",
      },
      method: "GET",
      url: "/oauth/callback?code=rate-limited-sensitive-code",
    })

    // Then
    expectRecoveryPage(response, 429, "요청이 너무 많습니다")
    expect(response.body).not.toContain("rate-limited-sensitive-code")
    expect(response.headers["retry-after"]).toBeDefined()

    const otherClientResponse = await fixture.app.inject({
      headers: {
        "cf-connecting-ip": "198.51.100.2",
        "x-forwarded-for": "203.0.113.1",
      },
      method: "GET",
      url: "/oauth/callback?code=other-client-sensitive-code",
    })
    expectRecoveryPage(otherClientResponse, 400, "올바르지 않은 연결 요청입니다")
    expect(otherClientResponse.body).not.toContain("other-client-sensitive-code")
  })

  it("falls back to the raw peer when the Cloudflare client address is missing or invalid", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    for (let requestIndex = 0; requestIndex < 60; requestIndex += 1) {
      const response = await fixture.app.inject({
        headers: {
          ...(requestIndex % 2 === 0 ? { "cf-connecting-ip": "not-an-ip" } : {}),
          "x-forwarded-for": `198.51.100.${requestIndex + 1}`,
        },
        method: "GET",
        url: `/oauth/callback?code=fallback-code-${requestIndex}`,
      })
      expect(response.statusCode).toBe(400)
    }

    // When
    const response = await fixture.app.inject({
      headers: {
        "cf-connecting-ip": "still-not-an-ip",
        "x-forwarded-for": "203.0.113.200",
      },
      method: "GET",
      url: "/oauth/callback?code=fallback-rate-limited-sensitive-code",
    })

    // Then
    expectRecoveryPage(response, 429, "요청이 너무 많습니다")
    expect(response.body).not.toContain("fallback-rate-limited-sensitive-code")
    expect(response.headers["retry-after"]).toBeDefined()
  })
})
