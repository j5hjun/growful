import { Writable } from "node:stream"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import {
  createSmartThingsWebhookFixture,
  lifecycleEventBody,
  signedHeaders,
  webhookPath,
} from "./fixtures/smartthings-webhook-fixture.js"

const webhookLogSchema = z
  .object({
    errorClass: z.string().optional(),
    level: z.number(),
    messageType: z.enum(["CONFIRMATION", "EVENT"]).optional(),
    msg: z.string(),
    result: z.string().optional(),
    statusCode: z.number().int().optional(),
  })
  .passthrough()

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

function captureWebhookLogs() {
  const chunks: string[] = []
  const logger = {
    level: "info",
    stream: new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk))
        done()
      },
    }),
  }
  return {
    logger,
    raw: () => chunks.join(""),
    webhook: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => webhookLogSchema.parse(JSON.parse(line)))
        .filter((entry) => entry.msg.startsWith("smartthings.webhook.")),
  }
}

describe("SmartThings webhook observability", () => {
  it("classifies an invalid confirmation payload as a sanitized 400 failure", async () => {
    // Given
    const logs = captureWebhookLogs()
    const fixture = createSmartThingsWebhookFixture(apps, undefined, logs.logger)

    // When
    const response = await fixture.app.inject({
      method: "POST",
      payload: {
        confirmationData: {
          appId: "growful-app",
          confirmationUrl:
            "https://attacker.example/v1/apps/growful-app/confirm-registration?token=confirmation-token-secret",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(logs.webhook()).toEqual([
      expect.objectContaining({ level: 30, msg: "smartthings.webhook.received" }),
      expect.objectContaining({
        errorClass: "invalid_request",
        level: 40,
        msg: "smartthings.webhook.failed",
        statusCode: 400,
      }),
    ])
    expect(logs.raw()).not.toContain("attacker.example")
    expect(logs.raw()).not.toContain("confirmation-token-secret")
    expect(logs.raw()).not.toContain("growful-app")
  })

  it("classifies an invalid event signature as a sanitized 401 failure", async () => {
    // Given
    const logs = captureWebhookLogs()
    const fixture = createSmartThingsWebhookFixture(apps, undefined, logs.logger)
    const body = lifecycleEventBody("DELETE")

    // When
    const response = await fixture.app.inject({
      headers: {
        authorization: "Signature header-secret",
        "content-type": "application/json",
        date: "Wed, 22 Jul 2026 00:00:00 GMT",
        digest: "SHA256=digest-secret",
        "x-forwarded-for": "203.0.113.42",
        "x-user-id": "user-identifier-secret",
      },
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(logs.webhook()).toEqual([
      expect.objectContaining({ level: 30, msg: "smartthings.webhook.received" }),
      expect.objectContaining({
        errorClass: "invalid_signature",
        level: 40,
        msg: "smartthings.webhook.failed",
        statusCode: 401,
      }),
    ])
    expect(logs.raw()).not.toContain("header-secret")
    expect(logs.raw()).not.toContain("digest-secret")
    expect(logs.raw()).not.toContain("webhook-installed-app")
    expect(logs.raw()).not.toContain("growful-location")
    expect(logs.raw()).not.toContain("203.0.113.42")
    expect(logs.raw()).not.toContain("user-identifier-secret")
  })

  it("classifies a confirmation request failure as a sanitized 502 failure", async () => {
    // Given
    const logs = captureWebhookLogs()
    const confirmationRequester = vi.fn(async (_url: URL) => {
      throw new Error("smartthings-response-body-secret")
    })
    const fixture = createSmartThingsWebhookFixture(apps, confirmationRequester, logs.logger)

    // When
    const response = await fixture.app.inject({
      method: "POST",
      payload: {
        confirmationData: {
          appId: "growful-app",
          confirmationUrl:
            "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=confirmation-token-secret",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(502)
    expect(logs.webhook()).toEqual([
      expect.objectContaining({ level: 30, msg: "smartthings.webhook.received" }),
      expect.objectContaining({
        level: 30,
        messageType: "CONFIRMATION",
        msg: "smartthings.webhook.validated",
      }),
      expect.objectContaining({
        errorClass: "confirmation_request_failed",
        level: 50,
        msg: "smartthings.webhook.failed",
        statusCode: 502,
      }),
    ])
    expect(logs.raw()).not.toContain("smartthings-response-body-secret")
    expect(logs.raw()).not.toContain("confirmation-token-secret")
    expect(logs.raw()).not.toContain("growful-app")
  })

  it("records validated and completed confirmation stages without sensitive values", async () => {
    // Given
    const logs = captureWebhookLogs()
    const fixture = createSmartThingsWebhookFixture(apps, undefined, logs.logger)

    // When
    const response = await fixture.app.inject({
      method: "POST",
      payload: {
        confirmationData: {
          appId: "growful-app",
          confirmationUrl:
            "https://api.smartthings.com/v1/apps/growful-app/confirm-registration?token=confirmation-token-secret",
        },
        messageType: "CONFIRMATION",
      },
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(logs.webhook()).toEqual([
      expect.objectContaining({ level: 30, msg: "smartthings.webhook.received" }),
      expect.objectContaining({
        level: 30,
        messageType: "CONFIRMATION",
        msg: "smartthings.webhook.validated",
      }),
      expect.objectContaining({
        level: 30,
        messageType: "CONFIRMATION",
        msg: "smartthings.webhook.completed",
        result: "confirmation_completed",
      }),
    ])
    expect(logs.raw()).not.toContain("confirmation-token-secret")
    expect(logs.raw()).not.toContain("growful-app")
    expect(logs.raw()).not.toContain("api.smartthings.com")
  })

  it.each([
    ["DELETE", "connection_deleted"],
    ["UPDATE", "acknowledged"],
  ] as const)(
    "records one validated result for a signed %s lifecycle",
    async (lifecycle, result) => {
      // Given
      const logs = captureWebhookLogs()
      const fixture = createSmartThingsWebhookFixture(apps, undefined, logs.logger)
      const body = lifecycleEventBody(lifecycle)

      // When
      const response = await fixture.app.inject({
        headers: signedHeaders(body),
        method: "POST",
        payload: body,
        url: webhookPath,
      })

      // Then
      expect(response.statusCode).toBe(200)
      expect(logs.webhook()).toEqual([
        expect.objectContaining({ level: 30, msg: "smartthings.webhook.received" }),
        expect.objectContaining({
          level: 30,
          messageType: "EVENT",
          msg: "smartthings.webhook.validated",
        }),
        expect.objectContaining({
          level: 30,
          messageType: "EVENT",
          msg: "smartthings.webhook.completed",
          result,
        }),
      ])
      expect(logs.raw()).not.toContain("webhook-installed-app")
      expect(logs.raw()).not.toContain("growful-location")
      expect(logs.raw()).not.toContain("growful-test")
    },
  )
})
