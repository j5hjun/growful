import { afterEach, describe, expect, it, vi } from "vitest"
import type { AuditChainVerification } from "../src/audit/audit-event.js"
import {
  type AuditIntegrityLogger,
  AuditIntegrityMonitor,
} from "../src/audit/audit-integrity-monitor.js"

type LoggedFailure = {
  readonly fields: Parameters<AuditIntegrityLogger["error"]>[0]
  readonly message: string
}

function captureLogger(): {
  readonly failures: LoggedFailure[]
  readonly logger: AuditIntegrityLogger
  readonly successes: Array<{
    readonly fields: Parameters<AuditIntegrityLogger["info"]>[0]
    readonly message: string
  }>
} {
  const failures: LoggedFailure[] = []
  const successes: Array<{
    readonly fields: Parameters<AuditIntegrityLogger["info"]>[0]
    readonly message: string
  }> = []
  return {
    failures,
    logger: {
      error(fields, message) {
        failures.push({ fields, message })
      },
      info(fields, message) {
        successes.push({ fields, message })
      },
    },
    successes,
  }
}

describe("AuditIntegrityMonitor", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("changes readiness when a valid audit chain becomes invalid", async () => {
    // Given
    let verification: AuditChainVerification = {
      eventCount: 2,
      lastEventHash: null,
      status: "valid",
    }
    const monitor = new AuditIntegrityMonitor(async () => verification)
    const { failures, logger, successes } = captureLogger()
    await monitor.refresh(logger)
    expect(await monitor.check()).toBe("ready")
    verification = {
      reason: "event_hash_mismatch",
      sequence: "2",
      status: "invalid",
    }

    // When
    await monitor.refresh(logger)

    // Then
    expect(await monitor.check()).toBe("unavailable")
    expect(successes).toEqual([{ fields: { eventCount: 2 }, message: "audit.integrity.verified" }])
    expect(failures).toEqual([
      {
        fields: {
          failureKind: "chain_invalid",
          reason: "event_hash_mismatch",
          sequence: "2",
        },
        message: "audit.integrity.failed",
      },
    ])
  })

  it("reports only the error class when verification cannot read storage", async () => {
    // Given
    class SecretBearingDatabaseError extends Error {
      override readonly name = "SecretBearingDatabaseError"
    }
    const monitor = new AuditIntegrityMonitor(async () => {
      throw new SecretBearingDatabaseError("postgresql://secret@database/gateway")
    })
    const { failures, logger } = captureLogger()

    // When
    await monitor.refresh(logger)

    // Then
    expect(await monitor.check()).toBe("unavailable")
    expect(failures).toEqual([
      {
        fields: {
          errorName: "SecretBearingDatabaseError",
          failureKind: "verification_failed",
        },
        message: "audit.integrity.failed",
      },
    ])
    expect(JSON.stringify(failures)).not.toContain("postgresql://")
  })

  it("restores readiness after a later valid verification", async () => {
    // Given
    let verification: AuditChainVerification = {
      reason: "previous_hash_mismatch",
      sequence: "4",
      status: "invalid",
    }
    const monitor = new AuditIntegrityMonitor(async () => verification)
    const { logger, successes } = captureLogger()
    await monitor.refresh(logger)
    verification = { eventCount: 4, lastEventHash: null, status: "valid" }

    // When
    await monitor.refresh(logger)

    // Then
    expect(await monitor.check()).toBe("ready")
    expect(successes).toEqual([{ fields: { eventCount: 4 }, message: "audit.integrity.verified" }])
  })

  it("periodically refreshes integrity and stops without leaving a timer", async () => {
    // Given
    vi.useFakeTimers()
    let verificationCount = 0
    const monitor = new AuditIntegrityMonitor(async () => {
      verificationCount += 1
      return { eventCount: 0, lastEventHash: null, status: "valid" }
    })
    const { logger } = captureLogger()
    const stop = monitor.start({ intervalMs: 5_000, logger })

    // When
    await vi.advanceTimersByTimeAsync(5_000)
    await stop()
    await vi.advanceTimersByTimeAsync(5_000)

    // Then
    expect(verificationCount).toBe(1)
    expect(await monitor.check()).toBe("ready")
  })
})
