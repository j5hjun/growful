import type { FastifyReply, FastifyRequest } from "fastify"
import type { ServiceDisclosures } from "../config.js"
import type { PrivateBetaInviteAccess } from "./invite-access.js"

const maximumPrivateBetaFailures = 5
const privateBetaFailureWindowMs = 60_000
const maximumPrivateBetaRateLimitBuckets = 1_024

type PrivateBetaFailureBucket = {
  failures: number
  readonly resetsAtMs: number
}

export type OAuthAccessPolicy = ServiceDisclosures &
  (
    | { readonly mode: "public" }
    | {
        readonly inviteAccess: PrivateBetaInviteAccess
        readonly mode: "private_beta"
      }
  )

class PrivateBetaAccessRateLimiter {
  private readonly buckets = new Map<string, PrivateBetaFailureBucket>()

  check(key: string, nowMs = Date.now()): number | null {
    this.prune(nowMs)
    const bucket = this.buckets.get(key)
    if (bucket === undefined || bucket.failures < maximumPrivateBetaFailures) {
      return null
    }
    return Math.max(1, Math.ceil((bucket.resetsAtMs - nowMs) / 1_000))
  }

  recordFailure(key: string, nowMs = Date.now()): void {
    this.prune(nowMs)
    const current = this.buckets.get(key)
    if (current !== undefined) {
      current.failures += 1
      return
    }
    while (this.buckets.size >= maximumPrivateBetaRateLimitBuckets) {
      const oldestKey = this.buckets.keys().next().value
      if (oldestKey === undefined) break
      this.buckets.delete(oldestKey)
    }
    this.buckets.set(key, { failures: 1, resetsAtMs: nowMs + privateBetaFailureWindowMs })
  }

  recordSuccess(key: string): void {
    this.buckets.delete(key)
  }

  private prune(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetsAtMs <= nowMs) this.buckets.delete(key)
    }
  }
}

export class PrivateBetaAccessGate {
  private readonly rateLimiter = new PrivateBetaAccessRateLimiter()

  constructor(private readonly access: OAuthAccessPolicy) {}

  async getUsername(request: FastifyRequest): Promise<string | null | undefined> {
    return this.access.mode === "public"
      ? null
      : ((await this.access.inviteAccess.authenticate(request.headers.authorization)) ?? undefined)
  }

  async require(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    if (this.access.mode === "public") {
      return undefined
    }
    const rateLimitKey = request.ip
    const retryAfterSeconds = this.rateLimiter.check(rateLimitKey)
    if (retryAfterSeconds !== null) {
      return reply
        .header("Cache-Control", "no-store")
        .header("Retry-After", String(retryAfterSeconds))
        .status(429)
        .send({ error: "private_beta_access_rate_limited" as const })
    }
    if ((await this.getUsername(request)) !== undefined) {
      this.rateLimiter.recordSuccess(rateLimitKey)
      return undefined
    }
    this.rateLimiter.recordFailure(rateLimitKey)
    return reply
      .header("Cache-Control", "no-store")
      .header("WWW-Authenticate", 'Basic realm="Growful private beta", charset="UTF-8"')
      .status(401)
      .send({ error: "private_beta_access_required" as const })
  }
}
