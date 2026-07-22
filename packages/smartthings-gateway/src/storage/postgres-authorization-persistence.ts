import { type Kysely, sql } from "kysely"
import { hashAuditSubject } from "../audit/audit-event.js"
import type { AuthorizationSaveTokensInput, StoredTokens } from "../oauth/contracts.js"
import type { GatewayDatabase } from "./database.js"

export type PostgresAuthorizationPersistenceOptions = {
  readonly configuredPrivateBetaGenerations: ReadonlyMap<string, string>
  readonly database: Kysely<GatewayDatabase>
  readonly input: AuthorizationSaveTokensInput
  readonly persist: (database: Kysely<GatewayDatabase>) => Promise<StoredTokens>
}

export async function persistPostgresAuthorizationIfActive(
  options: PostgresAuthorizationPersistenceOptions,
): Promise<StoredTokens | null> {
  return options.database.transaction().execute(async (transaction) => {
    const username = options.input.authorization.privateBetaUsername
    if (username === null) {
      if (options.input.authorization.privateBetaInviteGeneration !== null) return null
    } else {
      const expectedGeneration = options.input.authorization.privateBetaInviteGeneration
      if (expectedGeneration === null) return null
      await sql`select pg_advisory_xact_lock(hashtextextended(${username}, 0))`.execute(transaction)
      const storedInvite = await transaction
        .selectFrom("privateBetaInvites")
        .select(["generationId", "revokedAt"])
        .where("username", "=", username)
        .executeTakeFirst()
      const active =
        storedInvite === undefined
          ? options.configuredPrivateBetaGenerations.get(username) === expectedGeneration
          : storedInvite.revokedAt === null && storedInvite.generationId === expectedGeneration
      if (!active) return null
    }

    const subjectHash = hashAuditSubject({ installedAppId: options.input.grant.installedAppId })
    await sql`select pg_advisory_xact_lock(hashtextextended(${subjectHash}, 0))`.execute(
      transaction,
    )
    const laterDeletion = await transaction
      .selectFrom("privacyDeletionEpochs")
      .select("deletionEpoch")
      .where("subjectHash", "=", subjectHash)
      .where("deletionEpoch", ">", options.input.authorization.privacyDeletionEpoch)
      .executeTakeFirst()
    return laterDeletion === undefined ? options.persist(transaction) : null
  })
}
