import {
  type AuthorizationSaveTokensInput,
  type ConnectionAccessPolicy,
  type ConnectionAuthentication,
  type InstalledAppId,
  type OAuthAuthorization,
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
import {
  type GrowfulTokenHash,
  GrowfulTokenSchema,
  hashGrowfulToken,
} from "../../src/security/growful-token.js"

type StoredOAuthState = {
  readonly consentedAt: Date
  readonly expiresAt: Date
  readonly policyVersion: string
  readonly privateBetaInviteGeneration: string | null
  readonly privateBetaUsername: string | null
  readonly requestedScopes: readonly SmartThingsScope[]
}

type MemoryConnection = {
  growfulTokenCreatedAt: Date
  growfulTokenHash: GrowfulTokenHash
  policyVersion: string
  privateBetaInviteGeneration: string | null
  privateBetaUsername: string | null
  refreshClaimedUntil: Date | null
  refreshClaimId: RefreshClaimId | null
  tokens: StoredTokens
}

export const memoryStoreGrowfulToken = GrowfulTokenSchema.parse(
  `grw_st_${Buffer.alloc(32, 5).toString("base64url")}`,
)

export class MemoryOAuthStore implements OAuthStore {
  readonly connections = new Map<InstalledAppId, MemoryConnection>()
  readonly failures: RefreshFailure[] = []
  readonly states = new Map<OAuthStateHash, StoredOAuthState>()

  async authenticate(growfulTokenHash: GrowfulTokenHash): Promise<ConnectionAuthentication | null> {
    for (const [installedAppId, connection] of this.connections) {
      if (connection.growfulTokenHash === growfulTokenHash) {
        return {
          installedAppId,
          policyVersion: connection.policyVersion,
          privateBetaInviteGeneration: connection.privateBetaInviteGeneration,
          privateBetaUsername: connection.privateBetaUsername,
        }
      }
    }
    return null
  }

  async claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null> {
    const candidates =
      claim.kind === "forced"
        ? [this.connections.get(claim.installedAppId)].filter(
            (connection): connection is MemoryConnection => connection !== undefined,
          )
        : [...this.connections.values()].sort(
            (left, right) => left.tokens.expiresAt.getTime() - right.tokens.expiresAt.getTime(),
          )
    for (const connection of candidates) {
      const claimAvailable =
        connection.refreshClaimedUntil === null ||
        connection.refreshClaimedUntil.getTime() <= claim.now.getTime()
      const due =
        claim.kind === "forced" ||
        connection.tokens.expiresAt.getTime() <= claim.now.getTime() + claim.refreshBeforeExpiryMs
      const expectedTokenMatches =
        claim.kind === "due" || connection.tokens.accessToken === claim.expectedAccessToken
      if (!claimAvailable || !due || !expectedTokenMatches) {
        continue
      }
      connection.refreshClaimedUntil = new Date(claim.now.getTime() + claim.leaseMs)
      connection.refreshClaimId = claim.claimId
      return connection.tokens
    }
    return null
  }

  async consumeState(stateHash: OAuthStateHash, now: Date): Promise<OAuthAuthorization | null> {
    const state = this.states.get(stateHash)
    this.states.delete(stateHash)
    return state !== undefined && state.expiresAt.getTime() > now.getTime() ? state : null
  }

  async deleteConnection(installedAppId: InstalledAppId): Promise<boolean> {
    return this.connections.delete(installedAppId)
  }

  async deleteExpiredStates(now: Date): Promise<number> {
    let deletedCount = 0
    for (const [stateHash, state] of this.states) {
      if (state.expiresAt.getTime() <= now.getTime() && this.states.delete(stateHash)) {
        deletedCount += 1
      }
    }
    return deletedCount
  }

  async getTokens(installedAppId: InstalledAppId): Promise<StoredTokens | null> {
    return this.connections.get(installedAppId)?.tokens ?? null
  }

  async recordRefreshFailure(failure: RefreshFailure): Promise<void> {
    const connection = this.connections.get(failure.installedAppId)
    if (connection?.refreshClaimId === failure.claimId) {
      this.failures.push(failure)
    }
  }

  async revokeUnauthorizedConnections(accessPolicy: ConnectionAccessPolicy): Promise<number> {
    let deletedCount = 0
    for (const [installedAppId, connection] of this.connections) {
      const inactiveInvite =
        accessPolicy.privateBetaUsernames !== null &&
        (connection.privateBetaUsername === null ||
          !accessPolicy.privateBetaUsernames.includes(connection.privateBetaUsername))
      if (
        (connection.policyVersion !== accessPolicy.policyVersion || inactiveInvite) &&
        this.connections.delete(installedAppId)
      ) {
        deletedCount += 1
      }
    }
    return deletedCount
  }

  async replaceGrowfulToken(
    installedAppId: InstalledAppId,
    growfulTokenHash: GrowfulTokenHash,
    createdAt: Date,
  ): Promise<boolean> {
    const connection = this.connections.get(installedAppId)
    if (connection === undefined) {
      return false
    }
    connection.growfulTokenCreatedAt = createdAt
    connection.growfulTokenHash = growfulTokenHash
    return true
  }

  async saveState(
    stateHash: OAuthStateHash,
    expiresAt: Date,
    authorization: OAuthAuthorization,
  ): Promise<void> {
    this.states.set(stateHash, { ...authorization, expiresAt })
  }

  async saveAuthorizationTokensIfAccessActive(
    input: AuthorizationSaveTokensInput,
  ): Promise<StoredTokens> {
    return this.saveTokens(input)
  }

  async saveTokens(input: SaveTokensInput): Promise<StoredTokens> {
    const existing = this.connections.get(input.grant.installedAppId)
    if (input.source === "refresh" && existing?.refreshClaimId !== input.claimId) {
      throw new StaleRefreshClaimError()
    }
    const tokens: StoredTokens = {
      accessToken: input.grant.accessToken,
      expiresAt: new Date(input.issuedAt.getTime() + input.grant.expiresInSeconds * 1_000),
      installedAppId: input.grant.installedAppId,
      lastRefreshedAt: input.source === "refresh" ? input.issuedAt : null,
      refreshToken: input.grant.refreshToken,
      scopes: input.grant.scopes,
      tokenType: input.grant.tokenType,
    }
    const growfulTokenCreatedAt =
      input.source === "authorization"
        ? input.growfulTokenCreatedAt
        : (existing?.growfulTokenCreatedAt ?? input.issuedAt)
    const growfulTokenHash =
      input.source === "authorization"
        ? input.growfulTokenHash
        : (existing?.growfulTokenHash ?? hashGrowfulToken(memoryStoreGrowfulToken))
    this.connections.set(input.grant.installedAppId, {
      growfulTokenCreatedAt,
      growfulTokenHash,
      policyVersion:
        input.source === "authorization"
          ? input.authorization.policyVersion
          : (existing?.policyVersion ?? "test-policy"),
      privateBetaInviteGeneration:
        input.source === "authorization"
          ? input.authorization.privateBetaInviteGeneration
          : (existing?.privateBetaInviteGeneration ?? null),
      privateBetaUsername:
        input.source === "authorization"
          ? input.authorization.privateBetaUsername
          : (existing?.privateBetaUsername ?? null),
      refreshClaimedUntil: null,
      refreshClaimId: null,
      tokens,
    })
    return tokens
  }

  seedTokens(
    tokens: StoredTokens,
    growfulTokenHash: GrowfulTokenHash = hashGrowfulToken(memoryStoreGrowfulToken),
    identity: {
      readonly policyVersion: string
      readonly privateBetaInviteGeneration?: string | null
      readonly privateBetaUsername: string | null
    } = {
      policyVersion: "test-policy",
      privateBetaUsername: null,
    },
  ): void {
    this.connections.set(tokens.installedAppId, {
      growfulTokenCreatedAt: new Date("2026-07-19T00:00:00.000Z"),
      growfulTokenHash,
      policyVersion: identity.policyVersion,
      privateBetaInviteGeneration: identity.privateBetaInviteGeneration ?? null,
      privateBetaUsername: identity.privateBetaUsername,
      refreshClaimedUntil: null,
      refreshClaimId: null,
      tokens,
    })
  }

  get tokens(): StoredTokens | null {
    return this.connections.values().next().value?.tokens ?? null
  }

  set tokens(tokens: StoredTokens | null) {
    this.connections.clear()
    if (tokens !== null) {
      this.seedTokens(tokens)
    }
  }
}
