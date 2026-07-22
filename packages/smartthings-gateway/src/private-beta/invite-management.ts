import { randomUUID } from "node:crypto"
import { type Kysely, sql } from "kysely"
import type { AuditEventHash } from "../audit/audit-event.js"
import { hashAuditValue } from "../audit/audit-event.js"
import { appendPostgresAuditEvent } from "../audit/postgres-audit-sink.js"
import type { GatewayDatabase } from "../storage/database.js"
import type { PrivateBetaInvite } from "./invite.js"

export type PrivateBetaInviteOperatorCommand = {
  readonly actorIdHash: AuditEventHash
  readonly ticketHash: AuditEventHash
  readonly username: string
}

export type PrivateBetaInviteIssueCommand = PrivateBetaInviteOperatorCommand & {
  readonly passwordHash: string
}

export type PrivateBetaInviteReview = {
  readonly issuedAt: Date | null
  readonly revokedAt: Date | null
  readonly source: "configured" | "database"
  readonly status: "active" | "revoked"
  readonly username: string
}

export type PrivateBetaInviteRevokeResult = {
  readonly changed: boolean
  readonly revokedConnections: number
  readonly revokedStates: number
}

export type PostgresPrivateBetaInviteManagerOptions = {
  readonly configuredInvites: readonly PrivateBetaInvite[]
  readonly database: Kysely<GatewayDatabase>
}

export class PostgresPrivateBetaInviteManager {
  private readonly configuredInvites: readonly PrivateBetaInvite[]
  private readonly database: Kysely<GatewayDatabase>

  constructor(options: PostgresPrivateBetaInviteManagerOptions) {
    this.configuredInvites = options.configuredInvites
    this.database = options.database
  }

  async listReviews(): Promise<readonly PrivateBetaInviteReview[]> {
    const storedInvites = await this.database
      .selectFrom("privateBetaInvites")
      .select(["issuedAt", "revokedAt", "username"])
      .execute()
    const storedUsernames = new Set(storedInvites.map((invite) => invite.username))
    return [
      ...this.configuredInvites
        .filter((invite) => !storedUsernames.has(invite.username))
        .map(
          (invite): PrivateBetaInviteReview => ({
            issuedAt: null,
            revokedAt: null,
            source: "configured",
            status: "active",
            username: invite.username,
          }),
        ),
      ...storedInvites.map(
        (invite): PrivateBetaInviteReview => ({
          issuedAt: invite.issuedAt,
          revokedAt: invite.revokedAt,
          source: "database",
          status: invite.revokedAt === null ? "active" : "revoked",
          username: invite.username,
        }),
      ),
    ].sort((left, right) => left.username.localeCompare(right.username))
  }

  async issue(command: PrivateBetaInviteIssueCommand): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${command.username}, 0))`.execute(
        transaction,
      )
      const existing = await transaction
        .selectFrom("privateBetaInvites")
        .select("revokedAt")
        .where("username", "=", command.username)
        .executeTakeFirst()
      const configuredInviteIsActive = this.configuredInvites.some(
        (invite) => invite.username === command.username,
      )
      if (
        (existing !== undefined && existing.revokedAt === null) ||
        (existing === undefined && configuredInviteIsActive)
      ) {
        return false
      }
      const issued =
        existing === undefined
          ? await transaction
              .insertInto("privateBetaInvites")
              .values({
                generationId: randomUUID(),
                issuedAt: sql<Date>`statement_timestamp()`,
                passwordHash: command.passwordHash,
                revokedAt: null,
                username: command.username,
              })
              .returning("issuedAt")
              .executeTakeFirstOrThrow()
          : await transaction
              .updateTable("privateBetaInvites")
              .set({
                generationId: randomUUID(),
                issuedAt: sql<Date>`statement_timestamp()`,
                passwordHash: command.passwordHash,
                revokedAt: null,
              })
              .where("username", "=", command.username)
              .returning("issuedAt")
              .executeTakeFirstOrThrow()
      await appendPostgresAuditEvent(transaction, {
        action: "invite.issue",
        actorIdHash: command.actorIdHash,
        actorType: "operator",
        affectedCount: 1,
        occurredAt: issued.issuedAt,
        outcome: "succeeded",
        subjectHash: hashAuditValue(command.username),
        ticketHash: command.ticketHash,
      })
      return true
    })
  }

  async revoke(command: PrivateBetaInviteOperatorCommand): Promise<PrivateBetaInviteRevokeResult> {
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${command.username}, 0))`.execute(
        transaction,
      )
      const existing = await transaction
        .selectFrom("privateBetaInvites")
        .select("revokedAt")
        .where("username", "=", command.username)
        .executeTakeFirst()
      if (existing?.revokedAt !== null && existing !== undefined) {
        return { changed: false, revokedConnections: 0, revokedStates: 0 }
      }
      const configuredInvite = this.configuredInvites.find(
        (invite) => invite.username === command.username,
      )
      if (existing === undefined && configuredInvite === undefined) {
        return { changed: false, revokedConnections: 0, revokedStates: 0 }
      }
      const revoked =
        existing === undefined && configuredInvite !== undefined
          ? await transaction
              .insertInto("privateBetaInvites")
              .values({
                generationId: randomUUID(),
                issuedAt: sql<Date>`statement_timestamp()`,
                passwordHash: configuredInvite.passwordHash,
                revokedAt: sql<Date>`statement_timestamp()`,
                username: command.username,
              })
              .returning(sql<Date>`statement_timestamp()`.as("occurredAt"))
              .executeTakeFirstOrThrow()
          : await transaction
              .updateTable("privateBetaInvites")
              .set({ revokedAt: sql<Date>`statement_timestamp()` })
              .where("username", "=", command.username)
              .returning(sql<Date>`statement_timestamp()`.as("occurredAt"))
              .executeTakeFirstOrThrow()
      const deletedStates = await transaction
        .deleteFrom("oauthStates")
        .where("privateBetaUsername", "=", command.username)
        .executeTakeFirst()
      const deletedConnections = await transaction
        .deleteFrom("smartThingsConnections")
        .where("privateBetaUsername", "=", command.username)
        .executeTakeFirst()
      const revokedStates = Number(deletedStates.numDeletedRows)
      const revokedConnections = Number(deletedConnections.numDeletedRows)
      await appendPostgresAuditEvent(transaction, {
        action: "invite.revoke",
        actorIdHash: command.actorIdHash,
        actorType: "operator",
        affectedCount: 1 + revokedStates + revokedConnections,
        occurredAt: revoked.occurredAt,
        outcome: "succeeded",
        subjectHash: hashAuditValue(command.username),
        ticketHash: command.ticketHash,
      })
      return { changed: true, revokedConnections, revokedStates }
    })
  }
}
