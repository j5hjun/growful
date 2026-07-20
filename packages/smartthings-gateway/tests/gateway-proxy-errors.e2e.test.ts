import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FakeSmartThingsApi } from "./fixtures/fake-smartthings-api.js"
import {
  createGatewayProxyFixture,
  gatewayAuthorization,
} from "./fixtures/gateway-proxy-fixture.js"

describe("SmartThings API passthrough errors", () => {
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

  it("requires an OAuth connection before forwarding authenticated requests", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    fixture.store.tokens = null

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: "oauth_connection_required" })
    expect(api.requests).toHaveLength(0)
  })

  it("rejects encoded paths that escape the SmartThings v1 namespace", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/%2e%2e/oauth/token",
    })

    // Then
    expect(response.statusCode).toBe(404)
    expect(api.requests).toHaveLength(0)
  })

  it("returns 502 when SmartThings cannot be reached", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    await api.close()

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: "smartthings_gateway_unavailable" })
  })

  it("returns 504 when SmartThings exceeds the request deadline", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps, timeoutMs: 20 })
    api.hangNextResponse()

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(504)
    expect(response.json()).toEqual({ error: "smartthings_gateway_timeout" })
  })

  it("returns 504 when SmartThings stalls after sending response headers", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps, timeoutMs: 20 })
    api.stallNextResponseBody(100)

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(504)
    expect(response.json()).toEqual({ error: "smartthings_gateway_timeout" })
  })

  it("rejects an upstream response that exceeds the memory limit", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps, maxResponseBytes: 8 })
    api.enqueueResponse({ body: Buffer.alloc(9), headers: {}, statusCode: 200 })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: "smartthings_gateway_response_too_large" })
  })

  it("rejects an unauthenticated oversized request before parsing its body", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })

    // When
    const response = await fixture.app.inject({
      method: "POST",
      payload: Buffer.alloc(1_048_577),
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(api.requests).toHaveLength(0)
  })

  it("returns 413 for an authenticated oversized request", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "POST",
      payload: Buffer.alloc(1_048_577),
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(413)
    expect(response.json()).toEqual({ error: "request_body_too_large" })
  })
})
