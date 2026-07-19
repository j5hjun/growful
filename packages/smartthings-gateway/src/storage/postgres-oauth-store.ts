import type { Kysely, Selectable } from "kysely"
import {
  InstalledAppIdSchema,
  type OAuthStateHash,
  type OAuthStore,
  type RefreshClaim,
  type RefreshFailure,
  type SaveTokensInput,
  type StoredTokens,
} from "../oauth/contracts.js"
import { decodeEncryptionKey, decryptSecret, encryptSecret } from "../security/token-encryption.js"
import type { GatewayDatabase, OAuthTokenTable } from "./database.js"

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

  async claimTokensForRefresh(claim: RefreshClaim): Promise<StoredTokens | null> {
    const dueAt = new Date(claim.now.getTime() + claim.refreshBeforeExpiryMs)
    const leaseUntil = new Date(claim.now.getTime() + claim.leaseMs)
    const row = await this.database
      .updateTable("oauthTokens")
      .set({ refreshClaimedUntil: leaseUntil })
      .where("expiresAt", "<=", dueAt)
      .where((expression) =>
        expression.or([
          expression("refreshClaimedUntil", "is", null),
          expression("refreshClaimedUntil", "<=", claim.now),
        ]),
      )
      .returningAll()
      .executeTakeFirst()
    return row === undefined ? null : this.decryptRow(row)
  }

  async consumeState(stateHash: OAuthStateHash, now: Date): Promise<boolean> {
    const state = await this.database
      .deleteFrom("oauthStates")
      .where("stateHash", "=", stateHash)
      .returning("expiresAt")
      .executeTakeFirst()
    return state !== undefined && state.expiresAt.getTime() >= now.getTime()
  }

  async getTokens(): Promise<StoredTokens | null> {
    const row = await this.database.selectFrom("oauthTokens").selectAll().executeTakeFirst()
    return row === undefined ? null : this.decryptRow(row)
  }

  async recordRefreshFailure(failure: RefreshFailure): Promise<void> {
    await this.database
      .updateTable("oauthTokens")
      .set({ lastRefreshError: failure.message, refreshClaimedUntil: null })
      .where("installedAppId", "=", failure.installedAppId)
      .execute()
  }

  async saveState(stateHash: OAuthStateHash, expiresAt: Date): Promise<void> {
    await this.database
      .insertInto("oauthStates")
      .values({ expiresAt, stateHash })
      .onConflict((conflict) => conflict.column("stateHash").doUpdateSet({ expiresAt }))
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
      await transaction.deleteFrom("oauthTokens").execute()
      await transaction.insertInto("oauthTokens").values(row).execute()
    })
    return this.decryptRow(row)
  }

  private async saveRefreshedTokens(input: SaveTokensInput): Promise<StoredTokens> {
    const row = this.createRow(input, input.issuedAt)
    const saved = await this.database
      .updateTable("oauthTokens")
      .set(row)
      .where("installedAppId", "=", input.grant.installedAppId)
      .returningAll()
      .executeTakeFirstOrThrow()
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
      refreshTokenCiphertext: encryptSecret(input.grant.refreshToken, this.encryptionKey),
      scope: input.grant.scope,
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
      scope: row.scope,
      tokenType: row.tokenType,
    }
  }
}
