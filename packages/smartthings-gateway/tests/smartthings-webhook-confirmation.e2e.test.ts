import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createSmartThingsWebhookFixture,
  webhookPath,
} from "./fixtures/smartthings-webhook-fixture.js"

const apps: FastifyInstance[] = []

type ConfirmationRaceOutcome =
  | { readonly kind: "outbound" }
  | { readonly kind: "response"; readonly statusCode: number }

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings webhook", () => {
  it("confirms a validated SmartThings target URL", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    const confirmationUrl =
      "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=confirmation-token"

    // When
    const response = await fixture.app.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: {
        confirmationData: { appId: "growful-app", confirmationUrl },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(fixture.confirmationRequester).toHaveBeenCalledWith(new URL(confirmationUrl))
  })

  it("acknowledges a repeated completed confirmation without another outbound request", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    const payload = {
      confirmationData: {
        appId: "growful-app",
        confirmationUrl:
          "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=repeated-token",
      },
      messageType: "CONFIRMATION",
    }

    // When
    const first = await fixture.app.inject({ method: "POST", payload, url: webhookPath })
    const second = await fixture.app.inject({ method: "POST", payload, url: webhookPath })

    // Then
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(fixture.confirmationRequester).toHaveBeenCalledTimes(1)
  })

  it("rate limits a different confirmation after a successful outbound request", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    const request = (token: string) =>
      fixture.app.inject({
        method: "POST",
        payload: {
          confirmationData: {
            appId: "growful-app",
            confirmationUrl: `https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=${token}`,
          },
          messageType: "CONFIRMATION",
        },
        url: webhookPath,
      })

    // When
    const firstResponse = await request("first-success-token")
    const immediateRetry = await request("second-success-token")

    // Then
    expect(firstResponse.statusCode).toBe(200)
    expect(immediateRetry.statusCode).toBe(429)
    expect(immediateRetry.headers["retry-after"]).toBe("60")
    expect(fixture.confirmationRequester).toHaveBeenCalledTimes(1)
  })

  it("allows only one outbound confirmation request at a time", async () => {
    // Given
    const pending = Promise.withResolvers<void>()
    const firstOutboundStarted = Promise.withResolvers<void>()
    const secondOutboundStarted = Promise.withResolvers<void>()
    let outboundRequestCount = 0
    const confirmationRequester = vi.fn(async (_url: URL) => {
      outboundRequestCount += 1
      if (outboundRequestCount === 1) {
        firstOutboundStarted.resolve()
      } else {
        secondOutboundStarted.resolve()
      }
      return pending.promise
    })
    const fixture = createSmartThingsWebhookFixture(apps, confirmationRequester)
    const request = (token: string) =>
      fixture.app.inject({
        method: "POST",
        payload: {
          confirmationData: {
            appId: "growful-app",
            confirmationUrl: `https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=${token}`,
          },
          messageType: "CONFIRMATION",
        },
        url: webhookPath,
      })

    // When
    const firstResponse = request("first-token")
    await firstOutboundStarted.promise
    const secondResponse = request("second-token")
    const secondOutcome = await Promise.race([
      secondResponse.then(
        (response): ConfirmationRaceOutcome => ({
          kind: "response",
          statusCode: response.statusCode,
        }),
      ),
      secondOutboundStarted.promise.then((): ConfirmationRaceOutcome => ({ kind: "outbound" })),
    ])
    pending.resolve()
    const responses = await Promise.all([firstResponse, secondResponse])

    // Then
    expect(outboundRequestCount).toBe(1)
    expect(secondOutcome).toEqual({ kind: "response", statusCode: 429 })
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 429])
  })

  it("rejects a confirmation URL outside the SmartThings API origin", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)

    // When
    const response = await fixture.app.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: {
        confirmationData: {
          appId: "growful-app",
          confirmationUrl:
            "https://attacker.example/v1/apps/growful-app/confirm-registration?token=confirmation-token",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(fixture.confirmationRequester).not.toHaveBeenCalled()
  })

  it("rejects a confirmation for a different SmartThings app", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)

    // When
    const response = await fixture.app.inject({
      method: "POST",
      payload: {
        confirmationData: {
          appId: "different-app",
          confirmationUrl:
            "https://api.smartthings.com/v1/apps/different-app/confirm-registration?token=confirmation-token",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(fixture.confirmationRequester).not.toHaveBeenCalled()
  })

  it("allows an immediate valid confirmation after an outbound failure", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    fixture.confirmationRequester.mockRejectedValueOnce(
      new Error("confirmation failed for token=failed-token"),
    )

    // When
    const response = await fixture.app.inject({
      method: "POST",
      payload: {
        confirmationData: {
          appId: "growful-app",
          confirmationUrl:
            "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=failed-token",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })
    const immediateRetry = await fixture.app.inject({
      method: "POST",
      payload: {
        confirmationData: {
          appId: "growful-app",
          confirmationUrl:
            "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=legitimate-token",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: "smartthings_confirmation_failed" })
    expect(response.body).not.toContain("failed-token")
    expect(immediateRetry.statusCode).toBe(200)
    expect(immediateRetry.headers["retry-after"]).toBeUndefined()
    expect(fixture.confirmationRequester).toHaveBeenCalledTimes(2)
    expect(fixture.confirmationRequester).toHaveBeenNthCalledWith(
      2,
      new URL(
        "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=legitimate-token",
      ),
    )
  })
})
