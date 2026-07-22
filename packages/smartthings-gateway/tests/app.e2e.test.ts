import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { hashAuditSubject } from "../src/audit/audit-event.js"
import { GrowfulRequestQuota } from "../src/http/growful-request-quota.js"
import {
  authorizeGatewayApp,
  createGatewayAppFixture,
  testGrowfulToken,
} from "./fixtures/gateway-app-fixture.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings Gateway HTTP API", () => {
  it("issues a Growful token once and requires it for connection status", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    fixture.client.exchangeGrant = {
      ...fixture.client.exchangeGrant,
      scopes: ["r:devices:$", "x:devices:$", "r:locations:*"],
    }

    // When
    const callbackResponse = await authorizeGatewayApp(fixture.app)
    const tokenSafetyScript = await fixture.app.inject({
      method: "GET",
      url: "/token-safety.js",
    })
    const unauthenticatedStatus = await fixture.app.inject({ method: "GET", url: "/connection" })
    const authenticatedStatus = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(callbackResponse.statusCode).toBe(200)
    expect(callbackResponse.headers["cache-control"]).toBe("no-store")
    expect(callbackResponse.headers["content-type"]).toContain("text/html")
    expect(callbackResponse.headers["content-security-policy"]).toContain("script-src 'self'")
    expect(callbackResponse.body.match(/data-growful-token/g)).toHaveLength(1)
    expect(callbackResponse.body.match(new RegExp(testGrowfulToken(1), "g"))).toHaveLength(1)
    expect(tokenSafetyScript.statusCode).toBe(200)
    expect(tokenSafetyScript.headers["cache-control"]).toBe("no-store")
    expect(tokenSafetyScript.headers["content-type"]).toContain("javascript")
    expect(unauthenticatedStatus.statusCode).toBe(401)
    expect(authenticatedStatus.json()).toEqual({
      connected: true,
      expiresAt: "2026-07-20T00:00:00.000Z",
      grantedScopes: ["r:devices:$", "x:devices:$", "r:locations:*"],
      lastRefreshedAt: null,
      serviceAccess: { status: "active" },
      supportReference: hashAuditSubject(fixture.client.exchangeGrant.installedAppId),
    })
    expect(authenticatedStatus.body).not.toContain("initial-access-token")
    expect(authenticatedStatus.body).not.toContain("initial-refresh-token")
  })

  it("reports a blocked service access state without exposing the connection identifier", async () => {
    // Given
    const fixture = createGatewayAppFixture({
      abuseControl: {
        getBlock: async () => ({
          blockedAt: new Date("2026-07-22T01:02:03.000Z"),
          reason: "security_incident",
        }),
      },
      apps,
    })
    await authorizeGatewayApp(fixture.app)

    // When
    const response = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(response.json().serviceAccess).toEqual({
      blockedAt: "2026-07-22T01:02:03.000Z",
      reason: "security_incident",
      status: "blocked",
    })
    expect(response.body).not.toContain(fixture.client.exchangeGrant.installedAppId)
  })

  it("rate limits repeated connection status reads per connection", async () => {
    // Given
    const fixture = createGatewayAppFixture({
      apps,
      requestQuota: new GrowfulRequestQuota({ limit: 1 }),
    })
    await authorizeGatewayApp(fixture.app)

    // When
    const firstResponse = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })
    const rejectedResponse = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(firstResponse.statusCode).toBe(200)
    expect(rejectedResponse.statusCode).toBe(429)
    expect(rejectedResponse.headers["retry-after"]).toBe("60")
    expect(rejectedResponse.json()).toEqual({ error: "growful_rate_limited" })
  })

  it("rotates the Growful token and invalidates the previous token", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    await authorizeGatewayApp(fixture.app)

    // When
    const rotation = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "POST",
      url: "/token/rotate",
    })
    const previousStatus = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })
    const currentStatus = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(2)}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(rotation.json()).toEqual({ growfulToken: testGrowfulToken(2) })
    expect(rotation.headers["cache-control"]).toBe("no-store")
    expect(previousStatus.statusCode).toBe(401)
    expect(currentStatus.statusCode).toBe(200)
  })

  it("disconnects the authenticated connection and revokes its token", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    await authorizeGatewayApp(fixture.app)

    // When
    const disconnected = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "DELETE",
      url: "/connection",
    })
    const status = await fixture.app.inject({
      headers: { authorization: `Bearer ${testGrowfulToken(1)}` },
      method: "GET",
      url: "/connection",
    })

    // Then
    expect(disconnected.statusCode).toBe(204)
    expect(status.statusCode).toBe(401)
  })
})
