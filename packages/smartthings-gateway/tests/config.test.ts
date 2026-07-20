import { describe, expect, it } from "vitest"
import { loadConfig } from "../src/config.js"

describe("loadConfig", () => {
  it("parses deployment environment into typed runtime values", () => {
    // Given
    const environment = {
      DATABASE_URL: "postgresql://gateway:password@postgres:5432/gateway",
      GATEWAY_API_TOKEN: "test-gateway-api-token-with-32-characters",
      OAUTH_ADMIN_TOKEN: "test-admin-token-with-32-characters",
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
      apiBaseUrl: new URL("https://api.smartthings.com"),
      apiTimeoutMs: 15_000,
      databaseUrl: environment.DATABASE_URL,
      gatewayApiToken: environment.GATEWAY_API_TOKEN,
      adminToken: environment.OAUTH_ADMIN_TOKEN,
      host: "0.0.0.0",
      port: 8_100,
      refreshBeforeExpiryMs: 3_600_000,
      refreshCheckIntervalMs: 300_000,
      refreshLeaseMs: 120_000,
      scopes: ["r:locations:*", "r:devices:*"],
    })
  })

  it("rejects a refresh lease shorter than the bounded refresh operation", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://gateway:password@postgres:5432/gateway",
        GATEWAY_API_TOKEN: "test-gateway-api-token-with-32-characters",
        OAUTH_ADMIN_TOKEN: "test-admin-token-with-32-characters",
        OAUTH_CLIENT_ID: "client-id",
        OAUTH_CLIENT_SECRET: "client-secret",
        OAUTH_REDIRECT_URI: "https://smartthings.growful.click/oauth/callback",
        REFRESH_LEASE_SECONDS: "60",
        SMARTTHINGS_SCOPES: "r:devices:*",
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).toThrow()
  })

  it("rejects the published operator-token placeholder", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://gateway:password@postgres:5432/gateway",
        GATEWAY_API_TOKEN: "test-gateway-api-token-with-32-characters",
        OAUTH_ADMIN_TOKEN: "replace-with-a-long-random-operator-token",
        OAUTH_CLIENT_ID: "client-id",
        OAUTH_CLIENT_SECRET: "client-secret",
        OAUTH_REDIRECT_URI: "https://smartthings.growful.click/oauth/callback",
        SMARTTHINGS_SCOPES: "r:devices:*",
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).toThrow()
  })

  it("rejects reuse of the OAuth admin token for gateway API access", () => {
    const sharedToken = "test-shared-token-with-32-characters"
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://gateway:password@postgres:5432/gateway",
        GATEWAY_API_TOKEN: sharedToken,
        OAUTH_ADMIN_TOKEN: sharedToken,
        OAUTH_CLIENT_ID: "client-id",
        OAUTH_CLIENT_SECRET: "client-secret",
        OAUTH_REDIRECT_URI: "https://smartthings.growful.click/oauth/callback",
        SMARTTHINGS_SCOPES: "r:devices:*",
        TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      }),
    ).toThrow()
  })
})
