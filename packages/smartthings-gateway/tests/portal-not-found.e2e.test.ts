import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"

const apps: FastifyInstance[] = []

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
