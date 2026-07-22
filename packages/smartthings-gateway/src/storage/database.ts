import { CamelCasePlugin, type ColumnType, type Generated, Kysely, PostgresDialect } from "kysely"
import { Pool } from "pg"
import type { PrivateBetaInviteTable } from "../private-beta/invite-schema.js"
import type {
  ServiceIncidentTable,
  ServiceIncidentUpdateTable,
} from "../status/service-status-schema.js"

export { DatabaseMigrationError, runMigrations } from "./database-migrations.js"

type Timestamp = ColumnType<Date, Date, Date>
type NullableTimestamp = ColumnType<Date | null, Date | null | undefined, Date | null>

export type OAuthStateTable = {
  readonly consentedAt: Timestamp | null
  readonly expiresAt: Timestamp
  readonly policyVersion: string | null
  readonly privateBetaInviteGeneration: string | null
  readonly privateBetaUsername: string | null
  readonly privacyDeletionEpoch: Generated<string>
  readonly requestedScopes: string
  readonly stateHash: string
}

export type PrivacyDeletionEpochTable = {
  readonly deletionEpoch: string
  readonly subjectHash: string
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
  readonly consentedAt: Timestamp | null
  readonly growfulTokenCreatedAt: Timestamp
  readonly growfulTokenHash: string
  readonly policyVersion: string | null
  readonly privateBetaInviteGeneration: string | null
  readonly privateBetaUsername: string | null
  readonly requestQuotaAcceptedCount: Generated<number>
  readonly requestQuotaLastRejectedAt: NullableTimestamp
  readonly requestQuotaRejectedCount: Generated<number>
  readonly requestQuotaWindowStartedAt: NullableTimestamp
  readonly rateLimitedUntil: NullableTimestamp
  readonly serviceBlockedAt: NullableTimestamp
  readonly serviceBlockReason: string | null
}

export type AuditEventTable = {
  readonly action: string
  readonly actorIdHash: string | null
  readonly actorType: string
  readonly affectedCount: number | null
  readonly eventHash: string
  readonly eventId: string
  readonly occurredAt: Timestamp
  readonly outcome: string
  readonly previousHash: string | null
  readonly sequence: Generated<string>
  readonly subjectHash: string | null
  readonly ticketHash: string | null
}

export type GatewayDatabase = {
  readonly auditEvents: AuditEventTable
  readonly oauthStates: OAuthStateTable
  readonly oauthTokens: OAuthTokenTable
  readonly privacyDeletionEpochs: PrivacyDeletionEpochTable
  readonly privateBetaInvites: PrivateBetaInviteTable
  readonly serviceIncidents: ServiceIncidentTable
  readonly serviceIncidentUpdates: ServiceIncidentUpdateTable
  readonly smartThingsConnections: SmartThingsConnectionTable
}

export type CreateDatabaseOptions = {
  readonly onIdleClientError?: (error: Error) => void
}

export function createDatabase(
  databaseUrl: string,
  options: CreateDatabaseOptions = {},
): Kysely<GatewayDatabase> {
  const pool = new Pool({
    application_name: "growful-smartthings-gateway",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    statement_timeout: 15_000,
  })
  pool.on("error", options.onIdleClientError ?? (() => undefined))
  return new Kysely<GatewayDatabase>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new CamelCasePlugin()],
  })
}

export async function revokeCredentialsForLegacyRollback(
  database: Kysely<GatewayDatabase>,
): Promise<void> {
  await database.transaction().execute(async (transaction) => {
    await transaction.deleteFrom("oauthStates").execute()
    await transaction.deleteFrom("smartThingsConnections").execute()
    await transaction.deleteFrom("oauthTokens").execute()
  })
}
