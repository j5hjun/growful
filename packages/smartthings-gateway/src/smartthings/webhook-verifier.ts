import { createHash, timingSafeEqual, verify as verifySignature } from "node:crypto"
import ky from "ky"
import { z } from "zod"

const authorizationParameterSchema = z.tuple([
  z.enum(["algorithm", "headers", "keyId", "signature"]),
  z.string().min(1),
])
const authorizationSchema = z
  .object({
    algorithm: z.literal("rsa-sha256"),
    headers: z.literal("(request-target) digest date"),
    keyId: z
      .string()
      .regex(/^\/pl\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/)
      .max(512)
      .refine((value) => value.split("/").every((segment) => segment !== "." && segment !== "..")),
    signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
const digestSchema = z
  .string()
  .regex(/^SHA-?256=[A-Za-z0-9+/]+={0,2}$/i)
  .transform((value) => value.slice(value.indexOf("=") + 1))
const requestHeadersSchema = z.object({
  authorization: z.string().min(1),
  date: z.string().min(1),
  digest: z.string().min(1),
})
const publicKeySchema = z.string().min(1).max(16_384)
const webhookSignatureLifetimeMs = 5 * 60 * 1_000
const publicKeyCacheLifetimeMs = 4 * 60 * 60 * 1_000
const failedPublicKeyCacheLifetimeMs = 30 * 1_000
const maximumCachedPublicKeys = 128
const maximumConcurrentPublicKeyRequests = 8
const smartThingsKeyOrigin = new URL("https://key.smartthings.com")

type Authorization = z.infer<typeof authorizationSchema>

type CachedPublicKey = {
  readonly expiresAtMs: number
  readonly pem: string | null
}

export type SmartThingsWebhookKeyProvider = (keyId: string) => Promise<string>

export type SmartThingsWebhookVerification = {
  readonly body: Buffer
  readonly headers: unknown
  readonly method: string
  readonly now: Date
  readonly publicKeyProvider: SmartThingsWebhookKeyProvider
  readonly rawUrl: string
}

export class InvalidSmartThingsWebhookSignatureError extends Error {
  override readonly name = "InvalidSmartThingsWebhookSignatureError"

  constructor() {
    super("SmartThings webhook signature is invalid")
  }
}

export class SmartThingsWebhookPublicKeyClient {
  private readonly cache = new Map<string, CachedPublicKey>()
  private readonly inFlight = new Map<string, Promise<string>>()

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly requestPublicKey: SmartThingsWebhookKeyProvider = async (keyId) =>
      ky.get(new URL(`/key${keyId}`, smartThingsKeyOrigin), { retry: 0, timeout: 5_000 }).text(),
  ) {}

  readonly getPublicKey: SmartThingsWebhookKeyProvider = async (keyId) => {
    const parsedKeyId = authorizationSchema.shape.keyId.parse(keyId)
    const nowMs = this.now().getTime()
    this.pruneCache(nowMs)
    const cached = this.cache.get(parsedKeyId)
    if (cached !== undefined && cached.expiresAtMs > nowMs) {
      this.cache.delete(parsedKeyId)
      this.cache.set(parsedKeyId, cached)
      return cached.pem ?? invalidSignature()
    }
    const pending = this.inFlight.get(parsedKeyId)
    if (pending !== undefined) return pending
    if (this.inFlight.size >= maximumConcurrentPublicKeyRequests) return invalidSignature()
    const request = this.fetchAndCache(parsedKeyId, nowMs)
    this.inFlight.set(parsedKeyId, request)
    try {
      return await request
    } finally {
      this.inFlight.delete(parsedKeyId)
    }
  }

  private async fetchAndCache(keyId: string, nowMs: number): Promise<string> {
    try {
      const pem = publicKeySchema.parse(await this.requestPublicKey(keyId))
      this.setCached(keyId, { expiresAtMs: nowMs + publicKeyCacheLifetimeMs, pem })
      return pem
    } catch {
      this.setCached(keyId, { expiresAtMs: nowMs + failedPublicKeyCacheLifetimeMs, pem: null })
      return invalidSignature()
    }
  }

  private pruneCache(nowMs: number): void {
    for (const [keyId, cached] of this.cache) {
      if (cached.expiresAtMs <= nowMs) this.cache.delete(keyId)
    }
  }

  private setCached(keyId: string, cached: CachedPublicKey): void {
    this.cache.delete(keyId)
    while (this.cache.size >= maximumCachedPublicKeys) {
      const oldestKeyId = this.cache.keys().next().value
      if (oldestKeyId === undefined) break
      this.cache.delete(oldestKeyId)
    }
    this.cache.set(keyId, cached)
  }
}

function invalidSignature(): never {
  throw new InvalidSmartThingsWebhookSignatureError()
}

function parseAuthorization(header: string): Authorization {
  if (!header.startsWith("Signature ")) {
    return invalidSignature()
  }
  const entries = header
    .slice("Signature ".length)
    .split(",")
    .map((part) => {
      const match = /^\s*([A-Za-z]+)="([^"]+)"\s*$/.exec(part)
      const parsed = authorizationParameterSchema.safeParse(match?.slice(1))
      return parsed.success ? parsed.data : invalidSignature()
    })
  if (new Set(entries.map(([name]) => name)).size !== entries.length) {
    return invalidSignature()
  }
  const parsed = authorizationSchema.safeParse(Object.fromEntries(entries))
  return parsed.success ? parsed.data : invalidSignature()
}

function verifyDigest(body: Buffer, digestHeader: string): void {
  const parsedDigest = digestSchema.safeParse(digestHeader)
  if (!parsedDigest.success) {
    invalidSignature()
  }
  const expected = createHash("sha256").update(body).digest()
  const received = Buffer.from(parsedDigest.data, "base64")
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    invalidSignature()
  }
}

export async function verifySmartThingsWebhook(request: SmartThingsWebhookVerification) {
  const parsedHeaders = requestHeadersSchema.safeParse(request.headers)
  if (!parsedHeaders.success) {
    return invalidSignature()
  }
  const authorization = parseAuthorization(parsedHeaders.data.authorization)
  const requestTimeMs = Date.parse(parsedHeaders.data.date)
  if (
    !Number.isFinite(requestTimeMs) ||
    Math.abs(request.now.getTime() - requestTimeMs) > webhookSignatureLifetimeMs
  ) {
    return invalidSignature()
  }
  verifyDigest(request.body, parsedHeaders.data.digest)

  const signingString = [
    `(request-target): ${request.method.toLowerCase()} ${request.rawUrl}`,
    `digest: ${parsedHeaders.data.digest}`,
    `date: ${parsedHeaders.data.date}`,
  ].join("\n")
  const publicKey = await request.publicKeyProvider(authorization.keyId)
  const verified = verifySignature(
    "RSA-SHA256",
    Buffer.from(signingString, "utf8"),
    publicKey,
    Buffer.from(authorization.signature, "base64"),
  )
  if (!verified) {
    return invalidSignature()
  }
}
