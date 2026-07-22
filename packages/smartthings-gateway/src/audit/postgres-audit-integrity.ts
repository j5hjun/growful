import type { Kysely } from "kysely"
import type { GatewayDatabase } from "../storage/database.js"
import {
  type AuditChainVerification,
  type AuditEventHash,
  AuditEventHashSchema,
  verifyAuditChainSegment,
} from "./audit-event.js"

export const auditIntegrityVerificationPageSize = 1_000

export type AuditIntegrityCheckpoint = {
  readonly eventCount: number
  readonly lastEventHash: AuditEventHash
  readonly lastSequence: string
  readonly targetEventHash: AuditEventHash
  readonly targetSequence: string
}

export type PostgresAuditIntegrityVerification =
  | AuditChainVerification
  | {
      readonly checkpoint: AuditIntegrityCheckpoint
      readonly status: "in_progress"
    }

export async function verifyPostgresAuditIntegrity(
  database: Kysely<GatewayDatabase>,
  checkpoint: AuditIntegrityCheckpoint | null = null,
): Promise<PostgresAuditIntegrityVerification> {
  const target =
    checkpoint === null
      ? await database
          .selectFrom("auditEvents")
          .select(["eventHash", "sequence"])
          .orderBy("sequence", "desc")
          .limit(1)
          .executeTakeFirst()
      : {
          eventHash: checkpoint.targetEventHash,
          sequence: checkpoint.targetSequence,
        }
  if (target === undefined) {
    return { eventCount: 0, lastEventHash: null, status: "valid" }
  }

  const targetEventHash = AuditEventHashSchema.parse(target.eventHash)
  const pageQuery = database
    .selectFrom("auditEvents")
    .selectAll()
    .where("sequence", "<=", target.sequence)
    .orderBy("sequence")
    .limit(auditIntegrityVerificationPageSize)
  const rows = await (checkpoint === null
    ? pageQuery
    : pageQuery.where("sequence", ">", checkpoint.lastSequence)
  ).execute()
  if (rows.length === 0) {
    return {
      reason: "sequence_order_mismatch",
      sequence: target.sequence,
      status: "invalid",
    }
  }

  const result = verifyAuditChainSegment(rows, {
    previousHash: checkpoint?.lastEventHash ?? null,
    previousSequence: checkpoint?.lastSequence ?? null,
  })
  if (result.status === "invalid") {
    return result
  }
  const lastRow = rows.at(-1)
  if (lastRow === undefined) {
    return { reason: "invalid_event", sequence: null, status: "invalid" }
  }
  const eventCount = (checkpoint?.eventCount ?? 0) + result.eventCount
  if (lastRow.sequence === target.sequence) {
    return result.lastEventHash === targetEventHash
      ? { eventCount, lastEventHash: targetEventHash, status: "valid" }
      : {
          reason: "event_hash_mismatch",
          sequence: target.sequence,
          status: "invalid",
        }
  }
  if (result.lastEventHash === null) {
    return { reason: "invalid_event", sequence: null, status: "invalid" }
  }
  return {
    checkpoint: {
      eventCount,
      lastEventHash: result.lastEventHash,
      lastSequence: lastRow.sequence,
      targetEventHash,
      targetSequence: target.sequence,
    },
    status: "in_progress",
  }
}
