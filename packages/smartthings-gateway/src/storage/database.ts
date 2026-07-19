import { CamelCasePlugin, type ColumnType, Kysely, PostgresDialect } from "kysely"
import { type Migration, type MigrationProvider, Migrator } from "kysely/migration"
import { Pool } from "pg"

type Timestamp = ColumnType<Date, Date, Date>

export type OAuthStateTable = {
  readonly expiresAt: Timestamp
  readonly stateHash: string
}

export type OAuthTokenTable = {
  readonly accessTokenCiphertext: string
  readonly expiresAt: Timestamp
  readonly installedAppId: string
  readonly lastRefreshError: string | null
  readonly lastRefreshedAt: Timestamp | null
  readonly refreshClaimedUntil: Timestamp | null
  readonly refreshTokenCiphertext: string
  readonly scope: string
  readonly tokenType: string
  readonly updatedAt: Timestamp
}

export type GatewayDatabase = {
  readonly oauthStates: OAuthStateTable
  readonly oauthTokens: OAuthTokenTable
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
}
