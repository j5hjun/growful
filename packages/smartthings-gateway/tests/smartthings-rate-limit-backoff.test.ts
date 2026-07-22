import { describe, expect, it } from "vitest"
import { SmartThingsRateLimitBackoff } from "../src/http/smartthings-rate-limit-backoff.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"

describe("SmartThings rate-limit backoff", () => {
  it("accepts an HTTP-date Retry-After value", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse("rate-limited-installed-app")
    const backoff = new SmartThingsRateLimitBackoff({
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    })

    // When
    await backoff.observeResponse(installedAppId, {
      body: Buffer.from('{"error":"Too Many Requests"}'),
      headers: { "retry-after": "Wed, 22 Jul 2026 00:00:10 GMT" },
      statusCode: 429,
    })

    // Then
    await expect(backoff.getRetryAfterSeconds(installedAppId)).resolves.toBe(10)
  })

  it("releases a connection after its Retry-After period", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse("expiring-rate-limit-installed-app")
    let currentTime = new Date("2026-07-22T00:00:00.000Z")
    const backoff = new SmartThingsRateLimitBackoff({ now: () => currentTime })
    await backoff.observeResponse(installedAppId, {
      body: Buffer.alloc(0),
      headers: { "retry-after": "10" },
      statusCode: 429,
    })

    // When
    currentTime = new Date("2026-07-22T00:00:10.000Z")

    // Then
    await expect(backoff.getRetryAfterSeconds(installedAppId)).resolves.toBeNull()
  })

  it("ignores an invalid Retry-After value", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse("invalid-rate-limit-installed-app")
    const backoff = new SmartThingsRateLimitBackoff()

    // When
    await backoff.observeResponse(installedAppId, {
      body: Buffer.alloc(0),
      headers: { "retry-after": "later" },
      statusCode: 429,
    })

    // Then
    await expect(backoff.getRetryAfterSeconds(installedAppId)).resolves.toBeNull()
  })

  it("keeps the later Retry-After deadline", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse("extended-rate-limit-installed-app")
    const backoff = new SmartThingsRateLimitBackoff({
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    })
    await backoff.observeResponse(installedAppId, {
      body: Buffer.alloc(0),
      headers: { "retry-after": "17" },
      statusCode: 429,
    })

    // When
    await backoff.observeResponse(installedAppId, {
      body: Buffer.alloc(0),
      headers: { "retry-after": "5" },
      statusCode: 429,
    })

    // Then
    await expect(backoff.getRetryAfterSeconds(installedAppId)).resolves.toBe(17)
  })
})
