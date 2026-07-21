import { CamelCasePlugin, type ColumnType, Kysely, PostgresDialect, sql } from "kysely"
import { type Migration, type MigrationProvider, Migrator } from "kysely/migration"
import { Pool } from "pg"

type Timestamp = ColumnType<Date, Date, Date>

export type OAuthStateTable = {
  readonly expiresAt: Timestamp
  readonly requestedScopes: string
  readonly stateHash: string
}

export type OAuthTokenTable = {
  readonly accessTokenCiphertext: string
  readonly expiresAt: Timestamp
  readonly installedAppId: string
  readonly lastRefreshError: string | null
  readonly lastRefreshedAt: Timestamp | null
  readonly refreshClaimedUntil: Timestamp | null
  readonly refreshClaimId: string | null
  readonly refreshTokenCiphertext: string
  readonly scope: string
  readonly tokenType: string
  readonly updatedAt: Timestamp
}

export type SmartThingsConnectionTable = OAuthTokenTable & {
  readonly growfulTokenCreatedAt: Timestamp
  readonly growfulTokenHash: string
}

export type GatewayDatabase = {
  readonly oauthStates: OAuthStateTable
  readonly oauthTokens: OAuthTokenTable
  readonly smartThingsConnections: SmartThingsConnectionTable
}

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

export function createDatabase(databaseUrl: string): Kysely<GatewayDatabase> {
  const pool = new Pool({
    application_name: "growful-smartthings-gateway",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    statement_timeout: 15_000,
  })
  return new Kysely<GatewayDatabase>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  })
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
  await database.deleteFrom("oauthTokens").execute()
}
