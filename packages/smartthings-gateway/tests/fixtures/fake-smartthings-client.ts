import {
  InstalledAppIdSchema,
  type SmartThingsClient,
  type TokenGrant,
} from "../../src/oauth/contracts.js"

export class FakeSmartThingsClient implements SmartThingsClient {
  readonly exchangedCodes: string[] = []
  readonly refreshedTokens: string[] = []

  exchangeGrant: TokenGrant = {
    accessToken: "initial-access-token",
    expiresInSeconds: 86_400,
    installedAppId: InstalledAppIdSchema.parse("installed-app-1"),
    refreshToken: "initial-refresh-token",
    scope: "r:locations:* r:devices:*",
    tokenType: "bearer",
  }

  refreshGrant: TokenGrant = {
    accessToken: "rotated-access-token",
    expiresInSeconds: 86_400,
    installedAppId: InstalledAppIdSchema.parse("installed-app-1"),
    refreshToken: "rotated-refresh-token",
    scope: "r:locations:* r:devices:*",
    tokenType: "bearer",
  }

  buildAuthorizationUrl(state: string): URL {
    const url = new URL("https://api.smartthings.test/oauth/authorize")
    url.searchParams.set("state", state)
    return url
  }

  async exchangeCode(code: string): Promise<TokenGrant> {
    this.exchangedCodes.push(code)
    return this.exchangeGrant
  }

  async refresh(refreshToken: string): Promise<TokenGrant> {
    this.refreshedTokens.push(refreshToken)
    return this.refreshGrant
  }
}
