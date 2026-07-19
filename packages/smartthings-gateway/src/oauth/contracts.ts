import { z } from "zod"

export const InstalledAppIdSchema = z.string().min(1).brand("InstalledAppId")
export const OAuthStateHashSchema = z.string().length(64).brand("OAuthStateHash")

export type InstalledAppId = z.infer<typeof InstalledAppIdSchema>
export type OAuthStateHash = z.infer<typeof OAuthStateHashSchema>

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
  readonly leaseMs: number
  readonly now: Date
  readonly refreshBeforeExpiryMs: number
}

export type SaveTokensInput = {
  readonly grant: TokenGrant
  readonly issuedAt: Date
  readonly source: "authorization" | "refresh"
}

export type RefreshFailure = {
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
