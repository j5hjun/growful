import type { FastifyReply, FastifyRequest } from "fastify"
import type { ServiceDisclosures } from "../config.js"
import type { OAuthAuthorization } from "../oauth/contracts.js"
import { renderPrivateBetaAccessGuidance } from "./access-guidance.js"
import type { PrivateBetaInviteAccess } from "./invite-access.js"

const maximumPrivateBetaFailures = 5
const privateBetaFailureWindowMs = 60_000
const maximumPrivateBetaRateLimitBuckets = 1_024
const privateBetaAccessContentSecurityPolicy =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

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

type OAuthRequestAccess = Pick<
  OAuthAuthorization,
  "privateBetaInviteGeneration" | "privateBetaUsername"
>

type MediaPreference = {
  readonly quality: number
  readonly specificity: number
}

function mediaPreference(
  accept: string,
  targetType: string,
  targetSubtype: string,
): MediaPreference {
  let preference: MediaPreference = { quality: 0, specificity: -1 }
  for (const mediaRange of accept.split(",")) {
    const [rawMediaType = "", ...parameters] = mediaRange
      .split(";")
      .map((part) => part.trim().toLowerCase())
    const [rangeType = "", rangeSubtype = ""] = rawMediaType.split("/")
    const specificity =
      rangeType === targetType && rangeSubtype === targetSubtype
        ? 2
        : rangeType === targetType && rangeSubtype === "*"
          ? 1
          : rangeType === "*" && rangeSubtype === "*"
            ? 0
            : -1
    if (specificity < 0) continue

    const qualityParameter = parameters.find((parameter) => parameter.startsWith("q="))
    const parsedQuality = qualityParameter === undefined ? 1 : Number(qualityParameter.slice(2))
    const quality =
      Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1 ? parsedQuality : 0
    if (
      specificity > preference.specificity ||
      (specificity === preference.specificity && quality > preference.quality)
    ) {
      preference = { quality, specificity }
    }
  }
  return preference
}

function acceptsHtml(accept: string | undefined): boolean {
  if (accept === undefined) return false
  const html = mediaPreference(accept, "text", "html")
  const json = mediaPreference(accept, "application", "json")
  if (html.quality !== json.quality) return html.quality > json.quality
  return html.quality > 0 && html.specificity > json.specificity
}

function prepareAccessErrorReply(reply: FastifyReply): FastifyReply {
  return reply
    .header("Cache-Control", "no-store")
    .header("Content-Security-Policy", privateBetaAccessContentSecurityPolicy)
    .header("Cross-Origin-Opener-Policy", "same-origin")
    .header("Cross-Origin-Resource-Policy", "same-origin")
    .header("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
    .header("Referrer-Policy", "no-referrer")
    .header("Vary", "Accept")
    .header("X-Content-Type-Options", "nosniff")
    .header("X-Frame-Options", "DENY")
}

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
  private readonly authenticatedRequests = new WeakMap<FastifyRequest, OAuthRequestAccess>()
  private readonly rateLimiter = new PrivateBetaAccessRateLimiter()

  constructor(private readonly access: OAuthAccessPolicy) {}

  async getAuthorizationAccess(request: FastifyRequest): Promise<OAuthRequestAccess | undefined> {
    const cachedAccess = this.authenticatedRequests.get(request)
    if (cachedAccess !== undefined) return cachedAccess
    const requestAccess =
      this.access.mode === "public"
        ? { privateBetaInviteGeneration: null, privateBetaUsername: null }
        : await this.access.inviteAccess.authenticate(request.headers.authorization)
    if (requestAccess === null) return undefined
    const authorizationAccess =
      "username" in requestAccess
        ? {
            privateBetaInviteGeneration: requestAccess.generation,
            privateBetaUsername: requestAccess.username,
          }
        : requestAccess
    this.authenticatedRequests.set(request, authorizationAccess)
    return authorizationAccess
  }

  async require(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    if (this.access.mode === "public") {
      return undefined
    }
    const rateLimitKey = request.ip
    const retryAfterSeconds = this.rateLimiter.check(rateLimitKey)
    if (retryAfterSeconds !== null) {
      const errorReply = prepareAccessErrorReply(reply)
        .header("Retry-After", String(retryAfterSeconds))
        .status(429)
      if (acceptsHtml(request.headers.accept)) {
        return errorReply
          .type("text/html; charset=utf-8")
          .send(renderPrivateBetaAccessGuidance({ kind: "rate_limited", retryAfterSeconds }))
      }
      return errorReply.send({ error: "private_beta_access_rate_limited" as const })
    }
    if ((await this.getAuthorizationAccess(request)) !== undefined) {
      this.rateLimiter.recordSuccess(rateLimitKey)
      return undefined
    }
    this.rateLimiter.recordFailure(rateLimitKey)
    const errorReply = prepareAccessErrorReply(reply)
      .header("WWW-Authenticate", 'Basic realm="Growful private beta", charset="UTF-8"')
      .status(401)
    if (acceptsHtml(request.headers.accept)) {
      return errorReply
        .type("text/html; charset=utf-8")
        .send(renderPrivateBetaAccessGuidance({ kind: "authentication_failed" }))
    }
    return errorReply.send({ error: "private_beta_access_required" as const })
  }
}
