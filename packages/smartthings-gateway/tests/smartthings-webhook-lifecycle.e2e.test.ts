import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import {
  createSmartThingsWebhookFixture,
  lifecycleEventBody,
  requestDate,
  signedHeaders,
  storedTokens,
  webhookNow,
  webhookPath,
} from "./fixtures/smartthings-webhook-fixture.js"

const apps: FastifyInstance[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings webhook", () => {
  it("deletes stored tokens when a signed DELETE lifecycle event arrives", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("DELETE")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({})
    expect(fixture.store.tokens).toBeNull()
    expect(fixture.keyProvider).toHaveBeenCalledWith("/pl/useast2/growful-test")
  })

  it("rejects an unsigned event without deleting stored tokens", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    fixture.store.seedTokens(storedTokens())

    // When
    const response = await fixture.app.inject({
      headers: { "content-type": "application/json" },
      method: "POST",
      payload: lifecycleEventBody("DELETE"),
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("rejects a key identifier that escapes the SmartThings key namespace", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("DELETE")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body, requestDate, "/../unexpected"),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(fixture.keyProvider).not.toHaveBeenCalled()
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("acknowledges a repeated signed DELETE after the connection is already gone", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    const body = lifecycleEventBody("DELETE")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
  })

  it("acknowledges a signed UPDATE lifecycle event without deleting tokens", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("UPDATE")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(200)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("rejects a signed lifecycle event for a different SmartThings app", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("DELETE", "different-app")

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("rejects a signed event when the body digest was changed", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    fixture.store.seedTokens(storedTokens())
    const signedBody = lifecycleEventBody("DELETE")
    const changedBody = `${signedBody} `

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(signedBody),
      method: "POST",
      payload: changedBody,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })

  it("rejects a signed event older than five minutes", async () => {
    // Given
    const fixture = createSmartThingsWebhookFixture(apps)
    fixture.store.seedTokens(storedTokens())
    const body = lifecycleEventBody("DELETE")
    const staleDate = new Date(webhookNow.getTime() - 5 * 60 * 1_000 - 1).toUTCString()

    // When
    const response = await fixture.app.inject({
      headers: signedHeaders(body, staleDate),
      method: "POST",
      payload: body,
      url: webhookPath,
    })

    // Then
    expect(response.statusCode).toBe(401)
    expect(fixture.store.tokens).toEqual(storedTokens())
  })
})
