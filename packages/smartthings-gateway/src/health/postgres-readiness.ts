import type { Kysely } from "kysely"
import type { GatewayDatabase } from "../storage/database.js"
import type { ReadinessProbe, ReadinessStatus } from "./readiness.js"

export type PostgresReadinessProbeOptions = {
  readonly auditIntegrityProbe: ReadinessProbe
  readonly database: Kysely<GatewayDatabase>
}

export class PostgresReadinessProbe implements ReadinessProbe {
  private readonly auditIntegrityProbe: ReadinessProbe
  private readonly database: Kysely<GatewayDatabase>

  constructor(options: PostgresReadinessProbeOptions) {
    this.auditIntegrityProbe = options.auditIntegrityProbe
    this.database = options.database
  }

  async check(): Promise<ReadinessStatus> {
    try {
      const [, , , auditIntegrityStatus] = await Promise.all([
        this.database
          .selectFrom("smartThingsConnections")
          .select("installedAppId")
          .limit(1)
          .execute(),
        this.database.selectFrom("auditEvents").select("sequence").limit(1).execute(),
        this.database.selectFrom("privateBetaInvites").select("username").limit(1).execute(),
        this.auditIntegrityProbe.check(),
      ])
      return auditIntegrityStatus
    } catch (error) {
      if (error instanceof Error) return "unavailable"
      throw error
    }
  }
}
