import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { InstalledAppIdSchema, RefreshClaimIdSchema } from "../src/oauth/contracts.js"
import { GrowfulTokenSchema, hashGrowfulToken } from "../src/security/growful-token.js"
import { FakeSmartThingsApi } from "./fixtures/fake-smartthings-api.js"
import {
  createGatewayProxyFixture,
  gatewayAuthorization,
  now,
} from "./fixtures/gateway-proxy-fixture.js"

describe("SmartThings API passthrough", () => {
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

  function createFixture() {
    return createGatewayProxyFixture({ api, apps })
  }

  it("rejects unauthenticated requests before contacting SmartThings", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({ method: "GET", url: "/v1/devices" })

    // Then
    expect(response.statusCode).toBe(401)
    expect(api.requests).toHaveLength(0)
  })

  it("forwards the original path and query with the stored SmartThings token", async () => {
    // Given
    const fixture = createFixture()

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices?locationId=location%2Fone&includeHealth=true",
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(api.requests).toHaveLength(1)
    expect(api.requests[0]?.url).toBe("/v1/devices?locationId=location%2Fone&includeHealth=true")
    expect(api.requests[0]?.headers.authorization).toBe("Bearer stored-smartthings-access-token")
  })

  it("selects an isolated SmartThings connection for each Growful token", async () => {
    // Given
    const fixture = createFixture()
    const secondGrowfulToken = GrowfulTokenSchema.parse(
      `grw_st_${Buffer.alloc(32, 8).toString("base64url")}`,
    )
    fixture.store.seedTokens(
      {
        accessToken: "second-smartthings-access-token",
        expiresAt: new Date("2026-07-20T00:00:00.000Z"),
        installedAppId: InstalledAppIdSchema.parse("installed-app-2"),
        lastRefreshError: null,
        lastRefreshedAt: null,
        refreshToken: "second-smartthings-refresh-token",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      hashGrowfulToken(secondGrowfulToken),
    )

    // When
    const firstResponse = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })
    const secondResponse = await fixture.app.inject({
      headers: { authorization: `Bearer ${secondGrowfulToken}` },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect([firstResponse.statusCode, secondResponse.statusCode]).toEqual([200, 200])
    expect(api.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer stored-smartthings-access-token",
      "Bearer second-smartthings-access-token",
    ])
  })

  it("returns the upstream status headers and body without JSON transformation", async () => {
    // Given
    const fixture = createFixture()
    const upstreamBody = Buffer.from('{ "devices" : [ { "id" : 1 } ] }\n')
    api.enqueueResponse({
      body: upstreamBody,
      headers: {
        "content-type": "application/vnd.smartthings+json",
        etag: '"opaque-etag"',
        link: '</v1/devices?page=2>; rel="next"',
        "retry-after": "17",
        "x-ratelimit-remaining": "41",
      },
      statusCode: 207,
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(207)
    expect(response.rawPayload.equals(upstreamBody)).toBe(true)
    expect(response.headers["content-type"]).toBe("application/vnd.smartthings+json")
    expect(response.headers.etag).toBe('"opaque-etag"')
    expect(response.headers.link).toBe('</v1/devices?page=2>; rel="next"')
    expect(response.headers["retry-after"]).toBe("17")
    expect(response.headers["x-ratelimit-remaining"]).toBe("41")
  })

  it("forwards a command request body byte for byte", async () => {
    // Given
    const fixture = createFixture()
    const requestBody = Buffer.from('{ "commands": [ { "command": "on" } ] }\n')

    // When
    const response = await fixture.app.inject({
      headers: {
        authorization: gatewayAuthorization,
        "content-type": "application/json",
      },
      method: "POST",
      payload: requestBody,
      url: "/v1/devices/device-1/commands",
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(api.requests[0]?.body.equals(requestBody)).toBe(true)
    expect(api.requests[0]?.headers["content-type"]).toBe("application/json")
  })

  it("refreshes once and retries when SmartThings rejects the access token", async () => {
    // Given
    const fixture = createFixture()
    api.enqueueResponse({
      body: Buffer.from('{"error":"Unauthorized"}'),
      headers: { "content-type": "application/json" },
      statusCode: 401,
    })
    api.enqueueResponse({
      body: Buffer.from('{"devices":[]}'),
      headers: { "content-type": "application/json" },
      statusCode: 200,
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(api.requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer stored-smartthings-access-token",
      "Bearer rotated-access-token",
    ])
    expect(fixture.client.refreshedTokens).toEqual(["stored-smartthings-refresh-token"])
  })

  it("returns the original 401 when another worker owns the refresh lease", async () => {
    // Given
    const fixture = createFixture()
    await fixture.store.claimTokensForRefresh({
      claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      expectedAccessToken: "stored-smartthings-access-token",
      installedAppId: fixture.client.exchangeGrant.installedAppId,
      kind: "forced",
      leaseMs: 60_000,
      now,
    })
    const rejectedBody = Buffer.from('{ "error" : "lease-busy" }')
    api.enqueueResponse({
      body: rejectedBody,
      headers: { "content-type": "application/json" },
      statusCode: 401,
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(response.rawPayload.equals(rejectedBody)).toBe(true)
    expect(api.requests).toHaveLength(1)
  })
})
