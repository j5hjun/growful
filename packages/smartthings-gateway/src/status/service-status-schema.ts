import { type ColumnType, type Generated, type Kysely, sql } from "kysely"
import type { GatewayDatabase } from "../storage/database.js"

type Timestamp = ColumnType<Date, Date, Date>
type NullableTimestamp = ColumnType<Date | null, Date | null | undefined, Date | null>

export type ServiceIncidentTable = {
  readonly impact: string
  readonly incidentId: string
  readonly resolvedAt: NullableTimestamp
  readonly startedAt: Timestamp
  readonly title: string
}

export type ServiceIncidentUpdateTable = {
  readonly incidentId: string
  readonly message: string
  readonly occurredAt: Timestamp
  readonly sequence: Generated<string>
  readonly status: string
}

export async function ensureServiceStatusStorage(database: Kysely<GatewayDatabase>): Promise<void> {
  await sql`
    create table if not exists service_incidents (
      incident_id uuid primary key,
      impact text not null,
      title varchar(120) not null,
      started_at timestamptz not null,
      resolved_at timestamptz,
      constraint service_incidents_impact_check check (impact in ('degraded', 'outage')),
      constraint service_incidents_title_check check (char_length(title) between 1 and 120)
    )
  `.execute(database)
  await sql`
    create table if not exists service_incident_updates (
      sequence bigserial primary key,
      incident_id uuid not null references service_incidents(incident_id) on delete cascade,
      status text not null,
      message varchar(2000) not null,
      occurred_at timestamptz not null,
      constraint service_incident_updates_status_check
        check (status in ('investigating', 'monitoring', 'resolved')),
      constraint service_incident_updates_message_check
        check (char_length(message) between 1 and 2000)
    )
  `.execute(database)
  await sql`
    create index if not exists service_incident_updates_incident_time_index
    on service_incident_updates (incident_id, occurred_at desc, sequence desc)
  `.execute(database)
  await sql`
    create index if not exists service_incidents_started_at_index
    on service_incidents (started_at desc)
  `.execute(database)
}
