import { createHash, randomBytes } from "node:crypto"
import type { PrivateBetaInviteAccess } from "../private-beta/invite-access.js"
import {
  type GrowfulToken,
  generateGrowfulToken,
  hashGrowfulToken,
} from "../security/growful-token.js"
import type {
  ConnectionAccessPolicy,
  ConnectionStatus,
  InstalledAppId,
  OAuthAuthorization,
  OAuthStore,
  SmartThingsClient,
  StoredTokens,
} from "./contracts.js"
import { OAuthStateHashSchema } from "./contracts.js"
import { OAuthRefreshService, type RefreshBatchResult } from "./oauth-refresh-service.js"
import { ensureOAuthScopesWithin } from "./oauth-scope-policy.js"

export type { RefreshBatchResult } from "./oauth-refresh-service.js"
export { OAuthScopeMismatchError } from "./oauth-scope-policy.js"

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

export type AuthorizationCompletion = {
  readonly connection: ConnectionStatus
  readonly growfulToken: GrowfulToken
}

export type OAuthServiceOptions = {
  readonly accessPolicy?: OAuthServiceAccessPolicy
  readonly client: SmartThingsClient
  readonly growfulTokenGenerator?: () => GrowfulToken
  readonly now?: () => Date
  readonly refreshBeforeExpiryMs: number
  readonly refreshLeaseMs: number
  readonly stateGenerator?: () => string
  readonly store: OAuthStore
}

export type OAuthServiceAccessPolicy = {
  readonly policyVersion: string
  readonly privateBetaAccess: PrivateBetaInviteAccess | null
}

export class OAuthService {
  private readonly accessPolicy: OAuthServiceAccessPolicy
  private readonly growfulTokenGenerator: () => GrowfulToken
  private readonly now: () => Date
  private readonly refreshService: OAuthRefreshService
  private readonly stateGenerator: () => string

  constructor(private readonly options: OAuthServiceOptions) {
    this.accessPolicy = options.accessPolicy ?? {
      policyVersion: "test-policy",
      privateBetaAccess: null,
    }
    this.growfulTokenGenerator = options.growfulTokenGenerator ?? generateGrowfulToken
    this.now = options.now ?? (() => new Date())
    this.refreshService = new OAuthRefreshService({
      client: options.client,
      now: this.now,
      refreshBeforeExpiryMs: options.refreshBeforeExpiryMs,
      refreshLeaseMs: options.refreshLeaseMs,
      store: options.store,
    })
    this.stateGenerator = options.stateGenerator ?? (() => randomBytes(32).toString("base64url"))
  }

  async authenticate(growfulToken: GrowfulToken): Promise<InstalledAppId | null> {
    const authentication = await this.options.store.authenticate(hashGrowfulToken(growfulToken))
    if (authentication === null || !(await this.isAuthorizationActive(authentication))) {
      return null
    }
    return authentication.installedAppId
  }

  async startAuthorization(
    authorization: Omit<OAuthAuthorization, "consentedAt" | "privateBetaInviteGeneration">,
  ): Promise<URL> {
    const activeAccess = await this.resolveAuthorizationAccess(authorization)
    if (activeAccess === null) {
      throw new InvalidOAuthStateError()
    }
    const state = this.stateGenerator()
    const now = this.now()
    const storedAuthorization: OAuthAuthorization = {
      ...authorization,
      consentedAt: now,
      privateBetaInviteGeneration: activeAccess.privateBetaInviteGeneration,
    }
    await this.options.store.saveState(
      this.hashState(state),
      new Date(now.getTime() + oauthStateLifetimeMs),
      storedAuthorization,
    )
    return this.options.client.buildAuthorizationUrl(state, authorization.requestedScopes)
  }

  async completeAuthorization(code: string, state: string): Promise<AuthorizationCompletion> {
    const authorization = await this.consumeState(state)
    if (!(await this.isAuthorizationActive(authorization))) {
      throw new InvalidOAuthStateError()
    }
    const grant = await this.options.client.exchangeCode(code)
    ensureOAuthScopesWithin(grant.scopes, authorization.requestedScopes)
    const issuedAt = this.now()
    const growfulToken = this.growfulTokenGenerator()
    const tokens = await this.options.store.saveAuthorizationTokensIfAccessActive({
      grant,
      growfulTokenCreatedAt: issuedAt,
      growfulTokenHash: hashGrowfulToken(growfulToken),
      issuedAt,
      authorization,
      source: "authorization",
    })
    if (tokens === null) {
      throw new InvalidOAuthStateError()
    }
    return { connection: this.toConnectionStatus(tokens), growfulToken }
  }

  async getConnectionStatus(installedAppId: InstalledAppId): Promise<ConnectionStatus> {
    return this.toConnectionStatus(await this.requireTokens(installedAppId))
  }

  async getAccessToken(installedAppId: InstalledAppId): Promise<string> {
    return (await this.requireTokens(installedAppId)).accessToken
  }

  async purgeExpiredAuthorizationStates(): Promise<number> {
    return this.options.store.deleteExpiredStates(this.now())
  }

  async revokeUnauthorizedConnections(): Promise<number> {
    const accessPolicy: ConnectionAccessPolicy = {
      policyVersion: this.accessPolicy.policyVersion,
      privateBetaUsernames:
        this.accessPolicy.privateBetaAccess === null
          ? null
          : await this.accessPolicy.privateBetaAccess.listActiveUsernames(),
    }
    return this.options.store.revokeUnauthorizedConnections(accessPolicy)
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

  async forgetConnection(installedAppId: InstalledAppId): Promise<void> {
    await this.options.store.deleteConnection(installedAppId)
  }

  async refreshDueConnections(): Promise<RefreshBatchResult> {
    return this.refreshService.refreshDueConnections()
  }

  async refreshAccessToken(
    installedAppId: InstalledAppId,
    rejectedAccessToken: string,
  ): Promise<boolean> {
    return this.refreshService.refreshAccessToken(installedAppId, rejectedAccessToken)
  }

  async cancelAuthorization(state: string): Promise<void> {
    await this.consumeState(state)
  }

  private async requireTokens(installedAppId: InstalledAppId): Promise<StoredTokens> {
    const tokens = await this.options.store.getTokens(installedAppId)
    if (tokens === null) {
      throw new OAuthConnectionRequiredError()
    }
    return tokens
  }

  private async consumeState(state: string): Promise<OAuthAuthorization> {
    const consumed = await this.options.store.consumeState(this.hashState(state), this.now())
    if (consumed === null) {
      throw new InvalidOAuthStateError()
    }
    return consumed
  }

  private async isAuthorizationActive(
    authorization: Pick<
      OAuthAuthorization,
      "policyVersion" | "privateBetaInviteGeneration" | "privateBetaUsername"
    >,
  ): Promise<boolean> {
    const access = await this.resolveAuthorizationAccess(authorization)
    return (
      access !== null &&
      access.privateBetaInviteGeneration === authorization.privateBetaInviteGeneration
    )
  }

  private async resolveAuthorizationAccess(
    authorization: Pick<OAuthAuthorization, "policyVersion" | "privateBetaUsername">,
  ): Promise<{ readonly privateBetaInviteGeneration: string | null } | null> {
    if (authorization.policyVersion !== this.accessPolicy.policyVersion) {
      return null
    }
    if (this.accessPolicy.privateBetaAccess === null) {
      return authorization.privateBetaUsername === null
        ? { privateBetaInviteGeneration: null }
        : null
    }
    if (authorization.privateBetaUsername === null) return null
    const invite = await this.accessPolicy.privateBetaAccess.resolveActiveInvite(
      authorization.privateBetaUsername,
    )
    return invite === null ? null : { privateBetaInviteGeneration: invite.generation }
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
