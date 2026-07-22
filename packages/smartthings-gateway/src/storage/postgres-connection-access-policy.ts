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
        expression("policyVersion", "!=", accessPolicy.policyVersion),
      ]),
    )
    .executeTakeFirst()
  if (accessPolicy.privateBetaUsernames === null) {
    return Number(invalidConsent.numDeletedRows)
  }
  if (accessPolicy.privateBetaUsernames.length === 0) {
    const inactiveInvite = await database
      .deleteFrom("smartThingsConnections")
      .where("policyVersion", "is not", null)
      .executeTakeFirst()
    return Number(invalidConsent.numDeletedRows + inactiveInvite.numDeletedRows)
  }
  const inactiveInvite = await database
    .deleteFrom("smartThingsConnections")
    .where("policyVersion", "is not", null)
    .where((expression) =>
      expression.or([
        expression("privateBetaUsername", "is", null),
        expression("privateBetaUsername", "not in", accessPolicy.privateBetaUsernames),
      ]),
    )
    .executeTakeFirst()
  return Number(invalidConsent.numDeletedRows + inactiveInvite.numDeletedRows)
}
