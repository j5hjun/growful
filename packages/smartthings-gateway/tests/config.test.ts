import { describe, expect, it } from "vitest"
import { loadConfig } from "../src/config.js"

const requiredEnvironment = {
  DATABASE_URL: "postgresql://gateway:password@postgres:5432/gateway",
  OAUTH_CLIENT_ID: "client-id",
  OAUTH_CLIENT_SECRET: "client-secret",
  OAUTH_REDIRECT_URI: "https://smartthings.growful.click/oauth/callback",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
}

describe("loadConfig", () => {
  it("parses runtime configuration without shared Gateway tokens", () => {
    // Given
    const environment = { ...requiredEnvironment }

    // When
    const config = loadConfig(environment)

    // Then
    expect(config).toMatchObject({
      apiBaseUrl: new URL("https://api.smartthings.com"),
      apiTimeoutMs: 15_000,
      databaseUrl: environment.DATABASE_URL,
      host: "0.0.0.0",
      port: 8_100,
      refreshBeforeExpiryMs: 3_600_000,
      refreshCheckIntervalMs: 300_000,
      refreshLeaseMs: 120_000,
    })
    expect(config).not.toHaveProperty("adminToken")
    expect(config).not.toHaveProperty("gatewayApiToken")
  })

  it("rejects a refresh lease shorter than the bounded refresh operation", () => {
    expect(() => loadConfig({ ...requiredEnvironment, REFRESH_LEASE_SECONDS: "60" })).toThrow()
  })
})
