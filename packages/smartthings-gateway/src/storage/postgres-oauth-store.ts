import type { Kysely, Selectable } from "kysely"
import {
  InstalledAppIdSchema,
  type OAuthStateHash,
  type OAuthStore,
  type RefreshClaim,
  type RefreshFailure,
  type SaveTokensInput,
  StaleRefreshClaimError,
  type StoredTokens,
} from "../oauth/contracts.js"
import {
  SmartThingsGrantedScopeStringSchema,
  type SmartThingsScope,
  SmartThingsScopeStringSchema,
  serializeSmartThingsScopes,
} from "../oauth/smartthings-scope.js"
import type { GrowfulTokenHash } from "../security/growful-token.js"
import { decodeEncryptionKey, decryptSecret, encryptSecret } from "../security/token-encryption.js"
import type { GatewayDatabase, SmartThingsConnectionTable } from "./database.js"

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
  private readonly encryptionKey: Buffer

  constructor(options: PostgresOAuthStoreOptions) {
    this.database = options.database
    this.encryptionKey = decodeEncryptionKey(options.encryptionKeyBase64)
  }

  async authenticate(growfulTokenHash: GrowfulTokenHash) {
    const row = await this.database
      .selectFrom("smartThingsConnections")
      .select("installedAppId")
      .where("growfulTokenHash", "=", growfulTokenHash)
      .executeTakeFirst()
    return row === undefined ? null : InstalledAppIdSchema.parse(row.installedAppId)
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
      const tokens = this.decryptRow(row)
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

  async consumeState(
    stateHash: OAuthStateHash,
    now: Date,
  ): Promise<readonly SmartThingsScope[] | null> {
    const state = await this.database
      .deleteFrom("oauthStates")
      .where("stateHash", "=", stateHash)
      .returning(["expiresAt", "requestedScopes"])
      .executeTakeFirst()
    if (
      state === undefined ||
      state.expiresAt.getTime() < now.getTime() ||
      state.requestedScopes.length === 0
    ) {
      return null
    }
    return SmartThingsScopeStringSchema.parse(state.requestedScopes)
  }

  async deleteConnection(installedAppId: ReturnType<typeof InstalledAppIdSchema.parse>) {
    const deleted = await this.database
      .deleteFrom("smartThingsConnections")
      .where("installedAppId", "=", installedAppId)
      .returning("installedAppId")
      .executeTakeFirst()
    return deleted !== undefined
  }

  async getTokens(
    installedAppId: ReturnType<typeof InstalledAppIdSchema.parse>,
  ): Promise<StoredTokens | null> {
    const row = await this.database
      .selectFrom("smartThingsConnections")
      .selectAll()
      .where("installedAppId", "=", installedAppId)
      .executeTakeFirst()
    return row === undefined ? null : this.decryptRow(row)
  }

  async recordRefreshFailure(failure: RefreshFailure): Promise<void> {
    await this.database
      .updateTable("smartThingsConnections")
      .set({ lastRefreshError: failure.message })
      .where("installedAppId", "=", failure.installedAppId)
      .where("refreshClaimId", "=", failure.claimId)
      .execute()
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
    requestedScopes: readonly SmartThingsScope[],
  ): Promise<void> {
    const serializedScopes = serializeSmartThingsScopes(requestedScopes)
    await this.database.transaction().execute(async (transaction) => {
      await transaction.deleteFrom("oauthStates").where("expiresAt", "<", new Date()).execute()
      await transaction
        .insertInto("oauthStates")
        .values({ expiresAt, requestedScopes: serializedScopes, stateHash })
        .onConflict((conflict) =>
          conflict
            .column("stateHash")
            .doUpdateSet({ expiresAt, requestedScopes: serializedScopes }),
        )
        .execute()
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
  ): Promise<StoredTokens> {
    const row = {
      ...this.createTokenRow(input, null),
      growfulTokenCreatedAt: input.growfulTokenCreatedAt,
      growfulTokenHash: input.growfulTokenHash,
    }
    const saved = await this.database
      .insertInto("smartThingsConnections")
      .values(row)
      .onConflict((conflict) => conflict.column("installedAppId").doUpdateSet(row))
      .returningAll()
      .executeTakeFirstOrThrow()
    return this.decryptRow(saved)
  }

  private async saveRefreshedTokens(
    input: Extract<SaveTokensInput, { readonly source: "refresh" }>,
  ): Promise<StoredTokens> {
    const saved = await this.database
      .updateTable("smartThingsConnections")
      .set(this.createTokenRow(input, input.issuedAt))
      .where("installedAppId", "=", input.grant.installedAppId)
      .where("refreshClaimId", "=", input.claimId)
      .returningAll()
      .executeTakeFirst()
    if (saved === undefined) {
      throw new StaleRefreshClaimError()
    }
    return this.decryptRow(saved)
  }

  private createTokenRow(input: SaveTokensInput, lastRefreshedAt: Date | null) {
    return {
      accessTokenCiphertext: encryptSecret(input.grant.accessToken, this.encryptionKey),
      expiresAt: new Date(input.issuedAt.getTime() + input.grant.expiresInSeconds * 1_000),
      installedAppId: input.grant.installedAppId,
      lastRefreshError: null,
      lastRefreshedAt,
      refreshClaimedUntil: null,
      refreshClaimId: null,
      refreshTokenCiphertext: encryptSecret(input.grant.refreshToken, this.encryptionKey),
      scope: serializeSmartThingsScopes(input.grant.scopes),
      tokenType: input.grant.tokenType,
      updatedAt: input.issuedAt,
    }
  }

  private decryptRow(row: Selectable<SmartThingsConnectionTable>): StoredTokens {
    return {
      accessToken: decryptSecret(row.accessTokenCiphertext, this.encryptionKey),
      expiresAt: row.expiresAt,
      installedAppId: InstalledAppIdSchema.parse(row.installedAppId),
      lastRefreshedAt: row.lastRefreshedAt,
      refreshToken: decryptSecret(row.refreshTokenCiphertext, this.encryptionKey),
      scopes: SmartThingsGrantedScopeStringSchema.parse(row.scope),
      tokenType: row.tokenType,
    }
  }
}
