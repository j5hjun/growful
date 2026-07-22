import type { ReadinessProbe, ReadinessStatus } from "../health/readiness.js"
import type { AuditChainVerification } from "./audit-event.js"

export type AuditIntegrityVerifier = () => Promise<AuditChainVerification>

export type AuditIntegrityLogger = {
  readonly error: (
    fields:
      | {
          readonly failureKind: "chain_invalid"
          readonly reason: Extract<AuditChainVerification, { readonly status: "invalid" }>["reason"]
          readonly sequence: string | null
        }
      | {
          readonly errorName: string
          readonly failureKind: "verification_failed"
        },
    message: string,
  ) => void
  readonly info: (fields: { readonly eventCount: number }, message: string) => void
}

export type AuditIntegrityMonitorSchedule = {
  readonly intervalMs: number
  readonly logger: AuditIntegrityLogger
}

export class AuditIntegrityMonitor implements ReadinessProbe {
  private activeRun: Promise<void> | undefined
  private hasCompletedVerification = false
  private status: ReadinessStatus = "unavailable"
  private readonly verify: AuditIntegrityVerifier

  constructor(verify: AuditIntegrityVerifier) {
    this.verify = verify
  }

  async check(): Promise<ReadinessStatus> {
    return this.status
  }

  async refresh(logger: AuditIntegrityLogger): Promise<void> {
    if (this.activeRun !== undefined) {
      return this.activeRun
    }
    const run = this.execute(logger)
    this.activeRun = run
    try {
      await run
    } finally {
      if (this.activeRun === run) {
        this.activeRun = undefined
      }
    }
  }

  start(schedule: AuditIntegrityMonitorSchedule): () => Promise<void> {
    const timer = setInterval(() => void this.refresh(schedule.logger), schedule.intervalMs)
    timer.unref()
    return async () => {
      clearInterval(timer)
      await this.activeRun
    }
  }

  private async execute(logger: AuditIntegrityLogger): Promise<void> {
    try {
      const result = await this.verify()
      switch (result.status) {
        case "valid":
          if (!this.hasCompletedVerification || this.status === "unavailable") {
            logger.info({ eventCount: result.eventCount }, "audit.integrity.verified")
          }
          this.status = "ready"
          this.hasCompletedVerification = true
          return
        case "invalid":
          if (!this.hasCompletedVerification || this.status === "ready") {
            logger.error(
              {
                failureKind: "chain_invalid",
                reason: result.reason,
                sequence: result.sequence,
              },
              "audit.integrity.failed",
            )
          }
          this.status = "unavailable"
          this.hasCompletedVerification = true
          return
        default: {
          const unreachable: never = result
          return unreachable
        }
      }
    } catch (error) {
      if (!this.hasCompletedVerification || this.status === "ready") {
        logger.error(
          {
            errorName: error instanceof Error ? error.name : "UnknownError",
            failureKind: "verification_failed",
          },
          "audit.integrity.failed",
        )
      }
      this.status = "unavailable"
      this.hasCompletedVerification = true
    }
  }
}
