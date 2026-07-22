import { describe, expect, it } from "vitest"
import { GrowfulRequestQuota } from "../src/http/growful-request-quota.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"

describe("Growful request quota", () => {
  it("returns the fixed-window retry delay after the connection limit", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse("quota-limited-installed-app")
    const quota = new GrowfulRequestQuota({
      limit: 2,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      windowMilliseconds: 60_000,
    })

    // When
    const outcomes = await Promise.all([
      quota.consume(installedAppId),
      quota.consume(installedAppId),
      quota.consume(installedAppId),
    ])

    // Then
    expect(outcomes).toEqual([null, null, 60])
  })

  it("keeps connection quotas isolated", async () => {
    // Given
    const firstInstalledAppId = InstalledAppIdSchema.parse("quota-first-installed-app")
    const secondInstalledAppId = InstalledAppIdSchema.parse("quota-second-installed-app")
    const quota = new GrowfulRequestQuota({
      limit: 1,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
      windowMilliseconds: 60_000,
    })
    await quota.consume(firstInstalledAppId)

    // When
    const outcome = await quota.consume(secondInstalledAppId)

    // Then
    expect(outcome).toBeNull()
  })

  it("starts a fresh window after the previous minute", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse("quota-reset-installed-app")
    let now = new Date("2026-07-22T00:00:00.000Z")
    const quota = new GrowfulRequestQuota({
      limit: 1,
      now: () => now,
      windowMilliseconds: 60_000,
    })
    await quota.consume(installedAppId)
    now = new Date("2026-07-22T00:01:00.000Z")

    // When
    const outcome = await quota.consume(installedAppId)

    // Then
    expect(outcome).toBeNull()
  })
})
