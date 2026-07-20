import { type IncomingHttpHeaders, request as requestHttp } from "node:http"
import { gzipSync } from "node:zlib"
import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FakeSmartThingsApi } from "./fixtures/fake-smartthings-api.js"
import {
  createGatewayProxyFixture,
  gatewayAuthorization,
} from "./fixtures/gateway-proxy-fixture.js"

async function sendWireRequest(
  app: FastifyInstance,
  path: string,
  headers: Readonly<Record<string, string>>,
  method = "GET",
): Promise<number> {
  return (await sendWireResponse(app, path, headers, method)).statusCode
}

async function sendWireResponse(
  app: FastifyInstance,
  path: string,
  headers: Readonly<Record<string, string>>,
  method = "GET",
): Promise<{ readonly headers: IncomingHttpHeaders; readonly statusCode: number }> {
  if (!app.server.listening) {
    await app.listen({ host: "127.0.0.1", port: 0 })
  }
  const address = app.server.address()
  if (address === null || typeof address === "string") {
    throw new Error("Gateway test server did not bind a TCP address")
  }

  return new Promise((resolve, reject) => {
    const request = requestHttp(
      { headers, host: "127.0.0.1", method, path, port: address.port },
      (response) => {
        response.resume()
        response.once("end", () =>
          resolve({ headers: response.headers, statusCode: response.statusCode ?? 0 }),
        )
      },
    )
    request.once("error", reject)
    request.end()
  })
}

describe("SmartThings API passthrough fidelity", () => {
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

  it("relays redirects without following them", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    api.enqueueResponse({
      body: Buffer.alloc(0),
      headers: { location: "/v1/redirected" },
      statusCode: 302,
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe("/v1/redirected")
    expect(api.requests).toHaveLength(1)
  })

  it("preserves compressed upstream body bytes and content encoding", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    const compressedBody = gzipSync('{"devices":[]}')
    api.enqueueResponse({
      body: compressedBody,
      headers: { "content-encoding": "gzip", "content-type": "application/json" },
      statusCode: 200,
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization, "accept-encoding": "gzip" },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.rawPayload.equals(compressedBody)).toBe(true)
    expect(response.headers["content-encoding"]).toBe("gzip")
  })

  it("does not invent a content type when upstream omits it", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    api.enqueueResponse({ body: Buffer.from("untyped"), headers: {}, statusCode: 203 })

    // When
    const response = await sendWireResponse(fixture.app, "/v1/devices", {
      authorization: gatewayAuthorization,
    })

    // Then
    expect(response.statusCode).toBe(203)
    expect(response.headers["content-type"]).toBeUndefined()
  })

  it("forwards a GET request body byte for byte", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    const requestBody = Buffer.from("get-body")

    // When
    const response = await fixture.app.inject({
      headers: {
        authorization: gatewayAuthorization,
        "content-length": requestBody.length.toString(),
        "content-type": "application/octet-stream",
      },
      method: "GET",
      payload: requestBody,
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(api.requests[0]?.body.equals(requestBody)).toBe(true)
  })

  it("preserves compressed request bytes and content encoding", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    const compressedBody = gzipSync('{"commands":[]}')

    // When
    const response = await fixture.app.inject({
      headers: {
        authorization: gatewayAuthorization,
        "content-encoding": "gzip",
        "content-type": "application/json",
      },
      method: "POST",
      payload: compressedBody,
      url: "/v1/devices/device-1/commands",
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(api.requests[0]?.body.equals(compressedBody)).toBe(true)
    expect(api.requests[0]?.headers["content-encoding"]).toBe("gzip")
  })

  it("preserves the raw path and query bytes on the wire", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    const rawUrl = "/v1/foo/%2e/bar?x=%2f&&y=+"

    // When
    const statusCode = await sendWireRequest(fixture.app, rawUrl, {
      authorization: gatewayAuthorization,
    })

    // Then
    expect(statusCode).toBe(200)
    expect(api.requests[0]?.url).toBe(rawUrl)
  })

  it.each([
    "/v1/%2e%2e/oauth/token",
    "/v1/%2E%2E/oauth/token",
    "/v1/%2e%2E/oauth/token",
    "/v1/%2e%2e%2foauth/token",
    "/v1/%2E%2E%2Foauth/token",
    "/v1/%2e%2E%2foauth/token",
    "/v1/..%2foauth/token",
    "/v1/%2e%2e%5coauth/token",
    "/v1/%252e%252e/oauth/token",
    "/v1/%25252e%25252e/oauth/token",
    "/v1/%25252525252e%25252525252e/oauth/token",
  ])("rejects an encoded namespace escape on the wire: %s", async (rawUrl) => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })

    // When
    const statusCode = await sendWireRequest(fixture.app, rawUrl, {
      authorization: gatewayAuthorization,
    })

    // Then
    expect(statusCode).toBe(400)
    expect(api.requests).toHaveLength(0)
  })

  it("removes request headers named by the inbound Connection header", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })

    // When
    const statusCode = await sendWireRequest(fixture.app, "/v1/devices", {
      authorization: gatewayAuthorization,
      connection: "X-Request-ID",
      "x-request-id": "must-not-forward",
    })

    // Then
    expect(statusCode).toBe(200)
    expect(api.requests[0]?.headers["x-request-id"]).toBeUndefined()
  })

  it("rejects TRACE before injecting the SmartThings access token", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })

    // When
    const statusCode = await sendWireRequest(
      fixture.app,
      "/v1/devices",
      { authorization: gatewayAuthorization },
      "TRACE",
    )

    // Then
    expect(statusCode).toBe(405)
    expect(api.requests).toHaveLength(0)
  })

  it("removes response headers named by the upstream Connection header", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    api.enqueueResponse({
      body: Buffer.from("ok"),
      headers: { connection: "x-upstream-only", "x-upstream-only": "secret" },
      statusCode: 200,
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.headers["x-upstream-only"]).toBeUndefined()
  })

  it("preserves a no-content response status", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    api.enqueueResponse({ body: Buffer.alloc(0), headers: { etag: '"empty"' }, statusCode: 204 })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "DELETE",
      url: "/v1/rules/rule-1",
    })

    // Then
    expect(response.statusCode).toBe(204)
    expect(response.rawPayload).toHaveLength(0)
    expect(response.headers.etag).toBe('"empty"')
  })

  it("preserves HEAD semantics without a response body", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "HEAD",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toHaveLength(0)
    expect(api.requests[0]?.method).toBe("HEAD")
  })

  it("refreshes once for staggered concurrent rejections of the same token", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })
    api.enqueueResponse({ body: Buffer.alloc(0), headers: {}, statusCode: 401 })
    api.enqueueResponse({ body: Buffer.alloc(0), delayMs: 50, headers: {}, statusCode: 401 })
    api.enqueueResponse({ body: Buffer.from("first"), headers: {}, statusCode: 200 })
    api.enqueueResponse({ body: Buffer.from("second"), headers: {}, statusCode: 200 })

    // When
    const responses = await Promise.all(
      ["devices", "locations"].map((path) =>
        fixture.app.inject({
          headers: { authorization: gatewayAuthorization },
          method: "GET",
          url: `/v1/${path}`,
        }),
      ),
    )

    // Then
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200])
    expect(fixture.client.refreshedTokens).toEqual(["stored-smartthings-refresh-token"])
    expect(api.requests).toHaveLength(4)
  })
})
