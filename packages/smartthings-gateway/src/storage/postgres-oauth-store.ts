import { type Kysely, sql } from "kysely"
import {
  type AuthorizationSaveTokensInput,
  type ConnectionAccessPolicy,
  type ConnectionAdmission,
  type ConnectionAuthentication,
  InstalledAppIdSchema,
  type OAuthAuthorization,
  type OAuthCompletionAuthorization,
  type OAuthStateHash,
  type OAuthStore,
  type RefreshClaim,
  type RefreshFailure,
  type SaveTokensInput,
  SMARTTHINGS_REAUTHORIZATION_REQUIRED,
  StaleRefreshClaimError,
  type StoredTokens,
} from "../oauth/contracts.js"
import type { PrivateBetaInvite } from "../private-beta/invite.js"
import { getConfiguredPrivateBetaInviteGeneration } from "../private-beta/invite-access.js"
import type { GrowfulTokenHash } from "../security/growful-token.js"
import type { GatewayDatabase } from "./database.js"
import { persistPostgresAuthorizationIfActive } from "./postgres-authorization-persistence.js"
import { revokePostgresUnauthorizedConnections } from "./postgres-connection-access-policy.js"
import { PostgresOAuthStateStore } from "./postgres-oauth-state-store.js"
import { PostgresRefreshClaimStore } from "./postgres-refresh-claim.js"
import { PostgresTokenCodec } from "./postgres-token-codec.js"

export type PostgresOAuthStoreOptions = {
  readonly configuredPrivateBetaInvites?: readonly PrivateBetaInvite[]
  readonly database: Kysely<GatewayDatabase>
  readonly encryptionKeyBase64: string
}

export class UnexpectedTokenSourceError extends Error {
  override readonly name = "UnexpectedTokenSourceError"

  constructor() {
    super("Unexpected token storage source")
  }
}

export class PostgresOAuthStore implements OAuthStore {
  private readonly configuredPrivateBetaGenerations: ReadonlyMap<string, string>
  private readonly database: Kysely<GatewayDatabase>
  private readonly refreshClaimStore: PostgresRefreshClaimStore
  private readonly stateStore: PostgresOAuthStateStore
  private readonly tokenCodec: PostgresTokenCodec

  constructor(options: PostgresOAuthStoreOptions) {
    this.configuredPrivateBetaGenerations = new Map(
      options.configuredPrivateBetaInvites?.map((invite) => [
        invite.username,
        getConfiguredPrivateBetaInviteGeneration(invite),
      ]),
    )
    this.database = options.database
    this.stateStore = new PostgresOAuthStateStore(options.database)
    this.tokenCodec = new PostgresTokenCodec(options.encryptionKeyBase64)
    this.refreshClaimStore = new PostgresRefreshClaimStore({
      configuredPrivateBetaGenerations: this.configuredPrivateBetaGenerations,
      database: options.database,
      tokenCodec: this.tokenCodec,
    })
  }

  async authenticate(growfulTokenHash: GrowfulTokenHash, admission?: ConnectionAdmission) {
    const row = await this.database
      .selectFrom("smartThingsConnections")
      .select([
        "installedAppId",
        "policyVersion",
        "privateBetaInviteGeneration",
        "privateBetaUsername",
      ])
      .where("growfulTokenHash", "=", growfulTokenHash)
      .executeTakeFirst()
    if (row === undefined || row.policyVersion === null) {
      return null
    }
    const authentication = {
      installedAppId: InstalledAppIdSchema.parse(row.installedAppId),
      policyVersion: row.policyVersion,
      privateBetaInviteGeneration: row.privateBetaInviteGeneration,
      privateBetaUsername: row.privateBetaUsername,
    } satisfies ConnectionAuthentication
    await admission?.(authentication.installedAppId)
    return authentication
  }

  async claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null> {
    return this.refreshClaimStore.claim(claim)
  }

  async consumeState(
    stateHash: OAuthStateHash,
    now: Date,
  ): Promise<OAuthCompletionAuthorization | null> {
    return this.stateStore.consume(stateHash, now)
  }

  async deleteConnection(installedAppId: ReturnType<typeof InstalledAppIdSchema.parse>) {
    const deleted = await this.database
      .deleteFrom("smartThingsConnections")
      .where("installedAppId", "=", installedAppId)
      .returning("installedAppId")
      .executeTakeFirst()
    return deleted !== undefined
  }

  async deleteExpiredStates(now: Date): Promise<number> {
    return this.stateStore.deleteExpired(now)
  }

  async getTokens(
    installedAppId: ReturnType<typeof InstalledAppIdSchema.parse>,
  ): Promise<StoredTokens | null> {
    const row = await this.database
      .selectFrom("smartThingsConnections")
      .selectAll()
      .where("installedAppId", "=", installedAppId)
      .executeTakeFirst()
    return row === undefined ? null : this.tokenCodec.decryptRow(row)
  }

  async recordRefreshFailure(failure: RefreshFailure): Promise<void> {
    await this.database
      .updateTable("smartThingsConnections")
      .set({
        lastRefreshError: sql<string>`case
          when last_refresh_error = ${SMARTTHINGS_REAUTHORIZATION_REQUIRED}
            then last_refresh_error
          else ${failure.message}
        end`,
      })
      .where("installedAppId", "=", failure.installedAppId)
      .where("refreshClaimId", "=", failure.claimId)
      .execute()
  }

  async revokeUnauthorizedConnections(accessPolicy: ConnectionAccessPolicy): Promise<number> {
    return revokePostgresUnauthorizedConnections(this.database, accessPolicy)
  }

  async replaceGrowfulToken(
    installedAppId: ReturnType<typeof InstalledAppIdSchema.parse>,
    growfulTokenHash: GrowfulTokenHash,
    createdAt: Date,
  ): Promise<boolean> {
    const updated = await this.database
      .updateTable("smartThingsConnections")
      .set({ growfulTokenCreatedAt: createdAt, growfulTokenHash })
      .where("installedAppId", "=", installedAppId)
      .returning("installedAppId")
      .executeTakeFirst()
    return updated !== undefined
  }

  async saveState(
    stateHash: OAuthStateHash,
    expiresAt: Date,
    authorization: OAuthAuthorization,
  ): Promise<void> {
    await this.stateStore.save(stateHash, expiresAt, authorization)
  }

  async saveAuthorizationTokensIfAccessActive(
    input: AuthorizationSaveTokensInput,
  ): Promise<StoredTokens | null> {
    return persistPostgresAuthorizationIfActive({
      configuredPrivateBetaGenerations: this.configuredPrivateBetaGenerations,
      database: this.database,
      input,
      persist: (database) => this.saveAuthorizationTokens(input, database),
    })
  }

  async saveTokens(input: SaveTokensInput): Promise<StoredTokens> {
    switch (input.source) {
      case "authorization":
        return this.saveAuthorizationTokens(input)
      case "refresh":
        return this.saveRefreshedTokens(input)
      default:
        throw new UnexpectedTokenSourceError()
    }
  }

  private async saveAuthorizationTokens(
    input: Extract<SaveTokensInput, { readonly source: "authorization" }>,
    database: Kysely<GatewayDatabase> = this.database,
  ): Promise<StoredTokens> {
    const row = {
      ...this.tokenCodec.createTokenRow(input, null),
      consentedAt: input.authorization.consentedAt,
      growfulTokenCreatedAt: input.growfulTokenCreatedAt,
      growfulTokenHash: input.growfulTokenHash,
      policyVersion: input.authorization.policyVersion,
      privateBetaInviteGeneration: input.authorization.privateBetaInviteGeneration,
      privateBetaUsername: input.authorization.privateBetaUsername,
    }
    const saved = await database
      .insertInto("smartThingsConnections")
      .values(row)
      .onConflict((conflict) => conflict.column("installedAppId").doUpdateSet(row))
      .returningAll()
      .executeTakeFirstOrThrow()
    return this.tokenCodec.decryptRow(saved)
  }

  private async saveRefreshedTokens(
    input: Extract<SaveTokensInput, { readonly source: "refresh" }>,
  ): Promise<StoredTokens> {
    const saved = await this.database
      .updateTable("smartThingsConnections")
      .set(this.tokenCodec.createTokenRow(input, input.issuedAt))
      .where("installedAppId", "=", input.grant.installedAppId)
      .where("refreshClaimId", "=", input.claimId)
      .returningAll()
      .executeTakeFirst()
    if (saved === undefined) {
      throw new StaleRefreshClaimError()
    }
    return this.tokenCodec.decryptRow(saved)
  }
}
