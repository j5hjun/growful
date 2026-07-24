import {
  InstalledAppIdSchema,
  type SmartThingsClient,
  type TokenGrant,
} from "../../src/oauth/contracts.js"
import type { SmartThingsScope } from "../../src/oauth/smartthings-scope.js"

export class FakeSmartThingsClient implements SmartThingsClient {
  readonly exchangedCodes: string[] = []
  readonly refreshGrants = new Map<string, TokenGrant>()
  readonly refreshedTokens: string[] = []

  exchangeError: Error | null = null
  refreshError: Error | null = null

  exchangeGrant: TokenGrant = {
    accessToken: "initial-access-token",
    expiresInSeconds: 86_400,
    installedAppId: InstalledAppIdSchema.parse("installed-app-1"),
    refreshToken: "initial-refresh-token",
    scopes: ["r:locations:*", "r:devices:*"],
    tokenType: "bearer",
  }

  refreshGrant: TokenGrant = {
    accessToken: "rotated-access-token",
    expiresInSeconds: 86_400,
    installedAppId: InstalledAppIdSchema.parse("installed-app-1"),
    refreshToken: "rotated-refresh-token",
    scopes: ["r:locations:*", "r:devices:*"],
    tokenType: "bearer",
  }

  buildAuthorizationUrl(state: string, scopes: readonly SmartThingsScope[]): URL {
    const url = new URL("https://api.smartthings.test/oauth/authorize")
    url.searchParams.set("scope", scopes.join(" "))
    url.searchParams.set("state", state)
    return url
  }

  async exchangeCode(code: string): Promise<TokenGrant> {
    this.exchangedCodes.push(code)
    if (this.exchangeError !== null) {
      throw this.exchangeError
    }
    return this.exchangeGrant
  }

  async refresh(refreshToken: string): Promise<TokenGrant> {
    this.refreshedTokens.push(refreshToken)
    if (this.refreshError !== null) {
      throw this.refreshError
    }
    return this.refreshGrants.get(refreshToken) ?? this.refreshGrant
  }
}
