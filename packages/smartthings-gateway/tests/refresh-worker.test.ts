import { describe, expect, it } from "vitest"
import {
  type RefreshService,
  runTokenRefresh,
  startRefreshWorker,
} from "../src/oauth/refresh-worker.js"

class DueRefreshService implements RefreshService {
  calls = 0

  async refreshIfDue(): Promise<boolean> {
    this.calls += 1
    return true
  }
}

class SecretBearingRefreshError extends Error {
  override readonly name = "SecretBearingRefreshError"
}

class FailingRefreshService implements RefreshService {
  async refreshIfDue(): Promise<boolean> {
    throw new SecretBearingRefreshError("refresh-token-must-not-be-logged")
  }
}

describe("runTokenRefresh", () => {
  it("delegates one refresh check to the OAuth service", async () => {
    // Given
    const service = new DueRefreshService()

    // When
    const refreshed = await runTokenRefresh(service)

    // Then
    expect(refreshed).toBe(true)
    expect(service.calls).toBe(1)
  })

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
    stop()

    expect(loggedFields).toEqual({ errorName: "SecretBearingRefreshError" })
  })
})
