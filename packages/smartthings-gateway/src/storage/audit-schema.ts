import { type Kysely, sql } from "kysely"
import type { GatewayDatabase } from "./database.js"

export async function ensureAuditEventStorage(database: Kysely<GatewayDatabase>): Promise<void> {
  await sql`
    create table if not exists audit_events (
      sequence bigserial primary key,
      event_id uuid not null unique,
      occurred_at timestamptz not null,
      actor_type text not null,
      actor_id_hash varchar(64),
      action text not null,
      outcome text not null,
      subject_hash varchar(64),
      ticket_hash varchar(64),
      affected_count integer,
      previous_hash varchar(64),
      event_hash varchar(64) not null unique
    )
  `.execute(database)
  await sql`alter table audit_events add column if not exists actor_id_hash varchar(64)`.execute(
    database,
  )
  await sql`alter table audit_events add column if not exists ticket_hash varchar(64)`.execute(
    database,
  )
  await sql`create extension if not exists pgcrypto`.execute(database)
  await sql`
    create or replace function reject_audit_event_mutation()
    returns trigger
    language plpgsql
    as $function$
    begin
      raise exception 'audit_events is append-only';
    end;
    $function$
  `.execute(database)
  await sql`drop trigger if exists audit_events_append_only on audit_events`.execute(database)
  await sql`
    create trigger audit_events_append_only
    before update or delete or truncate on audit_events
    for each statement execute function reject_audit_event_mutation()
  `.execute(database)
  await sql`
    create or replace function append_connection_audit_event()
    returns trigger
    language plpgsql
    as $function$
    declare
      audit_action text;
      audit_event_hash text;
      audit_event_id uuid := gen_random_uuid();
      audit_installed_app_id text;
      audit_occurred_at timestamptz := date_trunc('milliseconds', clock_timestamp());
      audit_outcome text := 'succeeded';
      audit_previous_hash text;
      audit_subject_hash text;
    begin
      if tg_op = 'INSERT' then
        audit_action := 'connection.authorize';
        audit_installed_app_id := new.installed_app_id;
      elsif tg_op = 'UPDATE' then
        audit_installed_app_id := new.installed_app_id;
        if old.last_refresh_error is distinct from new.last_refresh_error
          and new.last_refresh_error is not null
        then
          audit_action := 'token.refresh';
          audit_outcome := 'failed';
        elsif old.growful_token_hash is distinct from new.growful_token_hash
          and (
            old.access_token_ciphertext is distinct from new.access_token_ciphertext
            or old.refresh_token_ciphertext is distinct from new.refresh_token_ciphertext
          )
        then
          audit_action := 'connection.authorize';
        elsif old.growful_token_hash is distinct from new.growful_token_hash then
          audit_action := 'connection.token_rotate';
        elsif old.access_token_ciphertext is distinct from new.access_token_ciphertext
          or old.refresh_token_ciphertext is distinct from new.refresh_token_ciphertext
        then
          audit_action := 'token.refresh';
        else
          return new;
        end if;
      elsif tg_op = 'DELETE' then
        audit_action := 'connection.disconnect';
        audit_installed_app_id := old.installed_app_id;
      else
        return null;
      end if;

      perform pg_advisory_xact_lock(718229501);
      select event_hash
      into audit_previous_hash
      from audit_events
      order by sequence desc
      limit 1;
      audit_subject_hash := encode(digest(audit_installed_app_id, 'sha256'), 'hex');
      audit_event_hash := encode(
        digest(
          concat_ws(
            '|',
            audit_event_id::text,
            to_char(
              audit_occurred_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'gateway_service',
            audit_action,
            audit_outcome,
            audit_subject_hash,
            '1',
            coalesce(audit_previous_hash, '')
          ),
          'sha256'
        ),
        'hex'
      );
      insert into audit_events (
        event_id,
        occurred_at,
        actor_type,
        actor_id_hash,
        action,
        outcome,
        subject_hash,
        ticket_hash,
        affected_count,
        previous_hash,
        event_hash
      ) values (
        audit_event_id,
        audit_occurred_at,
        'gateway_service',
        null,
        audit_action,
        audit_outcome,
        audit_subject_hash,
        null,
        1,
        audit_previous_hash,
        audit_event_hash
      );
      if tg_op = 'DELETE' then
        return old;
      end if;
      return new;
    end;
    $function$
  `.execute(database)
  await sql`drop trigger if exists smart_things_connections_audit on smart_things_connections`.execute(
    database,
  )
  await sql`
    create trigger smart_things_connections_audit
    after insert or update or delete on smart_things_connections
    for each row execute function append_connection_audit_event()
  `.execute(database)
}
