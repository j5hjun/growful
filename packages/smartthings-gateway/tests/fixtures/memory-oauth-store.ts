import {
  type InstalledAppId,
  type OAuthStateHash,
  type OAuthStore,
  type RefreshClaim,
  type RefreshClaimId,
  type RefreshFailure,
  type SaveTokensInput,
  StaleRefreshClaimError,
  type StoredTokens,
} from "../../src/oauth/contracts.js"
import type { SmartThingsScope } from "../../src/oauth/smartthings-scope.js"

type StoredOAuthState = {
  readonly expiresAt: Date
  readonly requestedScopes: readonly SmartThingsScope[]
}

export class MemoryOAuthStore implements OAuthStore {
  readonly failures: RefreshFailure[] = []
  readonly states = new Map<OAuthStateHash, StoredOAuthState>()
  tokens: StoredTokens | null = null
  private refreshClaimedUntil: Date | null = null
  private refreshClaimId: RefreshClaimId | null = null

  async claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null> {
    const tokens = this.tokens
    const dueAt =
      claim.refreshBeforeExpiryMs === null
        ? null
        : new Date(claim.now.getTime() + claim.refreshBeforeExpiryMs)
    const claimAvailable =
      this.refreshClaimedUntil === null || this.refreshClaimedUntil.getTime() <= claim.now.getTime()
    if (
      tokens === null ||
      (dueAt !== null && tokens.expiresAt.getTime() > dueAt.getTime()) ||
      (claim.expectedAccessToken !== undefined &&
        tokens.accessToken !== claim.expectedAccessToken) ||
      !claimAvailable
    ) {
      return null
    }
    this.refreshClaimedUntil = new Date(claim.now.getTime() + claim.leaseMs)
    this.refreshClaimId = claim.claimId
    return tokens
  }

  async consumeState(
    stateHash: OAuthStateHash,
    now: Date,
  ): Promise<readonly SmartThingsScope[] | null> {
    const state = this.states.get(stateHash)
    this.states.delete(stateHash)
    return state !== undefined && state.expiresAt.getTime() >= now.getTime()
      ? state.requestedScopes
      : null
  }

  async getTokens(): Promise<StoredTokens | null> {
    return this.tokens
  }

  async recordRefreshFailure(failure: RefreshFailure): Promise<void> {
    if (this.refreshClaimId !== failure.claimId) {
      return
    }
    this.failures.push(failure)
  }

  async saveState(
    stateHash: OAuthStateHash,
    expiresAt: Date,
    requestedScopes: readonly SmartThingsScope[],
  ): Promise<void> {
    this.states.set(stateHash, { expiresAt, requestedScopes })
  }

  async saveTokens(input: SaveTokensInput): Promise<StoredTokens> {
    if (input.source === "refresh" && this.refreshClaimId !== input.claimId) {
      throw new StaleRefreshClaimError()
    }
    const lastRefreshedAt = input.source === "refresh" ? input.issuedAt : null
    this.tokens = {
      accessToken: input.grant.accessToken,
      expiresAt: new Date(input.issuedAt.getTime() + input.grant.expiresInSeconds * 1_000),
      installedAppId: input.grant.installedAppId,
      lastRefreshedAt,
      refreshToken: input.grant.refreshToken,
      scopes: input.grant.scopes,
      tokenType: input.grant.tokenType,
    }
    this.refreshClaimedUntil = null
    this.refreshClaimId = null
    return this.tokens
  }

  seedTokens(tokens: StoredTokens): void {
    this.tokens = tokens
  }

  get installedAppId(): InstalledAppId | null {
    return this.tokens?.installedAppId ?? null
  }
}
