import ky, { HTTPError } from "ky"
import { z } from "zod"
import {
  InstalledAppIdSchema,
  type SmartThingsClient,
  type TokenGrant,
} from "../oauth/contracts.js"
import {
  SmartThingsGrantedScopeStringSchema,
  type SmartThingsScope,
  serializeSmartThingsScopes,
} from "../oauth/smartthings-scope.js"

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  installed_app_id: InstalledAppIdSchema,
  refresh_token: z.string().min(1),
  scope: SmartThingsGrantedScopeStringSchema,
  token_type: z.string().min(1),
})

export type HttpSmartThingsClientOptions = {
  readonly authorizationUrl: URL
  readonly clientId: string
  readonly clientSecret: string
  readonly redirectUri: URL
  readonly tokenUrl: URL
}

export class SmartThingsTokenRequestError extends Error {
  override readonly name = "SmartThingsTokenRequestError"

  constructor(
    readonly statusCode: number | undefined,
    options?: ErrorOptions,
  ) {
    super("SmartThings rejected the OAuth token request", options)
  }
}

export class HttpSmartThingsClient implements SmartThingsClient {
  constructor(private readonly options: HttpSmartThingsClientOptions) {}

  buildAuthorizationUrl(state: string, scopes: readonly SmartThingsScope[]): URL {
    const url = new URL(this.options.authorizationUrl)
    url.searchParams.set("client_id", this.options.clientId)
    url.searchParams.set("redirect_uri", this.options.redirectUri.toString())
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", serializeSmartThingsScopes(scopes))
    url.searchParams.set("state", state)
    return url
  }

  async exchangeCode(code: string): Promise<TokenGrant> {
    return this.requestToken(
      new URLSearchParams({
        client_id: this.options.clientId,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.options.redirectUri.toString(),
      }),
    )
  }

  async refresh(refreshToken: string): Promise<TokenGrant> {
    return this.requestToken(
      new URLSearchParams({
        client_id: this.options.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    )
  }

  private async requestToken(body: URLSearchParams): Promise<TokenGrant> {
    const credentials = Buffer.from(
      `${this.options.clientId}:${this.options.clientSecret}`,
      "utf8",
    ).toString("base64")
    try {
      const responseBody = await ky
        .post(this.options.tokenUrl, {
          body,
          headers: { accept: "application/json", authorization: `Basic ${credentials}` },
          retry: 0,
          timeout: 15_000,
        })
        .json<unknown>()
      const parsed = tokenResponseSchema.parse(responseBody)
      return {
        accessToken: parsed.access_token,
        expiresInSeconds: parsed.expires_in,
        installedAppId: parsed.installed_app_id,
        refreshToken: parsed.refresh_token,
        scopes: parsed.scope,
        tokenType: parsed.token_type,
      }
    } catch (error) {
      const statusCode = error instanceof HTTPError ? error.response.status : undefined
      throw new SmartThingsTokenRequestError(statusCode, { cause: error })
    }
  }
}
