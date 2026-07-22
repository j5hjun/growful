import type { Kysely } from "kysely"
import { verifyPostgresAuditIntegrity } from "../../src/audit/postgres-audit-integrity.js"
import type { GatewayDatabase } from "../../src/storage/database.js"

export async function verifyCompleteAuditChain(database: Kysely<GatewayDatabase>) {
  let result = await verifyPostgresAuditIntegrity(database)
  while (result.status === "in_progress") {
    result = await verifyPostgresAuditIntegrity(database, result.checkpoint)
  }
  return result
}
