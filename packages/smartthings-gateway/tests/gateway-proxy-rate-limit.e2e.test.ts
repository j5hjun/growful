import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MemorySmartThingsRateLimitBackoffStore } from "../src/http/smartthings-rate-limit-backoff.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"
import { GrowfulTokenSchema, hashGrowfulToken } from "../src/security/growful-token.js"
import { FakeSmartThingsApi } from "./fixtures/fake-smartthings-api.js"
import {
  createGatewayProxyFixture,
  gatewayAuthorization,
} from "./fixtures/gateway-proxy-fixture.js"

describe("SmartThings API rate-limit backoff", () => {
  const apps: FastifyInstance[] = []
  let api: FakeSmartThingsApi

  beforeEach(async () => {
    api = new FakeSmartThingsApi()
    await api.start()
  })

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()))
    await api.close()
  })

  it("backs off the same connection after SmartThings returns Retry-After", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    api.enqueueResponse({
      body: Buffer.from('{"error":"Too Many Requests"}'),
      headers: { "content-type": "application/json", "retry-after": "17" },
      statusCode: 429,
    })
    await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(429)
    expect(response.headers["retry-after"]).toBe("17")
    expect(response.json()).toEqual({ error: "smartthings_rate_limited" })
    expect(api.requests).toHaveLength(1)
  })

  it("keeps another connection available during backoff", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    const secondGrowfulToken = GrowfulTokenSchema.parse(
      `grw_st_${Buffer.alloc(32, 41).toString("base64url")}`,
    )
    fixture.store.seedTokens(
      {
        accessToken: "rate-limit-isolated-access-token",
        expiresAt: new Date("2026-07-23T00:00:00.000Z"),
        installedAppId: InstalledAppIdSchema.parse("rate-limit-isolated-installed-app"),
        lastRefreshedAt: null,
        refreshToken: "rate-limit-isolated-refresh-token",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      hashGrowfulToken(secondGrowfulToken),
    )
    api.enqueueResponse({
      body: Buffer.alloc(0),
      headers: { "retry-after": "17" },
      statusCode: 429,
    })
    await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: `Bearer ${secondGrowfulToken}` },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(api.requests).toHaveLength(2)
    expect(api.requests[1]?.headers.authorization).toBe("Bearer rate-limit-isolated-access-token")
  })

  it("shares a connection backoff across gateway instances", async () => {
    // Given
    const rateLimitStore = new MemorySmartThingsRateLimitBackoffStore()
    const firstGateway = createGatewayProxyFixture({ api, apps, rateLimitStore })
    const secondGateway = createGatewayProxyFixture({ api, apps, rateLimitStore })
    api.enqueueResponse({
      body: Buffer.alloc(0),
      headers: { "retry-after": "17" },
      statusCode: 429,
    })
    await firstGateway.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // When
    const response = await secondGateway.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(429)
    expect(response.json()).toEqual({ error: "smartthings_rate_limited" })
    expect(api.requests).toHaveLength(1)
  })
})
