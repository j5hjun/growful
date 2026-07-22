import { describe, expect, it } from "vitest"
import { type RefreshService, startRefreshWorker } from "../src/oauth/refresh-worker.js"

class SecretBearingRefreshError extends Error {
  override readonly name = "SecretBearingRefreshError"
}

class FailingRefreshService implements RefreshService {
  async purgeExpiredAuthorizationStates(): Promise<number> {
    return 0
  }

  async refreshDueConnections(): Promise<never> {
    throw new SecretBearingRefreshError("refresh-token-must-not-be-logged")
  }
}

class SecretBearingCleanupError extends Error {
  override readonly name = "SecretBearingCleanupError"
}

describe("startRefreshWorker", () => {
  it("logs only the error name when a refresh fails", async () => {
    let loggedFields: { readonly errorName: string } | undefined
    let notifyLogged: (() => void) | undefined
    const logged = new Promise<void>((resolve) => {
      notifyLogged = resolve
    })
    const stop = startRefreshWorker({
      intervalMs: 60_000,
      logger: {
        error(fields) {
          loggedFields = fields
          notifyLogged?.()
        },
        info() {},
      },
      service: new FailingRefreshService(),
    })

    await logged
    await stop()

    expect(loggedFields).toEqual({ errorName: "SecretBearingRefreshError" })
  })

  it("waits for an in-flight refresh before stopping", async () => {
    // Given
    let completeRefresh: (() => void) | undefined
    let notifyStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    const service: RefreshService = {
      async purgeExpiredAuthorizationStates() {
        return 0
      },
      async refreshDueConnections() {
        notifyStarted?.()
        await new Promise<void>((resolve) => {
          completeRefresh = resolve
        })
        return { failureNames: [], refreshedCount: 1 }
      },
    }
    const stop = startRefreshWorker({
      intervalMs: 60_000,
      logger: { error() {}, info() {} },
      service,
    })
    await started

    // When
    let stopped = false
    const stopping = stop().then(() => {
      stopped = true
    })
    await Promise.resolve()

    // Then
    expect(stopped).toBe(false)
    completeRefresh?.()
    await stopping
    expect(stopped).toBe(true)
  })

  it("continues token refresh when expired-state cleanup fails", async () => {
    // Given
    let cleanupAttempts = 0
    let refreshAttempts = 0
    let notifyRefreshed: (() => void) | undefined
    const refreshed = new Promise<void>((resolve) => {
      notifyRefreshed = resolve
    })
    const loggedEvents: { readonly errorName: string; readonly message: string }[] = []
    const service = {
      async purgeExpiredAuthorizationStates() {
        cleanupAttempts += 1
        throw new SecretBearingCleanupError("oauth-state-must-not-be-logged")
      },
      async refreshDueConnections() {
        refreshAttempts += 1
        notifyRefreshed?.()
        return { failureNames: [], refreshedCount: 0 }
      },
    }

    // When
    const stop = startRefreshWorker({
      intervalMs: 60_000,
      logger: {
        error(fields, message) {
          loggedEvents.push({ ...fields, message })
        },
        info() {},
      },
      service,
    })
    await refreshed
    await stop()

    // Then
    expect(cleanupAttempts).toBe(1)
    expect(refreshAttempts).toBe(1)
    expect(loggedEvents).toEqual([
      { errorName: "SecretBearingCleanupError", message: "oauth.state.cleanup.failed" },
    ])
  })
})
