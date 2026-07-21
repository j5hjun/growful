import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import type { ServiceDisclosures } from "../config.js"
import type { OAuthService } from "../oauth/oauth-service.js"
import { getPrivateBetaInviteUsername, type PrivateBetaInvite } from "../private-beta/invite.js"
import { renderOAuthCompletion } from "./oauth-completion.js"
import {
  type OAuthDeviceRange,
  parseOAuthDeviceRangeSelection,
  parseOAuthScopeSelection,
  renderOAuthScopeSelection,
} from "./oauth-scope-selection.js"

const callbackQuerySchema = z.union([
  z.object({ code: z.string().min(1), state: z.string().min(1) }),
  z.object({ error: z.literal("access_denied"), state: z.string().min(1) }),
])
const maximumPrivateBetaFailures = 5
const privateBetaFailureWindowMs = 60_000
const maximumPrivateBetaRateLimitBuckets = 1_024

type PrivateBetaFailureBucket = {
  failures: number
  readonly resetsAtMs: number
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

export type OAuthRouteOptions = {
  readonly authorizationOrigin: string
  readonly oauthAccess: OAuthAccessPolicy
  readonly redirectOrigin: string
  readonly service: OAuthService
}

export type OAuthAccessPolicy = ServiceDisclosures &
  (
    | { readonly mode: "public" }
    | {
        readonly invites: readonly PrivateBetaInvite[]
        readonly mode: "private_beta"
      }
  )

export class InvalidOAuthOriginError extends Error {
  override readonly name = "InvalidOAuthOriginError"

  constructor() {
    super("OAuth selection origin is invalid")
  }
}

function sendOAuthScopeSelectionPage(
  reply: FastifyReply,
  authorizationOrigin: string,
  access: OAuthAccessPolicy,
  options: {
    readonly deviceRange?: OAuthDeviceRange
    readonly showSelectionError: boolean
    readonly statusCode: 200 | 400
  } = {
    showSelectionError: false,
    statusCode: 200,
  },
) {
  return reply
    .header("Cache-Control", "no-store")
    .header(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${authorizationOrigin} https://account.smartthings.com https://account.samsung.com; base-uri 'none'; frame-ancestors 'none'`,
    )
    .header("Referrer-Policy", "same-origin")
    .header("X-Frame-Options", "DENY")
    .type("text/html; charset=utf-8")
    .status(options.statusCode)
    .send(
      renderOAuthScopeSelection({
        deviceRange: options.deviceRange ?? "selected",
        disclosures: access,
        showSelectionError: options.showSelectionError,
      }),
    )
}

function getOAuthStartUsername(
  request: FastifyRequest,
  access: OAuthAccessPolicy,
): string | null | undefined {
  return access.mode === "public"
    ? null
    : (getPrivateBetaInviteUsername(request.headers.authorization, access.invites) ?? undefined)
}

function requireOAuthStartAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  access: OAuthAccessPolicy,
  rateLimiter: PrivateBetaAccessRateLimiter,
) {
  if (access.mode === "public") {
    return undefined
  }
  const rateLimitKey = request.ip
  const retryAfterSeconds = rateLimiter.check(rateLimitKey)
  if (retryAfterSeconds !== null) {
    return reply
      .header("Cache-Control", "no-store")
      .header("Retry-After", String(retryAfterSeconds))
      .status(429)
      .send({ error: "private_beta_access_rate_limited" as const })
  }
  if (getOAuthStartUsername(request, access) !== undefined) {
    rateLimiter.recordSuccess(rateLimitKey)
    return undefined
  }
  rateLimiter.recordFailure(rateLimitKey)
  return reply
    .header("Cache-Control", "no-store")
    .header("WWW-Authenticate", 'Basic realm="Growful private beta", charset="UTF-8"')
    .status(401)
    .send({ error: "private_beta_access_required" as const })
}

export function registerOAuthRoutes(app: FastifyInstance, options: OAuthRouteOptions): void {
  const privateBetaRateLimiter = new PrivateBetaAccessRateLimiter()
  app.get(
    "/oauth/start",
    {
      onRequest: async (request, reply) =>
        requireOAuthStartAccess(request, reply, options.oauthAccess, privateBetaRateLimiter),
    },
    async (_request, reply) =>
      sendOAuthScopeSelectionPage(reply, options.authorizationOrigin, options.oauthAccess),
  )

  app.post(
    "/oauth/start",
    {
      bodyLimit: 4_096,
      onRequest: async (request, reply) => {
        const accessDenied = requireOAuthStartAccess(
          request,
          reply,
          options.oauthAccess,
          privateBetaRateLimiter,
        )
        if (accessDenied !== undefined) {
          return accessDenied
        }
        if (request.headers.origin !== options.redirectOrigin) {
          throw new InvalidOAuthOriginError()
        }
        return undefined
      },
    },
    async (request, reply) => {
      const scopes = parseOAuthScopeSelection(request.body)
      if (scopes === null) {
        return sendOAuthScopeSelectionPage(
          reply,
          options.authorizationOrigin,
          options.oauthAccess,
          {
            deviceRange: parseOAuthDeviceRangeSelection(request.body) ?? "selected",
            showSelectionError: true,
            statusCode: 400,
          },
        )
      }
      const privateBetaUsername = getOAuthStartUsername(request, options.oauthAccess)
      if (privateBetaUsername === undefined) {
        return requireOAuthStartAccess(request, reply, options.oauthAccess, privateBetaRateLimiter)
      }
      const authorizationUrl = await options.service.startAuthorization({
        policyVersion: options.oauthAccess.policyVersion,
        privateBetaUsername,
        requestedScopes: scopes,
      })
      return reply.redirect(authorizationUrl.toString())
    },
  )

  app.get("/oauth/callback", async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query)
    if ("error" in query) {
      await options.service.cancelAuthorization(query.state)
      return reply.status(400).send({ error: "authorization_denied" as const })
    }
    const completion = await options.service.completeAuthorization(query.code, query.state)
    return reply
      .header("Cache-Control", "no-store")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      )
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY")
      .type("text/html; charset=utf-8")
      .send(renderOAuthCompletion(completion.growfulToken))
  })
}
