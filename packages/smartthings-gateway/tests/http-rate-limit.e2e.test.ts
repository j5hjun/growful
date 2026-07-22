import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"
import {
  createSmartThingsWebhookFixture,
  webhookPath,
} from "./fixtures/smartthings-webhook-fixture.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("HTTP request rate limits", () => {
  it("limits repeated OAuth start requests from one client", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const responses = []

    // When
    for (let requestIndex = 0; requestIndex < 61; requestIndex += 1) {
      responses.push(
        await fixture.app.inject({
          headers: { "x-forwarded-for": "192.0.2.20" },
          method: "GET",
          url: "/oauth/start",
        }),
      )
    }

    // Then
    expect(responses.slice(0, 60).every((response) => response.statusCode === 200)).toBe(true)
    expect(responses[60]?.statusCode).toBe(429)
    expect(responses[60]?.headers["cache-control"]).toBe("no-store")
    expect(responses[60]?.headers["retry-after"]).toBeDefined()
    expect(responses[60]?.json()).toEqual({ error: "request_rate_limited" })
  })

  it("limits repeated SmartThings webhook requests from one client", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    const responses = []

    // When
    for (let requestIndex = 0; requestIndex < 121; requestIndex += 1) {
      responses.push(
        await fixture.app.inject({
          headers: { "x-forwarded-for": "192.0.2.21" },
          method: "POST",
          payload: { messageType: "EVENT" },
          url: webhookPath,
        }),
      )
    }

    // Then
    expect(responses.slice(0, 120).every((response) => response.statusCode === 401)).toBe(true)
    expect(responses[120]?.statusCode).toBe(429)
    expect(responses[120]?.headers["cache-control"]).toBe("no-store")
    expect(responses[120]?.headers["retry-after"]).toBeDefined()
    expect(responses[120]?.json()).toEqual({ error: "request_rate_limited" })
  })
})
