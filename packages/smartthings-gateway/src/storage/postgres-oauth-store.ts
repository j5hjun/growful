import type { Kysely } from "kysely"
import {
  type ConnectionAccessPolicy,
  type ConnectionAuthentication,
  InstalledAppIdSchema,
  type OAuthAuthorization,
  type OAuthStateHash,
  type OAuthStore,
  type RefreshClaim,
  type RefreshFailure,
  type SaveTokensInput,
  StaleRefreshClaimError,
  type StoredTokens,
} from "../oauth/contracts.js"
import type { GrowfulTokenHash } from "../security/growful-token.js"
import type { GatewayDatabase } from "./database.js"
import { PostgresOAuthStateStore } from "./postgres-oauth-state-store.js"
import { PostgresTokenCodec } from "./postgres-token-codec.js"

export type PostgresOAuthStoreOptions = {
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
  private readonly database: Kysely<GatewayDatabase>
  private readonly stateStore: PostgresOAuthStateStore
  private readonly tokenCodec: PostgresTokenCodec

  constructor(options: PostgresOAuthStoreOptions) {
    this.database = options.database
    this.stateStore = new PostgresOAuthStateStore(options.database)
    this.tokenCodec = new PostgresTokenCodec(options.encryptionKeyBase64)
  }

  async authenticate(growfulTokenHash: GrowfulTokenHash) {
    const row = await this.database
      .selectFrom("smartThingsConnections")
      .select(["installedAppId", "policyVersion", "privateBetaUsername"])
      .where("growfulTokenHash", "=", growfulTokenHash)
      .executeTakeFirst()
    if (row === undefined || row.policyVersion === null) {
      return null
    }
    return {
      installedAppId: InstalledAppIdSchema.parse(row.installedAppId),
      policyVersion: row.policyVersion,
      privateBetaUsername: row.privateBetaUsername,
    } satisfies ConnectionAuthentication
  }

  async claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null> {
    return this.database.transaction().execute(async (transaction) => {
      let query = transaction
        .selectFrom("smartThingsConnections")
        .selectAll()
        .where((expression) =>
          expression.or([
            expression("refreshClaimedUntil", "is", null),
            expression("refreshClaimedUntil", "<=", claim.now),
          ]),
        )
        .forUpdate()
        .skipLocked()

      switch (claim.kind) {
        case "due":
          query = query
            .where("expiresAt", "<=", new Date(claim.now.getTime() + claim.refreshBeforeExpiryMs))
            .orderBy("expiresAt", "asc")
          break
        case "forced":
          query = query.where("installedAppId", "=", claim.installedAppId)
          break
      }

      const row = await query.executeTakeFirst()
      if (row === undefined) {
        return null
      }
      const tokens = this.tokenCodec.decryptRow(row)
      if (claim.kind === "forced" && tokens.accessToken !== claim.expectedAccessToken) {
        return null
      }

      await transaction
        .updateTable("smartThingsConnections")
        .set({
          refreshClaimedUntil: new Date(claim.now.getTime() + claim.leaseMs),
          refreshClaimId: claim.claimId,
        })
        .where("installedAppId", "=", tokens.installedAppId)
        .execute()
      return tokens
    })
  }

  async consumeState(stateHash: OAuthStateHash, now: Date): Promise<OAuthAuthorization | null> {
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
      .set({ lastRefreshError: failure.message })
      .where("installedAppId", "=", failure.installedAppId)
      .where("refreshClaimId", "=", failure.claimId)
      .execute()
  }

  async revokeUnauthorizedConnections(accessPolicy: ConnectionAccessPolicy): Promise<number> {
    const invalidConsent = await this.database
      .deleteFrom("smartThingsConnections")
      .where((expression) =>
        expression.or([
          expression("consentedAt", "is", null),
          expression("policyVersion", "is", null),
          expression("policyVersion", "!=", accessPolicy.policyVersion),
        ]),
      )
      .executeTakeFirst()
    if (accessPolicy.privateBetaUsernames === null) {
      return Number(invalidConsent.numDeletedRows)
    }
    const inactiveInvite = await this.database
      .deleteFrom("smartThingsConnections")
      .where((expression) =>
        expression.or([
          expression("privateBetaUsername", "is", null),
          expression("privateBetaUsername", "not in", accessPolicy.privateBetaUsernames),
        ]),
      )
      .executeTakeFirst()
    return Number(invalidConsent.numDeletedRows + inactiveInvite.numDeletedRows)
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
  ): Promise<StoredTokens> {
    const row = {
      ...this.tokenCodec.createTokenRow(input, null),
      consentedAt: input.authorization.consentedAt,
      growfulTokenCreatedAt: input.growfulTokenCreatedAt,
      growfulTokenHash: input.growfulTokenHash,
      policyVersion: input.authorization.policyVersion,
      privateBetaUsername: input.authorization.privateBetaUsername,
    }
    const saved = await this.database
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
