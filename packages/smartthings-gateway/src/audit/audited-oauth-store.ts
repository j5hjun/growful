import type {
  AuthorizationSaveTokensInput,
  ConnectionAccessPolicy,
  ConnectionAdmission,
  ConnectionAuthentication,
  InstalledAppId,
  OAuthAuthorization,
  OAuthStateHash,
  OAuthStore,
  RefreshClaim,
  RefreshFailure,
  SaveTokensInput,
  StoredTokens,
} from "../oauth/contracts.js"
import type { GrowfulTokenHash } from "../security/growful-token.js"
import { type AuditSink, hashAuditSubject } from "./audit-event.js"

export type AuditedOAuthStoreOptions = {
  readonly auditSink: AuditSink
  readonly now?: () => Date
  readonly store: OAuthStore
}

export class AuditedOAuthStore implements OAuthStore {
  constructor(private readonly options: AuditedOAuthStoreOptions) {}

  async authenticate(
    growfulTokenHash: GrowfulTokenHash,
    admission?: ConnectionAdmission,
  ): Promise<ConnectionAuthentication | null> {
    const authentication = await this.options.store.authenticate(growfulTokenHash, admission)
    if (authentication !== null) {
      await this.appendAccess("connection.access", authentication.installedAppId)
    }
    return authentication
  }

  async claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null> {
    return this.options.store.claimTokensForRefresh(claim)
  }

  async consumeState(stateHash: OAuthStateHash, now: Date): Promise<OAuthAuthorization | null> {
    return this.options.store.consumeState(stateHash, now)
  }

  async deleteConnection(installedAppId: InstalledAppId): Promise<boolean> {
    return this.options.store.deleteConnection(installedAppId)
  }

  async deleteExpiredStates(now: Date): Promise<number> {
    return this.options.store.deleteExpiredStates(now)
  }

  async getTokens(installedAppId: InstalledAppId): Promise<StoredTokens | null> {
    const tokens = await this.options.store.getTokens(installedAppId)
    if (tokens !== null) {
      await this.appendAccess("token.read", installedAppId)
    }
    return tokens
  }

  async recordRefreshFailure(failure: RefreshFailure): Promise<void> {
    await this.options.store.recordRefreshFailure(failure)
  }

  async revokeUnauthorizedConnections(accessPolicy: ConnectionAccessPolicy): Promise<number> {
    return this.options.store.revokeUnauthorizedConnections(accessPolicy)
  }

  async replaceGrowfulToken(
    installedAppId: InstalledAppId,
    growfulTokenHash: GrowfulTokenHash,
    createdAt: Date,
  ): Promise<boolean> {
    return this.options.store.replaceGrowfulToken(installedAppId, growfulTokenHash, createdAt)
  }

  async saveState(
    stateHash: OAuthStateHash,
    expiresAt: Date,
    authorization: OAuthAuthorization,
  ): Promise<void> {
    await this.options.store.saveState(stateHash, expiresAt, authorization)
  }

  async saveAuthorizationTokensIfAccessActive(
    input: AuthorizationSaveTokensInput,
  ): Promise<StoredTokens | null> {
    return this.options.store.saveAuthorizationTokensIfAccessActive(input)
  }

  async saveTokens(input: SaveTokensInput): Promise<StoredTokens> {
    return this.options.store.saveTokens(input)
  }

  private async appendAccess(
    action: "connection.access" | "token.read",
    installedAppId: InstalledAppId,
  ): Promise<void> {
    await this.options.auditSink.append({
      action,
      actorIdHash: null,
      actorType: "gateway_service",
      affectedCount: 1,
      occurredAt: this.options.now?.() ?? new Date(),
      outcome: "succeeded",
      subjectHash: hashAuditSubject({ installedAppId }),
      ticketHash: null,
    })
  }
}
