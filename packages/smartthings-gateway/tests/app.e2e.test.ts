import { Writable } from "node:stream"
import { afterEach, describe, expect, it } from "vitest"
import { type AppOptions, createApp } from "../src/http/app.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const apps: ReturnType<typeof createApp>[] = []

function createFixture(logger?: AppOptions["logger"]) {
  const client = new FakeSmartThingsClient()
  const store = new MemoryOAuthStore()
  const service = new OAuthService({
    client,
    now: () => new Date("2026-07-19T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  const app = createApp({ logger, service })
  apps.push(app)
  return { app, client }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings Gateway HTTP API", () => {
  it("completes OAuth and reports connection metadata without tokens", async () => {
    // Given
    const fixture = createFixture()
    const startResponse = await fixture.app.inject({ method: "GET", url: "/oauth/start" })
    const location = new URL(startResponse.headers.location ?? "")
    const state = location.searchParams.get("state") ?? ""

    // When
    const callbackResponse = await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=authorization-code&state=${encodeURIComponent(state)}`,
    })
    const connectionResponse = await fixture.app.inject({ method: "GET", url: "/connection" })

    // Then
    expect(callbackResponse.statusCode).toBe(200)
    expect(connectionResponse.json()).toEqual({
      connected: true,
      expiresAt: "2026-07-20T00:00:00.000Z",
      lastRefreshedAt: null,
    })
    expect(connectionResponse.body).not.toContain("initial-access-token")
    expect(connectionResponse.body).not.toContain("initial-refresh-token")
  })

  it("does not log the OAuth authorization code or state", async () => {
    const logChunks: string[] = []
    const fixture = createFixture({
      level: "info",
      stream: new Writable({
        write(chunk, _encoding, done) {
          logChunks.push(String(chunk))
          done()
        },
      }),
    })
    const startResponse = await fixture.app.inject({ method: "GET", url: "/oauth/start" })
    const location = new URL(startResponse.headers.location ?? "")
    const state = location.searchParams.get("state") ?? ""

    await fixture.app.inject({
      method: "GET",
      url: `/oauth/callback?code=sensitive-authorization-code&state=${encodeURIComponent(state)}`,
    })

    const logs = logChunks.join("")
    expect(logs).not.toContain("sensitive-authorization-code")
    expect(logs).not.toContain(state)
  })
})
