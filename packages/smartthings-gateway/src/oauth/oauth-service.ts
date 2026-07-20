import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { ConnectionStatus, OAuthStore, SmartThingsClient, StoredTokens } from "./contracts.js"
import { OAuthStateHashSchema, RefreshClaimIdSchema } from "./contracts.js"

const oauthStateLifetimeMs = 10 * 60 * 1_000

export class InvalidOAuthStateError extends Error {
  override readonly name = "InvalidOAuthStateError"

  constructor() {
    super("OAuth state is invalid or expired")
  }
}

export type OAuthServiceOptions = {
  readonly client: SmartThingsClient
  readonly now?: () => Date
  readonly refreshBeforeExpiryMs: number
  readonly refreshLeaseMs: number
  readonly stateGenerator?: () => string
  readonly store: OAuthStore
}

export class OAuthService {
  private readonly now: () => Date
  private readonly stateGenerator: () => string

  constructor(private readonly options: OAuthServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.stateGenerator = options.stateGenerator ?? (() => randomBytes(32).toString("base64url"))
  }

  async startAuthorization(): Promise<URL> {
    const state = this.stateGenerator()
    const now = this.now()
    await this.options.store.saveState(
      this.hashState(state),
      new Date(now.getTime() + oauthStateLifetimeMs),
    )
    return this.options.client.buildAuthorizationUrl(state)
  }

  async completeAuthorization(code: string, state: string): Promise<ConnectionStatus> {
    await this.consumeState(state)
    const grant = await this.options.client.exchangeCode(code)
    const tokens = await this.options.store.saveTokens({
      grant,
      issuedAt: this.now(),
      source: "authorization",
    })
    return this.toConnectionStatus(tokens)
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    const tokens = await this.options.store.getTokens()
    return tokens === null ? { connected: false } : this.toConnectionStatus(tokens)
  }

  async refreshIfDue(): Promise<boolean> {
    const now = this.now()
    const claimId = RefreshClaimIdSchema.parse(randomUUID())
    const tokens = await this.options.store.claimTokensForRefresh({
      claimId,
      leaseMs: this.options.refreshLeaseMs,
      now,
      refreshBeforeExpiryMs: this.options.refreshBeforeExpiryMs,
    })
    if (tokens === null) {
      return false
    }

    try {
      const grant = await this.options.client.refresh(tokens.refreshToken)
      await this.options.store.saveTokens({ claimId, grant, issuedAt: now, source: "refresh" })
      return true
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

  async cancelAuthorization(state: string): Promise<void> {
    await this.consumeState(state)
  }

  private async consumeState(state: string): Promise<void> {
    const consumed = await this.options.store.consumeState(this.hashState(state), this.now())
    if (!consumed) {
      throw new InvalidOAuthStateError()
    }
  }

  private hashState(state: string) {
    return OAuthStateHashSchema.parse(createHash("sha256").update(state, "utf8").digest("hex"))
  }

  private toConnectionStatus(tokens: StoredTokens): ConnectionStatus {
    return {
      connected: true,
      expiresAt: tokens.expiresAt.toISOString(),
      lastRefreshedAt: tokens.lastRefreshedAt?.toISOString() ?? null,
    }
  }
}
