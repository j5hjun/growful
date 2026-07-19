import { describe, expect, it } from "vitest"
import { loadConfig } from "../src/config.js"

describe("loadConfig", () => {
  it("parses deployment environment into typed runtime values", () => {
    // Given
    const environment = {
      DATABASE_URL: "postgresql://gateway:password@postgres:5432/gateway",
      OAUTH_CLIENT_ID: "client-id",
      OAUTH_CLIENT_SECRET: "client-secret",
      OAUTH_REDIRECT_URI: "https://smartthings.growful.click/oauth/callback",
      SMARTTHINGS_SCOPES: "r:locations:* r:devices:*",
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    }

    // When
    const config = loadConfig(environment)

    // Then
    expect(config).toMatchObject({
      databaseUrl: environment.DATABASE_URL,
      host: "0.0.0.0",
      port: 8_100,
      refreshBeforeExpiryMs: 3_600_000,
      refreshCheckIntervalMs: 300_000,
      refreshLeaseMs: 60_000,
      scopes: ["r:locations:*", "r:devices:*"],
    })
  })
})
