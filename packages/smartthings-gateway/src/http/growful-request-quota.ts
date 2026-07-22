import { type Kysely, sql } from "kysely"
import { z } from "zod"
import type { InstalledAppId } from "../oauth/contracts.js"
import type { GatewayDatabase } from "../storage/database.js"

const defaultRequestLimit = 60
const defaultWindowMilliseconds = 60_000

export type GrowfulRequestQuotaConsumption = {
  readonly installedAppId: InstalledAppId
  readonly limit: number
  readonly now: Date
  readonly windowMilliseconds: number
}

export interface GrowfulRequestQuotaStore {
  consume(consumption: GrowfulRequestQuotaConsumption): Promise<number | null>
}

type RequestWindow = {
  readonly acceptedCount: number
  readonly startedAt: Date
}

export class MemoryGrowfulRequestQuotaStore implements GrowfulRequestQuotaStore {
  private readonly windows = new Map<InstalledAppId, RequestWindow>()

  async consume(consumption: GrowfulRequestQuotaConsumption): Promise<number | null> {
    const currentWindow = this.windows.get(consumption.installedAppId)
    if (
      currentWindow === undefined ||
      consumption.now.getTime() - currentWindow.startedAt.getTime() >=
        consumption.windowMilliseconds
    ) {
      this.windows.set(consumption.installedAppId, {
        acceptedCount: 1,
        startedAt: consumption.now,
      })
      return null
    }
    if (currentWindow.acceptedCount >= consumption.limit) {
      return Math.ceil(
        (currentWindow.startedAt.getTime() +
          consumption.windowMilliseconds -
          consumption.now.getTime()) /
          1_000,
      )
    }
    this.windows.set(consumption.installedAppId, {
      acceptedCount: currentWindow.acceptedCount + 1,
      startedAt: currentWindow.startedAt,
    })
    return null
  }
}

export type PostgresGrowfulRequestQuotaStoreOptions = {
  readonly database: Kysely<GatewayDatabase>
}

export class PostgresGrowfulRequestQuotaStore implements GrowfulRequestQuotaStore {
  private readonly database: Kysely<GatewayDatabase>

  constructor(options: PostgresGrowfulRequestQuotaStoreOptions) {
    this.database = options.database
  }

  async consume(consumption: GrowfulRequestQuotaConsumption): Promise<number | null> {
    const result = await sql<{
      readonly acceptedCount: number
      readonly consumedAt: Date
      readonly windowStartedAt: Date
    }>`
      update smart_things_connections
      set
        growful_quota_rejected_count = case
          when growful_quota_window_started_at is not null
            and growful_quota_window_started_at >
              statement_timestamp() - ${consumption.windowMilliseconds} * interval '1 millisecond'
            and growful_quota_accepted_count >= ${consumption.limit}
          then least(growful_quota_rejected_count + 1, 2147483647)
          else growful_quota_rejected_count
        end,
        growful_quota_last_rejected_at = case
          when growful_quota_window_started_at is not null
            and growful_quota_window_started_at >
              statement_timestamp() - ${consumption.windowMilliseconds} * interval '1 millisecond'
            and growful_quota_accepted_count >= ${consumption.limit}
          then statement_timestamp()
          else growful_quota_last_rejected_at
        end,
        growful_quota_accepted_count = case
          when growful_quota_window_started_at is null
            or growful_quota_window_started_at <=
              statement_timestamp() - ${consumption.windowMilliseconds} * interval '1 millisecond'
          then 1
          else least(growful_quota_accepted_count + 1, ${consumption.limit + 1})
        end,
        growful_quota_window_started_at = case
          when growful_quota_window_started_at is null
            or growful_quota_window_started_at <=
              statement_timestamp() - ${consumption.windowMilliseconds} * interval '1 millisecond'
          then statement_timestamp()
          else growful_quota_window_started_at
        end
      where installed_app_id = ${consumption.installedAppId}
      returning
        growful_quota_accepted_count as "acceptedCount",
        statement_timestamp() as "consumedAt",
        growful_quota_window_started_at as "windowStartedAt"
    `.execute(this.database)
    const row = z
      .object({
        acceptedCount: z.int().nonnegative(),
        consumedAt: z.date(),
        windowStartedAt: z.date(),
      })
      .nullable()
      .parse(result.rows[0] ?? null)
    if (row === null || row.acceptedCount <= consumption.limit) {
      return null
    }
    return Math.ceil(
      (row.windowStartedAt.getTime() + consumption.windowMilliseconds - row.consumedAt.getTime()) /
        1_000,
    )
  }
}

export type GrowfulRequestQuotaOptions = {
  readonly limit?: number
  readonly now?: () => Date
  readonly store?: GrowfulRequestQuotaStore
  readonly windowMilliseconds?: number
}

export class GrowfulRequestQuota {
  private readonly limit: number
  private readonly now: () => Date
  private readonly store: GrowfulRequestQuotaStore
  private readonly windowMilliseconds: number

  constructor(options: GrowfulRequestQuotaOptions = {}) {
    this.limit = options.limit ?? defaultRequestLimit
    this.now = options.now ?? (() => new Date())
    this.store = options.store ?? new MemoryGrowfulRequestQuotaStore()
    this.windowMilliseconds = options.windowMilliseconds ?? defaultWindowMilliseconds
  }

  async consume(installedAppId: InstalledAppId): Promise<number | null> {
    return this.store.consume({
      installedAppId,
      limit: this.limit,
      now: this.now(),
      windowMilliseconds: this.windowMilliseconds,
    })
  }
}
