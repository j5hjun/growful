import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { FakeSmartThingsApi } from "./fixtures/fake-smartthings-api.js"
import {
  createGatewayProxyFixture,
  gatewayAuthorization,
} from "./fixtures/gateway-proxy-fixture.js"

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
})
