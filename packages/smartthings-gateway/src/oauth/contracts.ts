import { z } from "zod"
import type { GrowfulTokenHash } from "../security/growful-token.js"
import type { SmartThingsScope } from "./smartthings-scope.js"

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
  readonly scopes: readonly string[]
  readonly tokenType: string
}

export type StoredTokens = {
  readonly accessToken: string
  readonly expiresAt: Date
  readonly installedAppId: InstalledAppId
  readonly lastRefreshedAt: Date | null
  readonly refreshToken: string
  readonly scopes: readonly string[]
  readonly tokenType: string
}

export type ConnectionStatus = {
  readonly connected: true
  readonly expiresAt: string
  readonly grantedScopes: readonly string[]
  readonly lastRefreshedAt: string | null
}

export type ConnectionAccessPolicy = {
  readonly policyVersion: string
  readonly privateBetaUsernames: readonly string[] | null
}

export type ConnectionAuthentication = {
  readonly installedAppId: InstalledAppId
  readonly policyVersion: string
  readonly privateBetaUsername: string | null
}

export type OAuthAuthorization = {
  readonly consentedAt: Date
  readonly policyVersion: string
  readonly privateBetaUsername: string | null
  readonly requestedScopes: readonly SmartThingsScope[]
}

export type RefreshClaim =
  | {
      readonly claimId: RefreshClaimId
      readonly kind: "due"
      readonly leaseMs: number
      readonly now: Date
      readonly refreshBeforeExpiryMs: number
    }
  | {
      readonly claimId: RefreshClaimId
      readonly expectedAccessToken: string
      readonly installedAppId: InstalledAppId
      readonly kind: "forced"
      readonly leaseMs: number
      readonly now: Date
    }

export type SaveTokensInput =
  | {
      readonly grant: TokenGrant
      readonly growfulTokenCreatedAt: Date
      readonly growfulTokenHash: GrowfulTokenHash
      readonly issuedAt: Date
      readonly authorization: OAuthAuthorization
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
  authenticate(growfulTokenHash: GrowfulTokenHash): Promise<ConnectionAuthentication | null>
  claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null>
  consumeState(stateHash: OAuthStateHash, now: Date): Promise<OAuthAuthorization | null>
  deleteConnection(installedAppId: InstalledAppId): Promise<boolean>
  deleteExpiredStates(now: Date): Promise<number>
  getTokens(installedAppId: InstalledAppId): Promise<StoredTokens | null>
  recordRefreshFailure(failure: RefreshFailure): Promise<void>
  revokeUnauthorizedConnections(accessPolicy: ConnectionAccessPolicy): Promise<number>
  replaceGrowfulToken(
    installedAppId: InstalledAppId,
    growfulTokenHash: GrowfulTokenHash,
    createdAt: Date,
  ): Promise<boolean>
  saveState(
    stateHash: OAuthStateHash,
    expiresAt: Date,
    authorization: OAuthAuthorization,
  ): Promise<void>
  saveTokens(input: SaveTokensInput): Promise<StoredTokens>
}

export interface SmartThingsClient {
  buildAuthorizationUrl(state: string, scopes: readonly SmartThingsScope[]): URL
  exchangeCode(code: string): Promise<TokenGrant>
  refresh(refreshToken: string): Promise<TokenGrant>
}
