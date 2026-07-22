import { type Kysely, sql } from "kysely"
import { z } from "zod"
import type { InstalledAppId } from "../oauth/contracts.js"
import type { GatewayDatabase } from "../storage/database.js"
import type { SmartThingsProxyResponse } from "./smartthings-proxy.js"

const retryAfterHeaderSchema = z.union([z.string(), z.array(z.string()).min(1)])
const retryAfterSecondsSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)$/)
  .transform(Number)
  .pipe(z.int().nonnegative())
const retryAfterDateSchema = z
  .string()
  .transform((value) => Date.parse(value))
  .pipe(z.number())

export type SmartThingsRateLimitBackoffOptions = {
  readonly now?: () => Date
  readonly store?: SmartThingsRateLimitBackoffStore
}

export interface SmartThingsRateLimitBackoffStore {
  extendAvailableAt(installedAppId: InstalledAppId, availableAt: Date): Promise<void>
  getAvailableAt(installedAppId: InstalledAppId): Promise<Date | null>
}

export class MemorySmartThingsRateLimitBackoffStore implements SmartThingsRateLimitBackoffStore {
  private readonly availableAtByConnection = new Map<InstalledAppId, Date>()

  async extendAvailableAt(installedAppId: InstalledAppId, availableAt: Date): Promise<void> {
    const currentAvailableAt = this.availableAtByConnection.get(installedAppId)
    if (currentAvailableAt === undefined || availableAt > currentAvailableAt) {
      this.availableAtByConnection.set(installedAppId, availableAt)
    }
  }

  async getAvailableAt(installedAppId: InstalledAppId): Promise<Date | null> {
    return this.availableAtByConnection.get(installedAppId) ?? null
  }
}

export type PostgresSmartThingsRateLimitBackoffStoreOptions = {
  readonly database: Kysely<GatewayDatabase>
}

export class PostgresSmartThingsRateLimitBackoffStore implements SmartThingsRateLimitBackoffStore {
  private readonly database: Kysely<GatewayDatabase>

  constructor(options: PostgresSmartThingsRateLimitBackoffStoreOptions) {
    this.database = options.database
  }

  async extendAvailableAt(installedAppId: InstalledAppId, availableAt: Date): Promise<void> {
    await this.database
      .updateTable("smartThingsConnections")
      .set({
        rateLimitedUntil: sql<Date>`greatest(
          coalesce(rate_limited_until, '-infinity'::timestamptz),
          ${availableAt}
        )`,
      })
      .where("installedAppId", "=", installedAppId)
      .execute()
  }

  async getAvailableAt(installedAppId: InstalledAppId): Promise<Date | null> {
    const row = await this.database
      .selectFrom("smartThingsConnections")
      .select("rateLimitedUntil")
      .where("installedAppId", "=", installedAppId)
      .executeTakeFirst()
    return (
      z
        .object({ rateLimitedUntil: z.date().nullable() })
        .nullable()
        .parse(row ?? null)?.rateLimitedUntil ?? null
    )
  }
}

export class SmartThingsRateLimitBackoff {
  private readonly now: () => Date
  private readonly store: SmartThingsRateLimitBackoffStore

  constructor(options: SmartThingsRateLimitBackoffOptions = {}) {
    this.now = options.now ?? (() => new Date())
    this.store = options.store ?? new MemorySmartThingsRateLimitBackoffStore()
  }

  async getRetryAfterSeconds(installedAppId: InstalledAppId): Promise<number | null> {
    const availableAt = await this.store.getAvailableAt(installedAppId)
    if (availableAt === null) {
      return null
    }
    const remainingMilliseconds = availableAt.getTime() - this.now().getTime()
    if (remainingMilliseconds <= 0) {
      return null
    }
    return Math.ceil(remainingMilliseconds / 1_000)
  }

  async observeResponse(
    installedAppId: InstalledAppId,
    response: SmartThingsProxyResponse,
  ): Promise<void> {
    if (response.statusCode !== 429) {
      return
    }
    const parsedHeader = retryAfterHeaderSchema.safeParse(response.headers["retry-after"])
    if (!parsedHeader.success) {
      return
    }
    const rawHeader =
      typeof parsedHeader.data === "string" ? parsedHeader.data : parsedHeader.data[0]
    if (rawHeader === undefined) {
      return
    }
    const parsedSeconds = retryAfterSecondsSchema.safeParse(rawHeader)
    const parsedDate = retryAfterDateSchema.safeParse(rawHeader)
    const availableAt = parsedSeconds.success
      ? new Date(this.now().getTime() + parsedSeconds.data * 1_000)
      : parsedDate.success
        ? new Date(parsedDate.data)
        : null
    if (availableAt === null) {
      return
    }
    await this.store.extendAvailableAt(installedAppId, availableAt)
  }
}
