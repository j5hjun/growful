import { type Kysely, sql } from "kysely"
import {
  type OAuthAuthorization,
  type OAuthCompletionAuthorization,
  type OAuthStateHash,
  PrivacyDeletionEpochSchema,
} from "../oauth/contracts.js"
import {
  SmartThingsScopeStringSchema,
  serializeSmartThingsScopes,
} from "../oauth/smartthings-scope.js"
import type { GatewayDatabase } from "./database.js"

export class PostgresOAuthStateStore {
  constructor(private readonly database: Kysely<GatewayDatabase>) {}

  async consume(
    stateHash: OAuthStateHash,
    now: Date,
  ): Promise<OAuthCompletionAuthorization | null> {
    const state = await this.database
      .deleteFrom("oauthStates")
      .where("stateHash", "=", stateHash)
      .returning([
        "consentedAt",
        "expiresAt",
        "policyVersion",
        "privateBetaInviteGeneration",
        "privateBetaUsername",
        "privacyDeletionEpoch",
        "requestedScopes",
      ])
      .executeTakeFirst()
    if (
      state === undefined ||
      state.expiresAt.getTime() <= now.getTime() ||
      state.consentedAt === null ||
      state.policyVersion === null ||
      state.requestedScopes.length === 0
    ) {
      return null
    }
    return {
      consentedAt: state.consentedAt,
      policyVersion: state.policyVersion,
      privateBetaInviteGeneration: state.privateBetaInviteGeneration,
      privateBetaUsername: state.privateBetaUsername,
      privacyDeletionEpoch: PrivacyDeletionEpochSchema.parse(state.privacyDeletionEpoch),
      requestedScopes: SmartThingsScopeStringSchema.parse(state.requestedScopes),
    }
  }

  async deleteExpired(now: Date): Promise<number> {
    const result = await this.database
      .deleteFrom("oauthStates")
      .where("expiresAt", "<=", now)
      .executeTakeFirst()
    return Number(result.numDeletedRows)
  }

  async save(
    stateHash: OAuthStateHash,
    expiresAt: Date,
    authorization: OAuthAuthorization,
  ): Promise<void> {
    const requestedScopes = serializeSmartThingsScopes(authorization.requestedScopes)
    await this.database.transaction().execute(async (transaction) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended('growful:privacy-deletion-epoch', 0)
        )
      `.execute(transaction)
      const epoch = await sql<{ privacyDeletionEpoch: string }>`
        select case when is_called then last_value else 0 end::text as "privacyDeletionEpoch"
        from privacy_deletion_epoch_sequence
      `.execute(transaction)
      const privacyDeletionEpoch = PrivacyDeletionEpochSchema.parse(
        epoch.rows[0]?.privacyDeletionEpoch,
      )
      await transaction
        .insertInto("oauthStates")
        .values({
          consentedAt: authorization.consentedAt,
          expiresAt,
          policyVersion: authorization.policyVersion,
          privateBetaInviteGeneration: authorization.privateBetaInviteGeneration,
          privateBetaUsername: authorization.privateBetaUsername,
          privacyDeletionEpoch,
          requestedScopes,
          stateHash,
        })
        .onConflict((conflict) =>
          conflict.column("stateHash").doUpdateSet({
            consentedAt: authorization.consentedAt,
            expiresAt,
            policyVersion: authorization.policyVersion,
            privateBetaInviteGeneration: authorization.privateBetaInviteGeneration,
            privateBetaUsername: authorization.privateBetaUsername,
            privacyDeletionEpoch,
            requestedScopes,
          }),
        )
        .execute()
    })
  }
}
