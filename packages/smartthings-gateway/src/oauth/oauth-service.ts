import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  type GrowfulToken,
  generateGrowfulToken,
  hashGrowfulToken,
} from "../security/growful-token.js"
import type {
  ConnectionStatus,
  InstalledAppId,
  OAuthStore,
  SmartThingsClient,
  StoredTokens,
} from "./contracts.js"
import { OAuthStateHashSchema, RefreshClaimIdSchema } from "./contracts.js"
import { areScopesWithin, type SmartThingsScope } from "./smartthings-scope.js"

const oauthStateLifetimeMs = 10 * 60 * 1_000

export class InvalidOAuthStateError extends Error {
  override readonly name = "InvalidOAuthStateError"

  constructor() {
    super("OAuth state is invalid or expired")
  }
}

export class OAuthConnectionRequiredError extends Error {
  override readonly name = "OAuthConnectionRequiredError"

  constructor() {
    super("SmartThings OAuth connection is required")
  }
}

export class OAuthScopeMismatchError extends Error {
  override readonly name = "OAuthScopeMismatchError"

  constructor() {
    super("SmartThings returned scopes outside the authorized boundary")
  }
}

export type AuthorizationCompletion = {
  readonly connection: ConnectionStatus
  readonly growfulToken: GrowfulToken
}

export type RefreshBatchResult = {
  readonly failureNames: readonly string[]
  readonly refreshedCount: number
}

export type OAuthServiceOptions = {
  readonly client: SmartThingsClient
  readonly growfulTokenGenerator?: () => GrowfulToken
  readonly now?: () => Date
  readonly refreshBeforeExpiryMs: number
  readonly refreshLeaseMs: number
  readonly stateGenerator?: () => string
  readonly store: OAuthStore
}

export class OAuthService {
  private readonly growfulTokenGenerator: () => GrowfulToken
  private readonly now: () => Date
  private readonly stateGenerator: () => string

  constructor(private readonly options: OAuthServiceOptions) {
    this.growfulTokenGenerator = options.growfulTokenGenerator ?? generateGrowfulToken
    this.now = options.now ?? (() => new Date())
    this.stateGenerator = options.stateGenerator ?? (() => randomBytes(32).toString("base64url"))
  }

  async authenticate(growfulToken: GrowfulToken): Promise<InstalledAppId | null> {
    return this.options.store.authenticate(hashGrowfulToken(growfulToken))
  }

  async startAuthorization(scopes: readonly SmartThingsScope[]): Promise<URL> {
    const state = this.stateGenerator()
    const now = this.now()
    await this.options.store.saveState(
      this.hashState(state),
      new Date(now.getTime() + oauthStateLifetimeMs),
      scopes,
    )
    return this.options.client.buildAuthorizationUrl(state, scopes)
  }

  async completeAuthorization(code: string, state: string): Promise<AuthorizationCompletion> {
    const requestedScopes = await this.consumeState(state)
    const grant = await this.options.client.exchangeCode(code)
    this.ensureScopesWithin(grant.scopes, requestedScopes)
    const issuedAt = this.now()
    const growfulToken = this.growfulTokenGenerator()
    const tokens = await this.options.store.saveTokens({
      grant,
      growfulTokenCreatedAt: issuedAt,
      growfulTokenHash: hashGrowfulToken(growfulToken),
      issuedAt,
      source: "authorization",
    })
    return { connection: this.toConnectionStatus(tokens), growfulToken }
  }

  async getConnectionStatus(installedAppId: InstalledAppId): Promise<ConnectionStatus> {
    return this.toConnectionStatus(await this.requireTokens(installedAppId))
  }

  async getAccessToken(installedAppId: InstalledAppId): Promise<string> {
    return (await this.requireTokens(installedAppId)).accessToken
  }

  async rotateGrowfulToken(installedAppId: InstalledAppId): Promise<GrowfulToken> {
    const growfulToken = this.growfulTokenGenerator()
    const replaced = await this.options.store.replaceGrowfulToken(
      installedAppId,
      hashGrowfulToken(growfulToken),
      this.now(),
    )
    if (!replaced) {
      throw new OAuthConnectionRequiredError()
    }
    return growfulToken
  }

  async disconnect(installedAppId: InstalledAppId): Promise<void> {
    const deleted = await this.options.store.deleteConnection(installedAppId)
    if (!deleted) {
      throw new OAuthConnectionRequiredError()
    }
  }

  async refreshDueConnections(): Promise<RefreshBatchResult> {
    const failureNames: string[] = []
    let refreshedCount = 0
    while (true) {
      const now = this.now()
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
    const now = this.now()
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

  async cancelAuthorization(state: string): Promise<void> {
    await this.consumeState(state)
  }

  private async refreshClaimedTokens(
    tokens: StoredTokens,
    claimId: ReturnType<typeof RefreshClaimIdSchema.parse>,
    now: Date,
  ): Promise<void> {
    try {
      const grant = await this.options.client.refresh(tokens.refreshToken)
      this.ensureScopesWithin(grant.scopes, tokens.scopes)
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

  private async requireTokens(installedAppId: InstalledAppId): Promise<StoredTokens> {
    const tokens = await this.options.store.getTokens(installedAppId)
    if (tokens === null) {
      throw new OAuthConnectionRequiredError()
    }
    return tokens
  }

  private async consumeState(state: string): Promise<readonly SmartThingsScope[]> {
    const consumed = await this.options.store.consumeState(this.hashState(state), this.now())
    if (consumed === null) {
      throw new InvalidOAuthStateError()
    }
    return consumed
  }

  private ensureScopesWithin(scopes: readonly string[], allowedScopes: readonly string[]): void {
    if (!areScopesWithin(scopes, allowedScopes)) {
      throw new OAuthScopeMismatchError()
    }
  }

  private hashState(state: string) {
    return OAuthStateHashSchema.parse(createHash("sha256").update(state, "utf8").digest("hex"))
  }

  private toConnectionStatus(tokens: StoredTokens): ConnectionStatus {
    return {
      connected: true,
      expiresAt: tokens.expiresAt.toISOString(),
      grantedScopes: tokens.scopes,
      lastRefreshedAt: tokens.lastRefreshedAt?.toISOString() ?? null,
    }
  }
}
