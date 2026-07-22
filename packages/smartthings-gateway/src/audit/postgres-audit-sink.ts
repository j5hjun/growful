import { randomUUID } from "node:crypto"
import { type Kysely, sql } from "kysely"
import type { GatewayDatabase } from "../storage/database.js"
import {
  type AuditEventDraft,
  AuditEventHashSchema,
  AuditEventIdSchema,
  type AuditSink,
  createAuditEvent,
} from "./audit-event.js"

export type PostgresAuditSinkOptions = {
  readonly database: Kysely<GatewayDatabase>
}

export async function appendPostgresAuditEvent(
  database: Kysely<GatewayDatabase>,
  draft: AuditEventDraft,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(718229501)`.execute(database)
  const previous = await database
    .selectFrom("auditEvents")
    .select("eventHash")
    .orderBy("sequence", "desc")
    .executeTakeFirst()
  const previousHash =
    previous === undefined ? null : AuditEventHashSchema.parse(previous.eventHash)
  const event = createAuditEvent(draft, AuditEventIdSchema.parse(randomUUID()), previousHash)
  await database
    .insertInto("auditEvents")
    .values({
      action: event.action,
      actorIdHash: event.actorIdHash,
      actorType: event.actorType,
      affectedCount: event.affectedCount,
      eventHash: event.eventHash,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      outcome: event.outcome,
      previousHash: event.previousHash,
      subjectHash: event.subjectHash,
      ticketHash: event.ticketHash,
    })
    .execute()
}

export class PostgresAuditSink implements AuditSink {
  private readonly database: Kysely<GatewayDatabase>

  constructor(options: PostgresAuditSinkOptions) {
    this.database = options.database
  }

  async append(draft: AuditEventDraft): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await appendPostgresAuditEvent(transaction, draft)
    })
  }
}
