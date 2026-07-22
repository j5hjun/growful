import { generateKeyPairSync } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import {
  InvalidSmartThingsWebhookSignatureError,
  SmartThingsWebhookPublicKeyClient,
} from "../src/smartthings/webhook-verifier.js"

const now = new Date("2026-07-22T00:00:00.000Z")
const publicKey = generateKeyPairSync("rsa", { modulusLength: 2_048 })
  .publicKey.export({
    format: "pem",
    type: "spki",
  })
  .toString()

describe("SmartThings webhook public key client", () => {
  it("coalesces concurrent requests for the same public key", async () => {
    // Given
    let resolveRequest: ((value: string) => void) | undefined
    const requestPublicKey = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          resolveRequest = resolve
        }),
    )
    const client = new SmartThingsWebhookPublicKeyClient(() => now, requestPublicKey)

    // When
    const first = client.getPublicKey("/pl/useast2/shared-key")
    const second = client.getPublicKey("/pl/useast2/shared-key")
    resolveRequest?.(publicKey)

    // Then
    await expect(first).resolves.toBe(publicKey)
    await expect(second).resolves.toBe(publicKey)
    expect(requestPublicKey).toHaveBeenCalledTimes(1)
  })

  it("temporarily caches failed key lookups", async () => {
    // Given
    const requestPublicKey = vi.fn(async () => {
      throw new Error("missing")
    })
    const client = new SmartThingsWebhookPublicKeyClient(() => now, requestPublicKey)

    // When / Then
    await expect(client.getPublicKey("/pl/useast2/missing-key")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )
    await expect(client.getPublicKey("/pl/useast2/missing-key")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )
    expect(requestPublicKey).toHaveBeenCalledTimes(1)
  })

  it("rejects and temporarily caches malformed public keys", async () => {
    // Given
    const requestPublicKey = vi.fn(async () => "not-a-public-key")
    const client = new SmartThingsWebhookPublicKeyClient(() => now, requestPublicKey)

    // When / Then
    await expect(client.getPublicKey("/pl/useast2/malformed-key")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )
    await expect(client.getPublicKey("/pl/useast2/malformed-key")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )
    expect(requestPublicKey).toHaveBeenCalledTimes(1)
  })

  it("rejects a parseable non-RSA public key", async () => {
    // Given
    const ecPublicKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
      .publicKey.export({ format: "pem", type: "spki" })
      .toString()
    const requestPublicKey = vi.fn(async () => ecPublicKey)
    const client = new SmartThingsWebhookPublicKeyClient(() => now, requestPublicKey)

    // When / Then
    await expect(client.getPublicKey("/pl/useast2/ec-key")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )
    await expect(client.getPublicKey("/pl/useast2/ec-key")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )
    expect(requestPublicKey).toHaveBeenCalledTimes(1)
  })

  it("retries a failed key lookup after the negative cache expires", async () => {
    // Given
    let currentTime = now
    const requestPublicKey = vi.fn(async () => {
      throw new Error("missing")
    })
    const client = new SmartThingsWebhookPublicKeyClient(() => currentTime, requestPublicKey)

    // When
    await expect(client.getPublicKey("/pl/useast2/missing-key")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )
    currentTime = new Date(now.getTime() + 30_001)
    await expect(client.getPublicKey("/pl/useast2/missing-key")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )

    // Then
    expect(requestPublicKey).toHaveBeenCalledTimes(2)
  })

  it("rejects excess distinct lookups while the concurrency budget is full", async () => {
    // Given
    const pendingResolvers: Array<(value: string) => void> = []
    const requestPublicKey = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          pendingResolvers.push(resolve)
        }),
    )
    const client = new SmartThingsWebhookPublicKeyClient(() => now, requestPublicKey)
    const accepted = Array.from({ length: 8 }, (_, index) =>
      client.getPublicKey(`/pl/useast2/key-${index}`),
    )

    // When / Then
    await expect(client.getPublicKey("/pl/useast2/over-budget")).rejects.toBeInstanceOf(
      InvalidSmartThingsWebhookSignatureError,
    )
    expect(requestPublicKey).toHaveBeenCalledTimes(8)
    for (const resolve of pendingResolvers) resolve(publicKey)
    await expect(Promise.all(accepted)).resolves.toEqual(Array(8).fill(publicKey))
  })

  it("evicts the oldest key when the bounded cache is full", async () => {
    // Given
    const requestPublicKey = vi.fn(async () => publicKey)
    const client = new SmartThingsWebhookPublicKeyClient(() => now, requestPublicKey)

    // When
    for (let index = 0; index < 129; index += 1) {
      await client.getPublicKey(`/pl/useast2/key-${index}`)
    }
    await client.getPublicKey("/pl/useast2/key-0")

    // Then
    expect(requestPublicKey).toHaveBeenCalledTimes(130)
  })
})
