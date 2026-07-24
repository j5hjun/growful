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

  it("renders safe recovery guidance for a browser rate-limited on OAuth start", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const responses = []
    const headers = {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://smartthings.growful.click",
      "x-forwarded-for": "192.0.2.22",
    }
    for (let requestIndex = 0; requestIndex < 60; requestIndex += 1) {
      responses.push(
        await fixture.app.inject({
          headers,
          method: "POST",
          payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
          url: "/oauth/start",
        }),
      )
    }
    const storedStateCount = fixture.store.states.size

    // When
    const response = await fixture.app.inject({
      headers,
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })

    // Then
    expect(responses.every((candidate) => candidate.statusCode === 302)).toBe(true)
    expect(response.statusCode).toBe(429)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.headers.vary).toBe("Accept")
    expect(response.headers["retry-after"]).toBeDefined()
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'")
    expect(response.headers["referrer-policy"]).toBe("no-referrer")
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(response.headers["x-frame-options"]).toBe("DENY")
    expect(response.headers.location).toBeUndefined()
    expect(response.body).toContain("요청이 너무 많습니다")
    const retryAfter = response.headers["retry-after"]
    expect(retryAfter).toMatch(/^[1-9][0-9]*$/u)
    expect(response.body).toContain(
      `<time datetime="PT${retryAfter}S">약 ${retryAfter}초 뒤</time>`,
    )
    expect(response.body).toContain('<a class="primary" href="/">서비스 안내</a>')
    expect(response.body).toContain(
      '<a class="secondary" href="/oauth/start">권한 선택 다시 시작</a>',
    )
    expect(response.body).not.toContain('class="primary" href="/oauth/start"')
    expect(response.body).toContain(
      "주소창 전체 주소, 승인 과정의 임시 코드·상태값, Growful 토큰, SmartThings 연결 토큰",
    )
    expect(fixture.store.states.size).toBe(storedStateCount)
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
