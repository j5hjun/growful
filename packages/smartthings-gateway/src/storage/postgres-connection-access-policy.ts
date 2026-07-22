import type { Kysely } from "kysely"
import type { ConnectionAccessPolicy } from "../oauth/contracts.js"
import type { GatewayDatabase } from "./database.js"

export async function revokePostgresUnauthorizedConnections(
  database: Kysely<GatewayDatabase>,
  accessPolicy: ConnectionAccessPolicy,
): Promise<number> {
  const invalidConsent = await database
    .deleteFrom("smartThingsConnections")
    .where((expression) =>
      expression.or([
        expression.and([
          expression("consentedAt", "is", null),
          expression("policyVersion", "is not", null),
        ]),
        expression.and([
          expression("consentedAt", "is not", null),
          expression("policyVersion", "is", null),
        ]),
        expression.and([
          expression("consentedAt", "is", null),
          expression("policyVersion", "is", null),
          expression.or([
            expression("privateBetaUsername", "is not", null),
            expression("privateBetaInviteGeneration", "is not", null),
          ]),
        ]),
        expression.and([
          expression("privateBetaUsername", "is", null),
          expression("privateBetaInviteGeneration", "is not", null),
        ]),
        expression.and([
          expression("privateBetaUsername", "is not", null),
          expression("privateBetaInviteGeneration", "is", null),
        ]),
        expression("policyVersion", "!=", accessPolicy.policyVersion),
      ]),
    )
    .executeTakeFirst()
  const activeInvites = accessPolicy.privateBetaInvites
  if (activeInvites === null) {
    return Number(invalidConsent.numDeletedRows)
  }
  if (activeInvites.length === 0) {
    const inactiveInvite = await database
      .deleteFrom("smartThingsConnections")
      .where("policyVersion", "is not", null)
      .executeTakeFirst()
    return Number(invalidConsent.numDeletedRows + inactiveInvite.numDeletedRows)
  }
  const inactiveInvite = await database
    .deleteFrom("smartThingsConnections")
    .where("policyVersion", "is not", null)
    .where(({ eb, or, refTuple, tuple }) =>
      or([
        eb("privateBetaUsername", "is", null),
        eb("privateBetaInviteGeneration", "is", null),
        eb(
          refTuple("privateBetaUsername", "privateBetaInviteGeneration"),
          "not in",
          activeInvites.map((invite) => tuple(invite.username, invite.generation)),
        ),
      ]),
    )
    .executeTakeFirst()
  return Number(invalidConsent.numDeletedRows + inactiveInvite.numDeletedRows)
}
