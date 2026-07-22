import { randomUUID } from "node:crypto"
import type { InstalledAppId, OAuthStore, SmartThingsClient, StoredTokens } from "./contracts.js"
import { RefreshClaimIdSchema } from "./contracts.js"
import { ensureOAuthScopesWithin } from "./oauth-scope-policy.js"

export type RefreshBatchResult = {
  readonly failureNames: readonly string[]
  readonly refreshedCount: number
}

export type OAuthRefreshServiceOptions = {
  readonly client: SmartThingsClient
  readonly now: () => Date
  readonly refreshBeforeExpiryMs: number
  readonly refreshLeaseMs: number
  readonly store: OAuthStore
}

export class OAuthRefreshService {
  constructor(private readonly options: OAuthRefreshServiceOptions) {}

  async refreshDueConnections(): Promise<RefreshBatchResult> {
    const failureNames: string[] = []
    let refreshedCount = 0
    while (true) {
      const now = this.options.now()
      const claimId = RefreshClaimIdSchema.parse(randomUUID())
      const tokens = await this.options.store.claimTokensForRefresh({
        claimId,
        kind: "due",
        leaseMs: this.options.refreshLeaseMs,
        now,
        refreshBeforeExpiryMs: this.options.refreshBeforeExpiryMs,
      })
      if (tokens === null) {
        return { failureNames, refreshedCount }
      }
      try {
        await this.refreshClaimedTokens(tokens, claimId, now)
        refreshedCount += 1
      } catch (error) {
        failureNames.push(error instanceof Error ? error.name : "UnknownError")
      }
    }
  }

  async refreshAccessToken(
    installedAppId: InstalledAppId,
    rejectedAccessToken: string,
  ): Promise<boolean> {
    const now = this.options.now()
    const claimId = RefreshClaimIdSchema.parse(randomUUID())
    const tokens = await this.options.store.claimTokensForRefresh({
      claimId,
      expectedAccessToken: rejectedAccessToken,
      installedAppId,
      kind: "forced",
      leaseMs: this.options.refreshLeaseMs,
      now,
    })
    if (tokens === null) {
      return false
    }
    await this.refreshClaimedTokens(tokens, claimId, now)
    return true
  }

  private async refreshClaimedTokens(
    tokens: StoredTokens,
    claimId: ReturnType<typeof RefreshClaimIdSchema.parse>,
    now: Date,
  ): Promise<void> {
    try {
      const grant = await this.options.client.refresh(tokens.refreshToken)
      ensureOAuthScopesWithin(grant.scopes, tokens.scopes)
      await this.options.store.saveTokens({ claimId, grant, issuedAt: now, source: "refresh" })
    } catch (error) {
      await this.options.store.recordRefreshFailure({
        claimId,
        installedAppId: tokens.installedAppId,
        message: error instanceof Error ? error.name : "UnknownError",
        occurredAt: now,
      })
      throw error
    }
  }
}
