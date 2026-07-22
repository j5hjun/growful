import { type Kysely, sql } from "kysely"
import { z } from "zod"
import { type AuditEventHash, AuditEventHashSchema } from "../audit/audit-event.js"
import { appendPostgresAuditEvent } from "../audit/postgres-audit-sink.js"
import type { InstalledAppId } from "../oauth/contracts.js"
import type { GatewayDatabase } from "../storage/database.js"

export const growfulAbuseBlockReasons = [
  "quota_abuse",
  "security_incident",
  "terms_violation",
] as const
export const GrowfulAbuseBlockReasonSchema = z.enum(growfulAbuseBlockReasons)
export type GrowfulAbuseBlockReason = z.infer<typeof GrowfulAbuseBlockReasonSchema>

export type GrowfulAbuseBlock = {
  readonly blockedAt: Date
  readonly reason: GrowfulAbuseBlockReason
}

export interface GrowfulAbuseControl {
  getBlock(installedAppId: InstalledAppId): Promise<GrowfulAbuseBlock | null>
}

export type GrowfulAbuseOperatorCommand = {
  readonly actorIdHash: AuditEventHash
  readonly supportReference: AuditEventHash
  readonly ticketHash: AuditEventHash
}

export type GrowfulAbuseBlockCommand = GrowfulAbuseOperatorCommand & {
  readonly reason: GrowfulAbuseBlockReason
}

export type GrowfulAbuseReview = {
  readonly blockedAt: Date | null
  readonly blockReason: GrowfulAbuseBlockReason | null
  readonly lastRejectedAt: Date | null
  readonly rejectedCount: number
  readonly supportReference: AuditEventHash
}

const abuseReviewSchema = z.object({
  blockedAt: z.date().nullable(),
  blockReason: GrowfulAbuseBlockReasonSchema.nullable(),
  lastRejectedAt: z.date().nullable(),
  rejectedCount: z.int().nonnegative(),
  supportReference: AuditEventHashSchema,
})

export type PostgresGrowfulAbuseControlOptions = {
  readonly database: Kysely<GatewayDatabase>
}

export class PostgresGrowfulAbuseControl implements GrowfulAbuseControl {
  private readonly database: Kysely<GatewayDatabase>

  constructor(options: PostgresGrowfulAbuseControlOptions) {
    this.database = options.database
  }

  async getBlock(installedAppId: InstalledAppId): Promise<GrowfulAbuseBlock | null> {
    const row = await this.database
      .selectFrom("smartThingsConnections")
      .select(["serviceBlockedAt", "serviceBlockReason"])
      .where("installedAppId", "=", installedAppId)
      .executeTakeFirst()
    if (row === undefined || row.serviceBlockedAt === null || row.serviceBlockReason === null) {
      return null
    }
    return {
      blockedAt: row.serviceBlockedAt,
      reason: GrowfulAbuseBlockReasonSchema.parse(row.serviceBlockReason),
    }
  }

  async listReviews(): Promise<readonly GrowfulAbuseReview[]> {
    const result = await sql<GrowfulAbuseReview>`
      select
        encode(digest(installed_app_id, 'sha256'), 'hex') as "supportReference",
        growful_quota_rejected_count as "rejectedCount",
        growful_quota_last_rejected_at as "lastRejectedAt",
        service_blocked_at as "blockedAt",
        service_block_reason as "blockReason"
      from smart_things_connections
      where growful_quota_rejected_count > 0 or service_blocked_at is not null
      order by growful_quota_last_rejected_at desc nulls last, installed_app_id
    `.execute(this.database)
    return z.array(abuseReviewSchema).parse(result.rows)
  }

  async block(command: GrowfulAbuseBlockCommand): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const changed = await transaction
        .updateTable("smartThingsConnections")
        .set({
          serviceBlockedAt: sql<Date>`statement_timestamp()`,
          serviceBlockReason: command.reason,
        })
        .where(
          sql<boolean>`encode(digest(installed_app_id, 'sha256'), 'hex') = ${command.supportReference}`,
        )
        .where("serviceBlockedAt", "is", null)
        .returning("serviceBlockedAt")
        .executeTakeFirst()
      if (changed?.serviceBlockedAt === undefined || changed.serviceBlockedAt === null) {
        return false
      }
      await appendPostgresAuditEvent(transaction, {
        action: "connection.block",
        actorIdHash: command.actorIdHash,
        actorType: "operator",
        affectedCount: 1,
        occurredAt: changed.serviceBlockedAt,
        outcome: "succeeded",
        subjectHash: command.supportReference,
        ticketHash: command.ticketHash,
      })
      return true
    })
  }

  async unblock(command: GrowfulAbuseOperatorCommand): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const changed = await transaction
        .updateTable("smartThingsConnections")
        .set({ serviceBlockedAt: null, serviceBlockReason: null })
        .where(
          sql<boolean>`encode(digest(installed_app_id, 'sha256'), 'hex') = ${command.supportReference}`,
        )
        .where("serviceBlockedAt", "is not", null)
        .returning(sql<Date>`statement_timestamp()`.as("occurredAt"))
        .executeTakeFirst()
      if (changed === undefined) {
        return false
      }
      await appendPostgresAuditEvent(transaction, {
        action: "connection.unblock",
        actorIdHash: command.actorIdHash,
        actorType: "operator",
        affectedCount: 1,
        occurredAt: changed.occurredAt,
        outcome: "succeeded",
        subjectHash: command.supportReference,
        ticketHash: command.ticketHash,
      })
      return true
    })
  }
}
