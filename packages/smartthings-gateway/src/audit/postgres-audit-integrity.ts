import type { Kysely } from "kysely"
import type { GatewayDatabase } from "../storage/database.js"
import { type AuditChainVerification, verifyAuditChain } from "./audit-event.js"

export async function verifyPostgresAuditIntegrity(
  database: Kysely<GatewayDatabase>,
): Promise<AuditChainVerification> {
  const rows = await database.selectFrom("auditEvents").selectAll().orderBy("sequence").execute()
  return verifyAuditChain(rows)
}
