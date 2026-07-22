import type { Kysely } from "kysely"
import type { OAuthAuthorization, OAuthStateHash } from "../oauth/contracts.js"
import {
  SmartThingsScopeStringSchema,
  serializeSmartThingsScopes,
} from "../oauth/smartthings-scope.js"
import type { GatewayDatabase } from "./database.js"

export class PostgresOAuthStateStore {
  constructor(private readonly database: Kysely<GatewayDatabase>) {}

  async consume(stateHash: OAuthStateHash, now: Date): Promise<OAuthAuthorization | null> {
    const state = await this.database
      .deleteFrom("oauthStates")
      .where("stateHash", "=", stateHash)
      .returning([
        "consentedAt",
        "expiresAt",
        "policyVersion",
        "privateBetaUsername",
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
      privateBetaUsername: state.privateBetaUsername,
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
    await this.database
      .insertInto("oauthStates")
      .values({
        consentedAt: authorization.consentedAt,
        expiresAt,
        policyVersion: authorization.policyVersion,
        privateBetaUsername: authorization.privateBetaUsername,
        requestedScopes,
        stateHash,
      })
      .onConflict((conflict) =>
        conflict.column("stateHash").doUpdateSet({
          consentedAt: authorization.consentedAt,
          expiresAt,
          policyVersion: authorization.policyVersion,
          privateBetaUsername: authorization.privateBetaUsername,
          requestedScopes,
        }),
      )
      .execute()
  }
}
