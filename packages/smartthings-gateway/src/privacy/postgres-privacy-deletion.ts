import { type Kysely, sql } from "kysely"
import type { AuditEventHash } from "../audit/audit-event.js"
import { appendPostgresAuditEvent } from "../audit/postgres-audit-sink.js"
import type { GatewayDatabase } from "../storage/database.js"

export type PrivacyDeletionCommand = {
  readonly actorIdHash: AuditEventHash
  readonly supportReference: AuditEventHash
  readonly ticketHash: AuditEventHash
}

export type PrivacyDeletionResult =
  | { readonly affectedCount: 0; readonly outcome: "failed" }
  | { readonly affectedCount: 1; readonly outcome: "succeeded" }

export type PostgresPrivacyDeletionOptions = {
  readonly database: Kysely<GatewayDatabase>
}

export class PostgresPrivacyDeletion {
  private readonly database: Kysely<GatewayDatabase>

  constructor(options: PostgresPrivacyDeletionOptions) {
    this.database = options.database
  }

  async delete(command: PrivacyDeletionCommand): Promise<PrivacyDeletionResult> {
    return this.database.transaction().execute(async (transaction) => {
      const deleted = await transaction
        .deleteFrom("smartThingsConnections")
        .where(
          sql<boolean>`encode(digest(installed_app_id, 'sha256'), 'hex') = ${command.supportReference}`,
        )
        .returning(sql<number>`1`.as("affectedCount"))
        .executeTakeFirst()
      const occurredAt = await transaction
        .selectNoFrom(sql<Date>`date_trunc('milliseconds', clock_timestamp())`.as("occurredAt"))
        .executeTakeFirstOrThrow()
      const result: PrivacyDeletionResult =
        deleted === undefined
          ? { affectedCount: 0, outcome: "failed" }
          : { affectedCount: 1, outcome: "succeeded" }
      await appendPostgresAuditEvent(transaction, {
        action: "privacy.delete",
        actorIdHash: command.actorIdHash,
        actorType: "operator",
        affectedCount: result.affectedCount,
        occurredAt: occurredAt.occurredAt,
        outcome: result.outcome,
        subjectHash: command.supportReference,
        ticketHash: command.ticketHash,
      })
      return result
    })
  }
}
