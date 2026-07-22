import type { FastifyInstance } from "fastify"
import ky from "ky"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AuditEventDraft, AuditSink } from "../src/audit/audit-event.js"
import { GrowfulRequestQuota } from "../src/http/growful-request-quota.js"
import { FakeSmartThingsApi } from "./fixtures/fake-smartthings-api.js"
import {
  createGatewayProxyFixture,
  gatewayAuthorization,
} from "./fixtures/gateway-proxy-fixture.js"

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEventDraft[] = []

  async append(event: AuditEventDraft): Promise<void> {
    this.events.push(event)
  }
}

describe("Growful proxy request quota", () => {
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

  it("rejects the sixty-first request in a connection minute", async () => {
    // Given
    const fixture = createGatewayProxyFixture({ api, apps })

    // When
    const responses = await Promise.all(
      Array.from({ length: 61 }, () =>
        fixture.app.inject({
          headers: { authorization: gatewayAuthorization },
          method: "GET",
          url: "/v1/devices",
        }),
      ),
    )

    // Then
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(60)
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(1)
    expect(responses.find((response) => response.statusCode === 429)?.json()).toEqual({
      error: "growful_rate_limited",
    })
    expect(api.requests).toHaveLength(60)
  })

  it("does not append audit events for a quota-rejected proxy request", async () => {
    // Given
    const auditSink = new MemoryAuditSink()
    const fixture = createGatewayProxyFixture({
      api,
      apps,
      auditSink,
      requestQuota: new GrowfulRequestQuota({ limit: 1 }),
    })
    const origin = await fixture.app.listen({ host: "127.0.0.1", port: 0 })
    const requestOptions = {
      headers: { authorization: gatewayAuthorization },
      retry: 0,
      throwHttpErrors: false,
    } as const

    // When
    const acceptedResponse = await ky.get(`${origin}/v1/devices`, requestOptions)
    const rejectedResponse = await ky.get(`${origin}/v1/devices`, requestOptions)

    // Then
    expect(acceptedResponse.status).toBe(200)
    expect(rejectedResponse.status).toBe(429)
    await expect(rejectedResponse.json()).resolves.toEqual({ error: "growful_rate_limited" })
    expect(auditSink.events.map((event) => event.action)).toEqual([
      "connection.access",
      "token.read",
    ])
    expect(api.requests).toHaveLength(1)
  })
})
