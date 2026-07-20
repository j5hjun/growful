import { z } from "zod"

export const InstalledAppIdSchema = z.string().min(1).brand("InstalledAppId")
export const OAuthStateHashSchema = z.string().length(64).brand("OAuthStateHash")
export const RefreshClaimIdSchema = z.uuid().brand("RefreshClaimId")

export type InstalledAppId = z.infer<typeof InstalledAppIdSchema>
export type OAuthStateHash = z.infer<typeof OAuthStateHashSchema>
export type RefreshClaimId = z.infer<typeof RefreshClaimIdSchema>

export class StaleRefreshClaimError extends Error {
  override readonly name = "StaleRefreshClaimError"

  constructor() {
    super("Refresh claim is no longer current")
  }
}

export type TokenGrant = {
  readonly accessToken: string
  readonly expiresInSeconds: number
  readonly installedAppId: InstalledAppId
  readonly refreshToken: string
  readonly scope: string
  readonly tokenType: string
}

export type StoredTokens = {
  readonly accessToken: string
  readonly expiresAt: Date
  readonly installedAppId: InstalledAppId
  readonly lastRefreshedAt: Date | null
  readonly refreshToken: string
  readonly scope: string
  readonly tokenType: string
}

export type ConnectionStatus =
  | { readonly connected: false }
  | {
      readonly connected: true
      readonly expiresAt: string
      readonly lastRefreshedAt: string | null
    }

export type RefreshClaim = {
  readonly claimId: RefreshClaimId
  readonly expectedAccessToken?: string
  readonly leaseMs: number
  readonly now: Date
  readonly refreshBeforeExpiryMs: number | null
}

export type SaveTokensInput =
  | {
      readonly grant: TokenGrant
      readonly issuedAt: Date
      readonly source: "authorization"
    }
  | {
      readonly claimId: RefreshClaimId
      readonly grant: TokenGrant
      readonly issuedAt: Date
      readonly source: "refresh"
    }

export type RefreshFailure = {
  readonly claimId: RefreshClaimId
  readonly installedAppId: InstalledAppId
  readonly message: string
  readonly occurredAt: Date
}

export interface OAuthStore {
  claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null>
  consumeState(stateHash: OAuthStateHash, now: Date): Promise<boolean>
  getTokens(): Promise<StoredTokens | null>
  recordRefreshFailure(failure: RefreshFailure): Promise<void>
  saveState(stateHash: OAuthStateHash, expiresAt: Date): Promise<void>
  saveTokens(input: SaveTokensInput): Promise<StoredTokens>
}

export interface SmartThingsClient {
  buildAuthorizationUrl(state: string): URL
  exchangeCode(code: string): Promise<TokenGrant>
  refresh(refreshToken: string): Promise<TokenGrant>
}
