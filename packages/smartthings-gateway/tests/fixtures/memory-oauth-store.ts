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

export class MemoryOAuthStore implements OAuthStore {
  readonly failures: RefreshFailure[] = []
  readonly states = new Map<OAuthStateHash, Date>()
  tokens: StoredTokens | null = null
  private refreshClaimedUntil: Date | null = null
  private refreshClaimId: RefreshClaimId | null = null

  async claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null> {
    const tokens = this.tokens
    const dueAt = new Date(claim.now.getTime() + claim.refreshBeforeExpiryMs)
    const claimAvailable =
      this.refreshClaimedUntil === null || this.refreshClaimedUntil.getTime() <= claim.now.getTime()
    if (tokens === null || tokens.expiresAt.getTime() > dueAt.getTime() || !claimAvailable) {
      return null
    }
    this.refreshClaimedUntil = new Date(claim.now.getTime() + claim.leaseMs)
    this.refreshClaimId = claim.claimId
    return tokens
  }

  async consumeState(stateHash: OAuthStateHash, now: Date): Promise<boolean> {
    const expiresAt = this.states.get(stateHash)
    this.states.delete(stateHash)
    return expiresAt !== undefined && expiresAt.getTime() >= now.getTime()
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

  async saveState(stateHash: OAuthStateHash, expiresAt: Date): Promise<void> {
    this.states.set(stateHash, expiresAt)
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
      scope: input.grant.scope,
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
