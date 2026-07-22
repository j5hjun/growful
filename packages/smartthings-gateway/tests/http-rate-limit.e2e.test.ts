import { Writable } from "node:stream"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"
import {
  createSmartThingsWebhookFixture,
  webhookPath,
} from "./fixtures/smartthings-webhook-fixture.js"

const apps: FastifyInstance[] = []
const webhookLogSchema = z
  .object({ msg: z.string(), statusCode: z.number().int().optional() })
  .passthrough()

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
    const logChunks: string[] = []
    const fixture = createSmartThingsWebhookFixture(apps, undefined, {
      level: "info",
      stream: new Writable({
        write(chunk, _encoding, done) {
          logChunks.push(String(chunk))
          done()
        },
      }),
    })
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
    const webhookLogs = logChunks
      .join("")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => webhookLogSchema.parse(JSON.parse(line)))
      .filter((entry) => entry.msg.startsWith("smartthings.webhook."))
    expect(
      webhookLogs.filter((entry) => entry.msg === "smartthings.webhook.received"),
    ).toHaveLength(120)
    expect(
      webhookLogs.filter(
        (entry) => entry.msg === "smartthings.webhook.failed" && entry.statusCode === 429,
      ),
    ).toHaveLength(1)
    expect(logChunks.join("")).not.toContain("192.0.2.21")
  })
})
