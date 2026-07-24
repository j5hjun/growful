import { InstalledAppIdSchema, type StoredTokens } from "../../src/oauth/contracts.js"
import { OAuthService } from "../../src/oauth/oauth-service.js"
import { GrowfulTokenSchema } from "../../src/security/growful-token.js"
import { FakeSmartThingsClient } from "./fake-smartthings-client.js"
import { MemoryOAuthStore } from "./memory-oauth-store.js"

export const oauthServiceNow = new Date("2026-07-19T00:00:00.000Z")

export function testGrowfulToken(index: number) {
  return GrowfulTokenSchema.parse(`grw_st_${Buffer.alloc(32, index).toString("base64url")}`)
}

export function createOAuthServiceFixture() {
  const client = new FakeSmartThingsClient()
  const store = new MemoryOAuthStore()
  let tokenIndex = 1
  const service = new OAuthService({
    client,
    growfulTokenGenerator: () => {
      const token = testGrowfulToken(tokenIndex)
      tokenIndex += 1
      return token
    },
    now: () => oauthServiceNow,
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "test-state-with-sufficient-entropy",
    store,
  })
  return { client, service, store }
}

export function storedTokens(index: number): StoredTokens {
  return {
    accessToken: `access-${index}`,
    expiresAt: new Date("2026-07-19T00:00:30.000Z"),
    installedAppId: InstalledAppIdSchema.parse(`installed-app-${index}`),
    lastRefreshError: null,
    lastRefreshedAt: null,
    refreshToken: `refresh-${index}`,
    scopes: ["r:devices:*"],
    tokenType: "bearer",
  }
}
