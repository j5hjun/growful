import { type Kysely, sql } from "kysely"
import { type Migration, type MigrationProvider, Migrator } from "kysely/migration"
import { ensurePrivateBetaInviteStorage } from "../private-beta/invite-schema.js"
import { ensureServiceStatusStorage } from "../status/service-status-schema.js"
import { ensureAuditEventStorage } from "./audit-schema.js"
import type { GatewayDatabase } from "./database.js"

export class DatabaseMigrationError extends Error {
  override readonly name = "DatabaseMigrationError"

  constructor(options?: ErrorOptions) {
    super("SmartThings Gateway database migration failed", options)
  }
}

const initialMigration: Migration = {
  async up(database) {
    await database.schema
      .createTable("oauthStates")
      .ifNotExists()
      .addColumn("stateHash", "varchar(64)", (column) => column.primaryKey())
      .addColumn("expiresAt", "timestamptz", (column) => column.notNull())
      .addColumn("requestedScopes", "text", (column) => column.notNull().defaultTo(""))
      .execute()

    await database.schema
      .createTable("oauthTokens")
      .ifNotExists()
      .addColumn("installedAppId", "text", (column) => column.primaryKey())
      .addColumn("accessTokenCiphertext", "text", (column) => column.notNull())
      .addColumn("refreshTokenCiphertext", "text", (column) => column.notNull())
      .addColumn("expiresAt", "timestamptz", (column) => column.notNull())
      .addColumn("scope", "text", (column) => column.notNull())
      .addColumn("tokenType", "text", (column) => column.notNull())
      .addColumn("updatedAt", "timestamptz", (column) => column.notNull())
      .addColumn("lastRefreshedAt", "timestamptz")
      .addColumn("lastRefreshError", "text")
      .addColumn("refreshClaimedUntil", "timestamptz")
      .addColumn("refreshClaimId", "text")
      .execute()
  },
}

const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return { "001_initial": initialMigration }
  },
}

export async function runMigrations(database: Kysely<GatewayDatabase>): Promise<void> {
  const migrator = new Migrator({ db: database, provider: migrationProvider })
  const result = await migrator.migrateToLatest()
  if (result.error !== undefined) {
    throw new DatabaseMigrationError({ cause: result.error })
  }
  // Keep this additive change out of migration history so the 001-only image remains rollbackable.
  await sql`alter table oauth_states add column if not exists requested_scopes text not null default ''`.execute(
    database,
  )
  await sql`alter table oauth_states add column if not exists consented_at timestamptz`.execute(
    database,
  )
  await sql`alter table oauth_states add column if not exists policy_version varchar(64)`.execute(
    database,
  )
  await sql`alter table oauth_states add column if not exists private_beta_username text`.execute(
    database,
  )
  await sql`alter table oauth_states add column if not exists private_beta_invite_generation text`.execute(
    database,
  )
  await sql`create index if not exists oauth_states_expires_at_index on oauth_states (expires_at)`.execute(
    database,
  )
  // Keep the multi-connection table outside migration history so the previous image can roll back.
  // The previous image sees an empty oauth_tokens table and therefore fails closed as disconnected.
  await sql`
    create table if not exists smart_things_connections (
      installed_app_id text primary key,
      growful_token_hash varchar(64) not null unique,
      growful_token_created_at timestamptz not null,
      consented_at timestamptz,
      policy_version varchar(64),
      private_beta_invite_generation text,
      private_beta_username text,
      growful_quota_window_started_at timestamptz,
      growful_quota_accepted_count integer not null default 0,
      growful_quota_rejected_count integer not null default 0,
      growful_quota_last_rejected_at timestamptz,
      rate_limited_until timestamptz,
      service_blocked_at timestamptz,
      service_block_reason text,
      access_token_ciphertext text not null,
      refresh_token_ciphertext text not null,
      expires_at timestamptz not null,
      scope text not null,
      token_type text not null,
      updated_at timestamptz not null,
      last_refreshed_at timestamptz,
      last_refresh_error text,
      refresh_claimed_until timestamptz,
      refresh_claim_id text
    )
  `.execute(database)
  await sql`alter table smart_things_connections add column if not exists consented_at timestamptz`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists policy_version varchar(64)`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists private_beta_username text`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists private_beta_invite_generation text`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists growful_quota_window_started_at timestamptz`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists growful_quota_accepted_count integer not null default 0`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists growful_quota_rejected_count integer not null default 0`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists growful_quota_last_rejected_at timestamptz`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists rate_limited_until timestamptz`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists service_blocked_at timestamptz`.execute(
    database,
  )
  await sql`alter table smart_things_connections add column if not exists service_block_reason text`.execute(
    database,
  )
  await ensurePrivateBetaInviteStorage(database)
  await ensureServiceStatusStorage(database)
  await ensureAuditEventStorage(database)
  await database.deleteFrom("oauthTokens").execute()
}
