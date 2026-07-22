import { request } from "node:http"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"

const apps: FastifyInstance[] = []

async function getRawPath(
  origin: URL,
  path: string,
): Promise<{ body: string; contentType: string | undefined; statusCode: number | undefined }> {
  return await new Promise((resolve, reject) => {
    const outgoingRequest = request(
      {
        headers: { accept: "text/html,application/xhtml+xml" },
        hostname: origin.hostname,
        method: "GET",
        path,
        port: origin.port,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            contentType: response.headers["content-type"],
            statusCode: response.statusCode,
          })
        })
      },
    )
    outgoingRequest.on("error", reject)
    outgoingRequest.end()
  })
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("Growful portal not-found responses", () => {
  it("renders a useful HTML not-found page for browser navigation", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({
      headers: { accept: "text/html" },
      method: "GET",
      url: "/missing-page",
    })

    // Then
    expect(response.statusCode).toBe(404)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers.vary).toContain("Accept")
    expect(response.body).toContain("페이지를 찾을 수 없습니다")
    expect(response.body).toContain('href="/"')
    expect(response.body).toContain('href="/status"')
    expect(response.body).toContain('href="/support"')
    expect(response.body).toContain('<a class="phrase" href="/support">지원 안내</a>')
    expect(response.body).toContain('<main id="main-content" tabindex="-1"')
  })

  it.each([
    "/healthz/missing",
    "/readyz/missing",
    "/connection/missing",
    "/token/rotate/missing",
    "/v1",
    "/smartthings/webhook",
  ])("keeps the reserved machine path %s on the JSON 404 contract", async (url) => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({
      headers: { accept: "text/html,application/xhtml+xml" },
      method: "GET",
      url,
    })

    // Then
    expect(response.statusCode).toBe(404)
    expect(response.headers["content-type"]).toContain("application/json")
    expect(response.json()).toEqual({ error: "not_found" })
  })

  it.each([
    "/v1%2Fmissing",
    "/connection%2Fmissing",
    "/readyz%2Fmissing",
    "/smartthings%2Fwebhook",
    "/v1%252Fmissing",
    "/v1%25252Fmissing",
    "/connection%25252Fmissing",
    "/smartthings%25252Fwebhook",
    "/v1%25255Cmissing",
    "/%2Fv1%2Fmissing",
    "//v1/missing",
    "/v1%252",
  ])("keeps the encoded machine path %s on the JSON 404 contract", async (url) => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({
      headers: { accept: "text/html,application/xhtml+xml" },
      method: "GET",
      url,
    })

    // Then
    expect(response.statusCode).toBe(404)
    expect(response.headers["content-type"]).toContain("application/json")
    expect(response.json()).toEqual({ error: "not_found" })
  })

  it.each([
    "/v1/%2e%2e/missing-page",
    "/%2e%2e/v1/missing",
    "/foo/../v1/missing",
    "/%252e%252e/v1/missing",
  ])("classifies the raw machine path %s before the HTTP client can normalize it", async (path) => {
    // Given
    const { app } = createGatewayAppFixture({ apps })
    const origin = new URL(await app.listen({ host: "127.0.0.1", port: 0 }))

    // When
    const response = await getRawPath(origin, path)

    // Then
    expect(response.statusCode).toBe(404)
    expect(response.contentType).toContain("application/json")
    expect(JSON.parse(response.body)).toEqual({ error: "not_found" })
  })

  it("does not render HTML when the client rejects the HTML media type", async () => {
    // Given
    const { app } = createGatewayAppFixture({ apps })

    // When
    const response = await app.inject({
      headers: { accept: "application/json, text/html;q=0" },
      method: "GET",
      url: "/missing-page",
    })

    // Then
    expect(response.statusCode).toBe(404)
    expect(response.headers["content-type"]).toContain("application/json")
    expect(response.json()).toEqual({ error: "not_found" })
  })
})
