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
        expression("consentedAt", "is", null),
        expression("policyVersion", "is", null),
        expression("policyVersion", "!=", accessPolicy.policyVersion),
      ]),
    )
    .executeTakeFirst()
  if (accessPolicy.privateBetaUsernames === null) {
    return Number(invalidConsent.numDeletedRows)
  }
  if (accessPolicy.privateBetaUsernames.length === 0) {
    const inactiveInvite = await database.deleteFrom("smartThingsConnections").executeTakeFirst()
    return Number(invalidConsent.numDeletedRows + inactiveInvite.numDeletedRows)
  }
  const inactiveInvite = await database
    .deleteFrom("smartThingsConnections")
    .where((expression) =>
      expression.or([
        expression("privateBetaUsername", "is", null),
        expression("privateBetaUsername", "not in", accessPolicy.privateBetaUsernames),
      ]),
    )
    .executeTakeFirst()
  return Number(invalidConsent.numDeletedRows + inactiveInvite.numDeletedRows)
}
