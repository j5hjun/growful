import type { Kysely, Selectable } from "kysely"
import {
  type RefreshClaim,
  SMARTTHINGS_REAUTHORIZATION_REQUIRED,
  type StoredTokens,
} from "../oauth/contracts.js"
import type { GatewayDatabase, SmartThingsConnectionTable } from "./database.js"
import type { PostgresTokenCodec } from "./postgres-token-codec.js"

type RefreshAuthorization = Pick<
  Selectable<SmartThingsConnectionTable>,
  "privateBetaInviteGeneration" | "privateBetaUsername"
>

export type PostgresRefreshClaimStoreOptions = {
  readonly configuredPrivateBetaGenerations: ReadonlyMap<string, string>
  readonly database: Kysely<GatewayDatabase>
  readonly tokenCodec: PostgresTokenCodec
}

export class PostgresRefreshClaimStore {
  constructor(private readonly options: PostgresRefreshClaimStoreOptions) {}

  async claim(claim: RefreshClaim): Promise<StoredTokens | null> {
    return this.options.database.transaction().execute(async (transaction) => {
      while (true) {
        let query = transaction
          .selectFrom("smartThingsConnections")
          .selectAll()
          .where("consentedAt", "is not", null)
          .where("policyVersion", "is not", null)
          .where((expression) =>
            expression.or([
              expression("lastRefreshError", "is", null),
              expression("lastRefreshError", "!=", SMARTTHINGS_REAUTHORIZATION_REQUIRED),
            ]),
          )
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
        if (!(await this.isAuthorizationActive(transaction, row))) {
          await transaction
            .deleteFrom("smartThingsConnections")
            .where("installedAppId", "=", row.installedAppId)
            .execute()
          continue
        }
        const tokens = this.options.tokenCodec.decryptRow(row)
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
      }
    })
  }

  private async isAuthorizationActive(
    database: Kysely<GatewayDatabase>,
    authorization: RefreshAuthorization,
  ): Promise<boolean> {
    const username = authorization.privateBetaUsername
    const generation = authorization.privateBetaInviteGeneration
    if (username === null || generation === null) {
      return username === null && generation === null
    }
    const storedInvite = await database
      .selectFrom("privateBetaInvites")
      .select(["generationId", "revokedAt"])
      .where("username", "=", username)
      .executeTakeFirst()
    return storedInvite === undefined
      ? this.options.configuredPrivateBetaGenerations.get(username) === generation
      : storedInvite.revokedAt === null && storedInvite.generationId === generation
  }
}
