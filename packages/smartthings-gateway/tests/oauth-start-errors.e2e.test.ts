import type { OutgoingHttpHeaders } from "node:http"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp } from "../src/http/app.js"
import {
  oauthStartErrorKinds,
  parseOAuthStartRetryAfterSeconds,
  renderOAuthStartError,
} from "../src/http/oauth-start-error.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import {
  ConfiguredPrivateBetaInviteAccess,
  type PrivateBetaInviteAccess,
} from "../src/private-beta/invite-access.js"
import { emptyServiceStatusSource } from "../src/status/service-status.js"
import { allowAllGrowfulAbuseControl } from "./fixtures/abuse-control.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { createGatewayAppFixture, gatewayRedirectOrigin } from "./fixtures/gateway-app-fixture.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"
import { testDisclosures } from "./fixtures/oauth-access.js"
import { readyProbe } from "./fixtures/readiness.js"

const apps: FastifyInstance[] = []
const browserAccept = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8"
const validSelection = "deviceRange=all&devicePermissions=read&policyConsent=accepted"

type OAuthStartResponse = {
  readonly body: string
  readonly headers: OutgoingHttpHeaders & {
    readonly location?: string | undefined
    readonly vary?: string | undefined
  }
  readonly statusCode: number
}

function expectOAuthFailureSecurity(
  response: OAuthStartResponse,
  statusCode: number,
  contentType: "application/json" | "text/html",
): void {
  expect(response.statusCode).toBe(statusCode)
  expect(response.headers["content-type"]).toContain(contentType)
  expect(response.headers["cache-control"]).toBe("no-store")
  expect(response.headers.vary).toBe("Accept")
  expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
  expect(response.headers["content-security-policy"]).toContain("form-action 'self'")
  expect(response.headers["referrer-policy"]).toBe("no-referrer")
  expect(response.headers["x-content-type-options"]).toBe("nosniff")
  expect(response.headers["x-frame-options"]).toBe("DENY")
  expect(response.headers.location).toBeUndefined()
}

function expectOAuthRecoveryPage(response: OAuthStartResponse): void {
  expect(response.body).not.toContain('role="alert"')
  expect(response.body).toContain('aria-labelledby="error-title"')
  expect(response.body).toContain('tabindex="-1" autofocus')
  expect(response.body).toContain('href="/oauth/start"')
  expect(response.body).toContain('href="/"')
  expect(response.body).toContain('href="/support"')
  expect(response.body).toContain("다음 행동")
}

class FailingPrivateBetaInviteAccess extends ConfiguredPrivateBetaInviteAccess {
  override async authenticate(_authorization: string | undefined): Promise<never> {
    throw new Error("invite-db-password-must-not-leak")
  }
}

class RevokedPrivateBetaInviteAccess extends ConfiguredPrivateBetaInviteAccess {
  override async authenticate(_authorization: string | undefined) {
    return { generation: "revoked-invite-generation", username: "private-user" }
  }

  override async resolveActiveInvite(_username: string) {
    return null
  }
}

function createPrivateBetaFixture(inviteAccess: PrivateBetaInviteAccess): {
  readonly app: FastifyInstance
  readonly generatedStates: string[]
  readonly store: MemoryOAuthStore
} {
  const generatedStates: string[] = []
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    accessPolicy: {
      policyVersion: testDisclosures.policyVersion,
      privateBetaAccess: inviteAccess,
    },
    client: new FakeSmartThingsClient(),
    now: () => new Date("2026-07-24T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => {
      const state = "private-beta-failure-state"
      generatedStates.push(state)
      return state
    },
    store,
  })
  const app = createApp({
    abuseControl: allowAllGrowfulAbuseControl,
    authorizationOrigin: "https://api.smartthings.test",
    oauthAccess: { ...testDisclosures, inviteAccess, mode: "private_beta" },
    readinessProbe: readyProbe,
    redirectOrigin: gatewayRedirectOrigin,
    service,
    serviceStatusSource: emptyServiceStatusSource,
    smartThingsAppId: "growful-app",
  })
  apps.push(app)
  return { app, generatedStates, store }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("OAuth start failure responses", () => {
  it.each([
    {
      accept: browserAccept,
      contentType: "application/json",
      payload: validSelection,
      responseContentType: "text/html" as const,
    },
    {
      accept: "application/json",
      contentType: "text/plain",
      payload: validSelection,
      responseContentType: "application/json" as const,
    },
    {
      accept: "application/json",
      contentType: "application/octet-stream",
      payload: validSelection,
      responseContentType: "application/json" as const,
    },
    {
      accept: "application/json",
      contentType: "multipart/form-data; boundary=oauth-boundary",
      payload: "--oauth-boundary--",
      responseContentType: "application/json" as const,
    },
  ])(
    "rejects $contentType as $responseContentType without creating an OAuth state",
    async ({ accept, contentType, payload, responseContentType }) => {
      // Given
      const fixture = createGatewayAppFixture({ apps })

      // When
      const response = await fixture.app.inject({
        headers: {
          accept,
          "content-type": contentType,
          origin: gatewayRedirectOrigin,
        },
        method: "POST",
        payload,
        url: "/oauth/start",
      })

      // Then
      expectOAuthFailureSecurity(response, 415, responseContentType)
      expect(fixture.store.states.size).toBe(0)
      if (responseContentType === "text/html") {
        expectOAuthRecoveryPage(response)
      } else {
        expect(response.json()).toEqual({ error: "unsupported_media_type" })
      }
    },
  )

  it.each([
    { accept: browserAccept, contentType: "text/html" as const, preference: "browser" },
    {
      accept: "application/json",
      contentType: "application/json" as const,
      preference: "JSON",
    },
    {
      accept: undefined,
      contentType: "application/json" as const,
      preference: "missing Accept",
    },
    { accept: "*/*", contentType: "application/json" as const, preference: "wildcard Accept" },
  ])("rejects JSON pasted into a form request for $preference", async ({ accept, contentType }) => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const reflectedSecret = "pasted-json-secret-must-not-leak"
    const payload = `{"deviceRange":"all","secret":"${reflectedSecret}"}`

    // When
    const response = await fixture.app.inject({
      headers: {
        ...(accept === undefined ? {} : { accept }),
        "content-type": "application/x-www-form-urlencoded",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload,
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(response.headers["content-type"]).toContain(contentType)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers.vary).toBe("Accept")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.headers["referrer-policy"]).toBe(
      contentType === "text/html" ? "same-origin" : "no-referrer",
    )
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(response.headers["x-frame-options"]).toBe("DENY")
    expect(response.headers.location).toBeUndefined()
    expect(response.body).not.toContain(reflectedSecret)
    expect(fixture.store.states.size).toBe(0)
    if (contentType === "text/html") {
      expect(response.body).toContain('id="selection-error-summary"')
      expect(response.body).toContain("지원 문의")
      expect(response.body).toContain('href="/"')
    } else {
      expect(response.json()).toEqual({ error: "invalid_request" })
    }
  })

  it.each([
    { accept: browserAccept, contentType: "text/html" as const },
    { accept: "application/json", contentType: "application/json" as const },
  ])("negotiates an oversized request as $contentType", async ({ accept, contentType }) => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const reflectedBody = "oversized-body-secret-must-not-leak"

    // When
    const response = await fixture.app.inject({
      headers: {
        accept,
        "content-type": "application/x-www-form-urlencoded",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: `${reflectedBody}${"x".repeat(4_097)}`,
      url: "/oauth/start",
    })

    // Then
    expectOAuthFailureSecurity(response, 413, contentType)
    expect(response.body).not.toContain(reflectedBody)
    expect(fixture.store.states.size).toBe(0)
    if (contentType === "text/html") {
      expectOAuthRecoveryPage(response)
      expect(response.body).toContain("새 Growful 권한 선택 화면을 열어")
      expect(response.body).not.toContain("필요한 항목만")
      expect(response.body).not.toContain("줄여")
    } else {
      expect(response.json()).toEqual({ error: "request_body_too_large" })
    }
  })

  it.each([
    { accept: browserAccept, contentType: "text/html" as const },
    { accept: "application/json", contentType: "application/json" as const },
  ])("negotiates an invalid Origin failure as $contentType", async ({ accept, contentType }) => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const reflectedOrigin = "https://private-origin-must-not-leak.example"

    // When
    const response = await fixture.app.inject({
      headers: {
        accept,
        "content-type": "application/x-www-form-urlencoded",
        origin: reflectedOrigin,
      },
      method: "POST",
      payload: validSelection,
      url: "/oauth/start",
    })

    // Then
    expectOAuthFailureSecurity(response, 403, contentType)
    expect(response.body).not.toContain(reflectedOrigin)
    expect(fixture.store.states.size).toBe(0)
    if (contentType === "text/html") {
      expectOAuthRecoveryPage(response)
    } else {
      expect(response.json()).toEqual({ error: "invalid_origin" })
    }
  })

  it.each([
    { accept: browserAccept, contentType: "text/html" as const },
    { accept: "application/json", contentType: "application/json" as const },
  ])(
    "negotiates an authorization URL construction failure as $contentType without storing state",
    async ({ accept, contentType }) => {
      // Given
      const fixture = createGatewayAppFixture({ apps })
      const rawError = "authorization-url-error-and-secret-must-not-leak"
      vi.spyOn(fixture.client, "buildAuthorizationUrl").mockImplementation(() => {
        throw new Error(rawError)
      })

      // When
      const response = await fixture.app.inject({
        headers: {
          accept,
          "content-type": "application/x-www-form-urlencoded",
          origin: gatewayRedirectOrigin,
        },
        method: "POST",
        payload: validSelection,
        url: "/oauth/start",
      })

      // Then
      expectOAuthFailureSecurity(response, 500, contentType)
      expect(response.body).not.toContain(rawError)
      expect(response.body).not.toContain(validSelection)
      expect(response.body).not.toContain("Error:")
      expect(fixture.store.states.size).toBe(0)
      if (contentType === "text/html") {
        expectOAuthRecoveryPage(response)
      } else {
        expect(response.json()).toEqual({ error: "internal_server_error" })
      }
    },
  )

  it.each([
    { accept: browserAccept, contentType: "text/html" as const },
    { accept: "application/json", contentType: "application/json" as const },
  ])(
    "negotiates a state storage failure as $contentType without reflecting details",
    async ({ accept, contentType }) => {
      // Given
      const fixture = createGatewayAppFixture({ apps })
      const rawError = "postgres-state-error-and-password-must-not-leak"
      vi.spyOn(fixture.store, "saveState").mockRejectedValue(new Error(rawError))

      // When
      const response = await fixture.app.inject({
        headers: {
          accept,
          "content-type": "application/x-www-form-urlencoded",
          origin: gatewayRedirectOrigin,
        },
        method: "POST",
        payload: validSelection,
        url: "/oauth/start",
      })

      // Then
      expectOAuthFailureSecurity(response, 500, contentType)
      expect(response.body).not.toContain(rawError)
      expect(response.body).not.toContain(validSelection)
      expect(response.body).not.toContain("Error:")
      expect(fixture.store.states.size).toBe(0)
      if (contentType === "text/html") {
        expectOAuthRecoveryPage(response)
        expect(response.body).toContain("SmartThings 승인 화면으로 이동하는 주소")
      } else {
        expect(response.json()).toEqual({ error: "internal_server_error" })
      }
    },
  )

  it.each([
    { accept: browserAccept, contentType: "text/html" as const, method: "GET" as const },
    {
      accept: "application/json",
      contentType: "application/json" as const,
      method: "POST" as const,
    },
  ])(
    "negotiates a private-beta invite lookup failure on $method as $contentType",
    async ({ accept, contentType, method }) => {
      // Given
      const fixture = createPrivateBetaFixture(new FailingPrivateBetaInviteAccess([]))

      // When
      const response = await fixture.app.inject({
        headers: {
          accept,
          authorization: `Basic ${Buffer.from("private-user:private-secret").toString("base64")}`,
          ...(method === "POST"
            ? {
                "content-type": "application/x-www-form-urlencoded",
                origin: gatewayRedirectOrigin,
              }
            : {}),
        },
        method,
        ...(method === "POST" ? { payload: validSelection } : {}),
        url: "/oauth/start",
      })

      // Then
      expectOAuthFailureSecurity(response, 500, contentType)
      expect(response.body).not.toContain("invite-db-password-must-not-leak")
      expect(response.body).not.toContain("private-secret")
      expect(fixture.store.states.size).toBe(0)
      if (contentType === "text/html") {
        expectOAuthRecoveryPage(response)
      } else {
        expect(response.json()).toEqual({ error: "internal_server_error" })
      }
    },
  )

  it.each([
    { accept: browserAccept, contentType: "text/html" as const },
    { accept: "application/json", contentType: "application/json" as const },
  ])(
    "preserves the invalid OAuth state contract as $contentType when an invite is revoked",
    async ({ accept, contentType }) => {
      // Given
      const fixture = createPrivateBetaFixture(new RevokedPrivateBetaInviteAccess([]))
      const authorization = `Basic ${Buffer.from("private-user:private-secret").toString("base64")}`

      // When
      const response = await fixture.app.inject({
        headers: {
          accept,
          authorization,
          "content-type": "application/x-www-form-urlencoded",
          origin: gatewayRedirectOrigin,
        },
        method: "POST",
        payload: validSelection,
        url: "/oauth/start",
      })

      // Then
      expectOAuthFailureSecurity(response, 400, contentType)
      expect(response.body).not.toContain("InvalidOAuthStateError")
      expect(response.body).not.toContain("private-secret")
      expect(response.body).not.toContain(authorization)
      expect(fixture.generatedStates).toEqual([])
      expect(fixture.store.states.size).toBe(0)
      if (contentType === "text/html") {
        expectOAuthRecoveryPage(response)
        expect(response.body).toContain("연결 요청 정보가 변경되었거나")
        expect(response.body).toContain("Growful 권한 선택 화면")
        expect(response.body).toContain("권한 선택 다시 시작")
      } else {
        expect(response.json()).toEqual({ error: "invalid_oauth_state" })
      }
    },
  )
})

describe("OAuth start Retry-After display", () => {
  it.each([
    { expected: 1, value: "1" },
    { expected: 60, value: 60 },
    { expected: 3_600, value: "3600" },
    { expected: undefined, value: undefined },
    { expected: undefined, value: 0 },
    { expected: undefined, value: -1 },
    { expected: undefined, value: "0" },
    { expected: undefined, value: "60 " },
    { expected: undefined, value: "1.5" },
    { expected: undefined, value: "3601" },
    { expected: undefined, value: "Wed, 24 Jul 2026 12:00:00 GMT" },
    { expected: undefined, value: ["60"] },
  ])("safely parses $value as $expected", ({ expected, value }) => {
    expect(parseOAuthStartRetryAfterSeconds(value)).toBe(expected)
  })

  it("uses static guidance instead of reflecting an invalid retry value", () => {
    const response = renderOAuthStartError(oauthStartErrorKinds.rateLimited, {
      retryAfterSeconds: 3_601,
    })

    expect(response).toContain("잠시 후 권한 선택을 다시 시작할 수 있습니다.")
    expect(response).not.toContain("<time")
    expect(response).not.toContain("3601")
  })
})
