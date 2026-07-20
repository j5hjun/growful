import { describe, expect, it } from "vitest"
import { type RefreshService, startRefreshWorker } from "../src/oauth/refresh-worker.js"

class SecretBearingRefreshError extends Error {
  override readonly name = "SecretBearingRefreshError"
}

class FailingRefreshService implements RefreshService {
  async refreshDueConnections(): Promise<never> {
    throw new SecretBearingRefreshError("refresh-token-must-not-be-logged")
  }
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
})
