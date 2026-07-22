import { randomUUID } from "node:crypto"
import { type Kysely, sql } from "kysely"
import { z } from "zod"
import type { AuditEventHash } from "../audit/audit-event.js"
import { hashAuditValue } from "../audit/audit-event.js"
import { appendPostgresAuditEvent } from "../audit/postgres-audit-sink.js"
import type { GatewayDatabase } from "../storage/database.js"
import {
  type PublicServiceIncident,
  type ServiceIncidentId,
  ServiceIncidentIdSchema,
  ServiceIncidentImpactSchema,
  ServiceIncidentMessageSchema,
  ServiceIncidentStatusSchema,
  ServiceIncidentTitleSchema,
  type ServiceStatusSource,
} from "./service-status.js"

const publicIncidentSchema = z.object({
  id: ServiceIncidentIdSchema,
  impact: ServiceIncidentImpactSchema,
  message: ServiceIncidentMessageSchema,
  resolvedAt: z.date().nullable(),
  startedAt: z.date(),
  status: ServiceIncidentStatusSchema,
  title: ServiceIncidentTitleSchema,
  updatedAt: z.date(),
})

type OperatorEvidence = {
  readonly actorIdHash: AuditEventHash
  readonly ticketHash: AuditEventHash
}

export type OpenServiceIncidentCommand = OperatorEvidence & {
  readonly impact: z.infer<typeof ServiceIncidentImpactSchema>
  readonly message: string
  readonly title: string
}

export type UpdateServiceIncidentCommand = OperatorEvidence & {
  readonly incidentId: ServiceIncidentId
  readonly message: string
  readonly status: "investigating" | "monitoring"
}

export type ResolveServiceIncidentCommand = OperatorEvidence & {
  readonly incidentId: ServiceIncidentId
  readonly message: string
}

export class PostgresServiceStatusManager implements ServiceStatusSource {
  private readonly database: Kysely<GatewayDatabase>

  constructor(database: Kysely<GatewayDatabase>) {
    this.database = database
  }

  async listPublicIncidents(): Promise<readonly PublicServiceIncident[]> {
    const result = await sql`
      select
        incidents.incident_id as id,
        incidents.impact,
        incidents.title,
        incidents.started_at as "startedAt",
        incidents.resolved_at as "resolvedAt",
        latest.status,
        latest.message,
        latest.occurred_at as "updatedAt"
      from service_incidents incidents
      join lateral (
        select status, message, occurred_at
        from service_incident_updates
        where incident_id = incidents.incident_id
        order by sequence desc
        limit 1
      ) latest on true
      order by
        (incidents.resolved_at is null) desc,
        incidents.resolved_at desc nulls last,
        incidents.started_at desc
      limit 50
    `.execute(this.database)
    return z.array(publicIncidentSchema).parse(result.rows)
  }

  async open(command: OpenServiceIncidentCommand): Promise<ServiceIncidentId> {
    return this.database.transaction().execute(async (transaction) => {
      const incidentId = ServiceIncidentIdSchema.parse(randomUUID())
      const occurredAt = sql<Date>`date_trunc('milliseconds', statement_timestamp())`
      const inserted = await transaction
        .insertInto("serviceIncidents")
        .values({
          impact: command.impact,
          incidentId,
          resolvedAt: null,
          startedAt: occurredAt,
          title: command.title,
        })
        .returning("startedAt")
        .executeTakeFirstOrThrow()
      await transaction
        .insertInto("serviceIncidentUpdates")
        .values({
          incidentId,
          message: command.message,
          occurredAt: inserted.startedAt,
          status: "investigating",
        })
        .execute()
      await appendPostgresAuditEvent(transaction, {
        action: "status.incident_open",
        actorIdHash: command.actorIdHash,
        actorType: "operator",
        affectedCount: 1,
        occurredAt: inserted.startedAt,
        outcome: "succeeded",
        subjectHash: hashAuditValue(incidentId),
        ticketHash: command.ticketHash,
      })
      return incidentId
    })
  }

  async update(command: UpdateServiceIncidentCommand): Promise<boolean> {
    return this.appendUpdate(command, command.status, "status.incident_update")
  }

  async resolve(command: ResolveServiceIncidentCommand): Promise<boolean> {
    return this.appendUpdate(command, "resolved", "status.incident_resolve")
  }

  private async appendUpdate(
    command: ResolveServiceIncidentCommand | UpdateServiceIncidentCommand,
    status: z.infer<typeof ServiceIncidentStatusSchema>,
    action: "status.incident_resolve" | "status.incident_update",
  ): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const incident = await transaction
        .selectFrom("serviceIncidents")
        .select("resolvedAt")
        .where("incidentId", "=", command.incidentId)
        .forUpdate()
        .executeTakeFirst()
      if (incident === undefined || incident.resolvedAt !== null) {
        return false
      }
      const occurredAt = await transaction
        .selectNoFrom(sql<Date>`date_trunc('milliseconds', statement_timestamp())`.as("value"))
        .executeTakeFirstOrThrow()
      await transaction
        .insertInto("serviceIncidentUpdates")
        .values({
          incidentId: command.incidentId,
          message: command.message,
          occurredAt: occurredAt.value,
          status,
        })
        .execute()
      switch (status) {
        case "investigating":
        case "monitoring":
          break
        case "resolved":
          await transaction
            .updateTable("serviceIncidents")
            .set({ resolvedAt: occurredAt.value })
            .where("incidentId", "=", command.incidentId)
            .execute()
          break
        default: {
          const unreachable: never = status
          return unreachable
        }
      }
      await appendPostgresAuditEvent(transaction, {
        action,
        actorIdHash: command.actorIdHash,
        actorType: "operator",
        affectedCount: 1,
        occurredAt: occurredAt.value,
        outcome: "succeeded",
        subjectHash: hashAuditValue(command.incidentId),
        ticketHash: command.ticketHash,
      })
      return true
    })
  }
}
