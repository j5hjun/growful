import type { Selectable } from "kysely"
import {
  InstalledAppIdSchema,
  type SaveTokensInput,
  type StoredTokens,
} from "../oauth/contracts.js"
import {
  SmartThingsGrantedScopeStringSchema,
  serializeSmartThingsScopes,
} from "../oauth/smartthings-scope.js"
import { decodeEncryptionKey, decryptSecret, encryptSecret } from "../security/token-encryption.js"
import type { SmartThingsConnectionTable } from "./database.js"

export class PostgresTokenCodec {
  private readonly encryptionKey: Buffer

  constructor(encryptionKeyBase64: string) {
    this.encryptionKey = decodeEncryptionKey(encryptionKeyBase64)
  }

  createTokenRow(input: SaveTokensInput, lastRefreshedAt: Date | null) {
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

  decryptRow(row: Selectable<SmartThingsConnectionTable>): StoredTokens {
    return {
      accessToken: decryptSecret(row.accessTokenCiphertext, this.encryptionKey),
      expiresAt: row.expiresAt,
      installedAppId: InstalledAppIdSchema.parse(row.installedAppId),
      lastRefreshError: row.lastRefreshError,
      lastRefreshedAt: row.lastRefreshedAt,
      refreshToken: decryptSecret(row.refreshTokenCiphertext, this.encryptionKey),
      scopes: SmartThingsGrantedScopeStringSchema.parse(row.scope),
      tokenType: row.tokenType,
    }
  }
}
