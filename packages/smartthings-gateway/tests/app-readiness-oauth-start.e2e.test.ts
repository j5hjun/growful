import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings Gateway HTTP API", () => {
  it("reports readiness when required dependencies are available", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })

    // When
    const response = await fixture.app.inject({ method: "GET", url: "/readyz" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.json()).toEqual({ status: "ready" })
  })

  it("reports unavailability when a required dependency cannot be queried", async () => {
    // Given
    const fixture = createGatewayAppFixture({
      apps,
      readinessProbe: { check: async () => "unavailable" },
    })

    // When
    const response = await fixture.app.inject({ method: "GET", url: "/readyz" })

    // Then
    expect(response.statusCode).toBe(503)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.json()).toEqual({ status: "unavailable" })
  })

  it("opens OAuth scope selection without a shared administrator token", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })

    // When
    const response = await fixture.app.inject({ method: "GET", url: "/oauth/start" })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.headers["referrer-policy"]).toBe("same-origin")
  })

  it("allows browser navigation through the SmartThings OAuth redirect chain", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })

    // When
    const response = await fixture.app.inject({ method: "GET", url: "/oauth/start" })

    // Then
    expect(response.headers["content-security-policy"]).toContain(
      "form-action 'self' https://api.smartthings.test https://account.smartthings.com https://account.samsung.com",
    )
  })
})
