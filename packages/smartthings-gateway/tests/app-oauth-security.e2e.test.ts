import { Writable } from "node:stream"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import {
  authorizeGatewayApp,
  createGatewayAppFixture,
  gatewayRedirectOrigin,
  testGrowfulToken,
} from "./fixtures/gateway-app-fixture.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings Gateway HTTP API", () => {
  it("does not log OAuth secrets or the issued Growful token", async () => {
    // Given
    const logChunks: string[] = []
    const fixture = createGatewayAppFixture({
      apps,
      logger: {
        level: "info",
        stream: new Writable({
          write(chunk, _encoding, done) {
            logChunks.push(String(chunk))
            done()
          },
        }),
      },
    })

    // When
    const response = await authorizeGatewayApp(fixture.app)

    // Then
    const logs = logChunks.join("")
    expect(response.statusCode).toBe(200)
    expect(logs).not.toContain("authorization-code")
    expect(logs).not.toContain("test-state-with-sufficient-entropy")
    expect(logs).not.toContain(testGrowfulToken(1))
  })

  it("rejects OAuth selections from a different origin", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })

    // When
    const response = await fixture.app.inject({
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(403)
    expect(fixture.store.states.size).toBe(0)
  })

  it("rejects oversized OAuth selections", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })

    // When
    const response = await fixture.app.inject({
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: "x".repeat(4_097),
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(413)
  })

  it("consumes the OAuth state when authorization is denied", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const start = await fixture.app.inject({
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: gatewayRedirectOrigin,
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })
    const state = new URL(start.headers.location ?? "").searchParams.get("state") ?? ""

    // When
    const denied = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?error=access_denied&state=${encodeURIComponent(state)}`,
    })
    const replay = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=replayed-code&state=${encodeURIComponent(state)}`,
    })

    // Then
    expect(denied.statusCode).toBe(400)
    expect(denied.headers["content-type"]).toContain("text/html")
    expect(replay.statusCode).toBe(400)
    expect(replay.headers["content-type"]).toContain("text/html")
    expect(replay.body).toContain("연결 요청을 다시 시작해 주세요")
    expect(fixture.client.exchangedCodes).toHaveLength(0)
  })
})
