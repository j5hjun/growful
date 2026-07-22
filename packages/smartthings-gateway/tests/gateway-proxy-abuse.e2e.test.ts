import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { hashAuditSubject } from "../src/audit/audit-event.js"
import type { InstalledAppId } from "../src/oauth/contracts.js"
import { FakeSmartThingsApi } from "./fixtures/fake-smartthings-api.js"
import {
  createGatewayProxyFixture,
  gatewayAuthorization,
} from "./fixtures/gateway-proxy-fixture.js"

describe("Growful proxy abuse block", () => {
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

  it("rejects a blocked connection without calling SmartThings", async () => {
    // Given
    const fixture = createGatewayProxyFixture({
      abuseControl: {
        async getBlock(_installedAppId: InstalledAppId) {
          return { blockedAt: new Date("2026-07-22T00:00:00.000Z"), reason: "quota_abuse" as const }
        },
      },
      api,
      apps,
    })

    // When
    const response = await fixture.app.inject({
      headers: { authorization: gatewayAuthorization },
      method: "GET",
      url: "/v1/devices",
    })

    // Then
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      error: "growful_access_blocked",
      reason: "quota_abuse",
      supportReference: hashAuditSubject({
        installedAppId: fixture.client.exchangeGrant.installedAppId,
      }),
    })
    expect(api.requests).toHaveLength(0)
  })
})
