import { type Kysely, type Selectable, sql } from "kysely"
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
import { decodeEncryptionKey, decryptSecret, encryptSecret } from "../security/token-encryption.js"
import type { GatewayDatabase, OAuthTokenTable } from "./database.js"

export type PostgresOAuthStoreOptions = {
  readonly database: Kysely<GatewayDatabase>
  readonly encryptionKeyBase64: string
}

const authorizationTokensLockId = 8_100_202_607_19

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

  async claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null> {
    return this.database.transaction().execute(async (transaction) => {
      const row = await transaction
        .selectFrom("oauthTokens")
        .selectAll()
        .forUpdate()
        .executeTakeFirst()
      if (row === undefined) {
        return null
      }

      const tokens = this.decryptRow(row)
      const dueAt =
        claim.refreshBeforeExpiryMs === null
          ? null
          : new Date(claim.now.getTime() + claim.refreshBeforeExpiryMs)
      const claimAvailable =
        row.refreshClaimedUntil === null || row.refreshClaimedUntil.getTime() <= claim.now.getTime()
      if (
        (dueAt !== null && row.expiresAt.getTime() > dueAt.getTime()) ||
        !claimAvailable ||
        (claim.expectedAccessToken !== undefined &&
          tokens.accessToken !== claim.expectedAccessToken)
      ) {
        return null
      }

      await transaction
        .updateTable("oauthTokens")
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

  async getTokens(): Promise<StoredTokens | null> {
    const row = await this.database.selectFrom("oauthTokens").selectAll().executeTakeFirst()
    return row === undefined ? null : this.decryptRow(row)
  }

  async recordRefreshFailure(failure: RefreshFailure): Promise<void> {
    await this.database
      .updateTable("oauthTokens")
      .set({ lastRefreshError: failure.message })
      .where("installedAppId", "=", failure.installedAppId)
      .where("refreshClaimId", "=", failure.claimId)
      .execute()
  }

  async saveState(
    stateHash: OAuthStateHash,
    expiresAt: Date,
    requestedScopes: readonly SmartThingsScope[],
  ): Promise<void> {
    const serializedScopes = serializeSmartThingsScopes(requestedScopes)
    await this.database
      .insertInto("oauthStates")
      .values({ expiresAt, requestedScopes: serializedScopes, stateHash })
      .onConflict((conflict) =>
        conflict.column("stateHash").doUpdateSet({ expiresAt, requestedScopes: serializedScopes }),
      )
      .execute()
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

  private async saveAuthorizationTokens(input: SaveTokensInput): Promise<StoredTokens> {
    const row = this.createRow(input, null)
    await this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(${authorizationTokensLockId})`.execute(transaction)
      await transaction.deleteFrom("oauthTokens").execute()
      await transaction.insertInto("oauthTokens").values(row).execute()
    })
    return this.decryptRow(row)
  }

  private async saveRefreshedTokens(
    input: Extract<SaveTokensInput, { readonly source: "refresh" }>,
  ): Promise<StoredTokens> {
    const row = this.createRow(input, input.issuedAt)
    const saved = await this.database
      .updateTable("oauthTokens")
      .set(row)
      .where("installedAppId", "=", input.grant.installedAppId)
      .where("refreshClaimId", "=", input.claimId)
      .returningAll()
      .executeTakeFirst()
    if (saved === undefined) {
      throw new StaleRefreshClaimError()
    }
    return this.decryptRow(saved)
  }

  private createRow(input: SaveTokensInput, lastRefreshedAt: Date | null) {
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

  private decryptRow(row: Selectable<OAuthTokenTable>): StoredTokens {
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
