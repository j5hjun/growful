import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  InvalidOAuthStateError,
  OAuthScopeMismatchError,
  type OAuthService,
} from "../oauth/oauth-service.js"
import {
  acceptsHtml,
  type OAuthAccessPolicy,
  PrivateBetaAccessGate,
} from "../private-beta/http-access.js"
import { SmartThingsTokenRequestError } from "../smartthings/smartthings-client.js"
import { HttpRequestRateLimitError, httpRateLimitPolicies } from "./http-rate-limit.js"
import {
  type OAuthCallbackResultKind,
  oauthCallbackResultKinds,
  renderOAuthCallbackResult,
} from "./oauth-callback-result.js"
import { renderOAuthCompletion } from "./oauth-completion.js"
import {
  type OAuthScopeSelectionDraft,
  type OAuthScopeSelectionIssueKind,
  parseOAuthScopeSelectionSubmission,
  renderOAuthScopeSelection,
} from "./oauth-scope-selection.js"
import {
  type OAuthStartErrorKind,
  oauthStartErrorKinds,
  parseOAuthStartRetryAfterSeconds,
  renderOAuthStartError,
} from "./oauth-start-error.js"
import { tokenSafetyClientScript } from "./token-safety.js"

const callbackQuerySchema = z.union([
  z.object({ code: z.string().min(1), error: z.never().optional(), state: z.string().min(1) }),
  z.object({
    code: z.never().optional(),
    error: z.literal("access_denied"),
    state: z.string().min(1),
  }),
])

export type { OAuthAccessPolicy } from "../private-beta/http-access.js"

export type OAuthRouteOptions = {
  readonly authorizationOrigin: string
  readonly oauthAccess: OAuthAccessPolicy
  readonly redirectOrigin: string
  readonly service: OAuthService
}

export class InvalidOAuthOriginError extends Error {
  override readonly name = "InvalidOAuthOriginError"

  constructor() {
    super("OAuth selection origin is invalid")
  }
}

export class UnsupportedOAuthStartMediaTypeError extends Error {
  override readonly name = "UnsupportedOAuthStartMediaTypeError"

  constructor() {
    super("OAuth start requires an application/x-www-form-urlencoded request")
  }
}

const oauthStartContentSecurityPolicy =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"

const oauthStartJsonErrors = {
  [oauthStartErrorKinds.authorizationExpired]: "invalid_oauth_state",
  [oauthStartErrorKinds.internal]: "internal_server_error",
  [oauthStartErrorKinds.invalidOrigin]: "invalid_origin",
  [oauthStartErrorKinds.invalidRequest]: "invalid_request",
  [oauthStartErrorKinds.rateLimited]: "request_rate_limited",
  [oauthStartErrorKinds.requestBodyTooLarge]: "request_body_too_large",
  [oauthStartErrorKinds.unsupportedMediaType]: "unsupported_media_type",
} as const satisfies Record<OAuthStartErrorKind, string>

function prepareOAuthStartReply(reply: FastifyReply): FastifyReply {
  return reply
    .header("Cache-Control", "no-store")
    .header("Content-Security-Policy", oauthStartContentSecurityPolicy)
    .header("Cross-Origin-Opener-Policy", "same-origin")
    .header("Cross-Origin-Resource-Policy", "same-origin")
    .header("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
    .header("Referrer-Policy", "no-referrer")
    .header("Vary", "Accept")
    .header("X-Content-Type-Options", "nosniff")
    .header("X-Frame-Options", "DENY")
}

function sendOAuthStartError(
  request: FastifyRequest,
  reply: FastifyReply,
  kind: OAuthStartErrorKind,
  statusCode: 400 | 403 | 413 | 415 | 429 | 500,
) {
  const errorReply = prepareOAuthStartReply(reply).status(statusCode)
  if (acceptsHtml(request.headers.accept)) {
    const retryAfterSeconds =
      kind === oauthStartErrorKinds.rateLimited
        ? parseOAuthStartRetryAfterSeconds(reply.getHeader("Retry-After"))
        : undefined
    return errorReply
      .type("text/html; charset=utf-8")
      .send(renderOAuthStartError(kind, { retryAfterSeconds }))
  }
  return errorReply.send({ error: oauthStartJsonErrors[kind] })
}

function sendOAuthScopeSelectionPage(
  reply: FastifyReply,
  authorizationOrigin: string,
  access: OAuthAccessPolicy,
  options: {
    readonly draft?: OAuthScopeSelectionDraft
    readonly issues?: readonly OAuthScopeSelectionIssueKind[]
    readonly statusCode: 200 | 400
  } = {
    statusCode: 200,
  },
) {
  return reply
    .header("Cache-Control", "no-store")
    .header(
      "Content-Security-Policy",
      `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${authorizationOrigin} https://account.smartthings.com https://account.samsung.com; base-uri 'none'; frame-ancestors 'none'`,
    )
    .header("Cross-Origin-Opener-Policy", "same-origin")
    .header("Cross-Origin-Resource-Policy", "same-origin")
    .header("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
    .header("Referrer-Policy", "same-origin")
    .header("Vary", "Accept")
    .header("X-Content-Type-Options", "nosniff")
    .header("X-Frame-Options", "DENY")
    .type("text/html; charset=utf-8")
    .status(options.statusCode)
    .send(
      renderOAuthScopeSelection({
        disclosures: access,
        ...(options.draft === undefined ? {} : { draft: options.draft }),
        ...(options.issues === undefined ? {} : { issues: options.issues }),
      }),
    )
}

function sendOAuthCallbackResultPage(
  reply: FastifyReply,
  result: OAuthCallbackResultKind,
  statusCode: 400 | 429 | 500 | 502,
) {
  return reply
    .header("Cache-Control", "no-store")
    .header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
    )
    .header("Referrer-Policy", "no-referrer")
    .header("X-Content-Type-Options", "nosniff")
    .header("X-Frame-Options", "DENY")
    .type("text/html; charset=utf-8")
    .status(statusCode)
    .send(renderOAuthCallbackResult(result))
}

function isOAuthStartFormContentType(contentType: string | undefined): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/x-www-form-urlencoded"
}

function sendOAuthStartRouteError(
  app: FastifyInstance,
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof InvalidOAuthStateError) {
    return sendOAuthStartError(request, reply, oauthStartErrorKinds.authorizationExpired, 400)
  }
  if (error instanceof InvalidOAuthOriginError) {
    return sendOAuthStartError(request, reply, oauthStartErrorKinds.invalidOrigin, 403)
  }
  if (error instanceof UnsupportedOAuthStartMediaTypeError || error.statusCode === 415) {
    return sendOAuthStartError(request, reply, oauthStartErrorKinds.unsupportedMediaType, 415)
  }
  if (error.statusCode === 413) {
    return sendOAuthStartError(request, reply, oauthStartErrorKinds.requestBodyTooLarge, 413)
  }
  if (error instanceof HttpRequestRateLimitError) {
    return sendOAuthStartError(request, reply, oauthStartErrorKinds.rateLimited, 429)
  }
  app.log.error("oauth.start.failed")
  return sendOAuthStartError(request, reply, oauthStartErrorKinds.internal, 500)
}

export function registerOAuthRoutes(app: FastifyInstance, options: OAuthRouteOptions): void {
  const privateBetaAccess = new PrivateBetaAccessGate(options.oauthAccess)
  app.get("/token-safety.js", async (_request, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .header("Cross-Origin-Resource-Policy", "same-origin")
      .header("X-Content-Type-Options", "nosniff")
      .type("application/javascript; charset=utf-8")
      .send(tokenSafetyClientScript),
  )
  app.get(
    "/oauth/start",
    {
      config: { rateLimit: httpRateLimitPolicies.oauthStart },
      errorHandler: (error, request, reply) => sendOAuthStartRouteError(app, error, request, reply),
      onRequest: async (request, reply) => privateBetaAccess.require(request, reply),
    },
    async (_request, reply) =>
      sendOAuthScopeSelectionPage(reply, options.authorizationOrigin, options.oauthAccess),
  )

  app.post(
    "/oauth/start",
    {
      bodyLimit: 4_096,
      config: { rateLimit: httpRateLimitPolicies.oauthStart },
      errorHandler: (error, request, reply) => sendOAuthStartRouteError(app, error, request, reply),
      onRequest: async (request, reply) => {
        const accessDenied = await privateBetaAccess.require(request, reply)
        if (accessDenied !== undefined) {
          return accessDenied
        }
        if (request.headers.origin !== options.redirectOrigin) {
          throw new InvalidOAuthOriginError()
        }
        return undefined
      },
      preValidation: async (request) => {
        if (!isOAuthStartFormContentType(request.headers["content-type"])) {
          throw new UnsupportedOAuthStartMediaTypeError()
        }
      },
    },
    async (request, reply) => {
      const selection = parseOAuthScopeSelectionSubmission(request.body)
      if (selection.kind === "invalid") {
        if (!acceptsHtml(request.headers.accept)) {
          return sendOAuthStartError(request, reply, oauthStartErrorKinds.invalidRequest, 400)
        }
        return sendOAuthScopeSelectionPage(
          reply,
          options.authorizationOrigin,
          options.oauthAccess,
          {
            draft: selection.draft,
            issues: selection.issues,
            statusCode: 400,
          },
        )
      }
      const authorizationAccess = await privateBetaAccess.getAuthorizationAccess(request)
      if (authorizationAccess === undefined) {
        return privateBetaAccess.require(request, reply)
      }
      const authorizationUrl = await options.service.startAuthorization({
        policyVersion: options.oauthAccess.policyVersion,
        ...authorizationAccess,
        requestedScopes: selection.scopes,
      })
      return reply.redirect(authorizationUrl.toString())
    },
  )

  app.get(
    "/oauth/callback",
    {
      config: { rateLimit: httpRateLimitPolicies.oauthCallback },
      errorHandler: (error, _request, reply) => {
        if (error instanceof HttpRequestRateLimitError) {
          sendOAuthCallbackResultPage(reply, oauthCallbackResultKinds.rateLimited, 429)
          return
        }
        throw error
      },
    },
    async (request, reply) => {
      try {
        const query = callbackQuerySchema.parse(request.query)
        if ("error" in query) {
          await options.service.cancelAuthorization(query.state)
          return sendOAuthCallbackResultPage(reply, oauthCallbackResultKinds.cancelled, 400)
        }
        const completion = await options.service.completeAuthorization(query.code, query.state)
        return reply
          .header("Cache-Control", "no-store")
          .header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
          )
          .header("Referrer-Policy", "no-referrer")
          .header("X-Frame-Options", "DENY")
          .type("text/html; charset=utf-8")
          .send(renderOAuthCompletion(completion.growfulToken))
      } catch (error) {
        if (error instanceof z.ZodError) {
          return sendOAuthCallbackResultPage(reply, oauthCallbackResultKinds.invalidRequest, 400)
        }
        if (error instanceof InvalidOAuthStateError) {
          return sendOAuthCallbackResultPage(reply, oauthCallbackResultKinds.invalidState, 400)
        }
        if (error instanceof OAuthScopeMismatchError) {
          return sendOAuthCallbackResultPage(reply, oauthCallbackResultKinds.scopeMismatch, 502)
        }
        if (error instanceof SmartThingsTokenRequestError) {
          return sendOAuthCallbackResultPage(
            reply,
            oauthCallbackResultKinds.tokenExchangeFailed,
            502,
          )
        }
        app.log.error("oauth.callback.failed")
        return sendOAuthCallbackResultPage(reply, oauthCallbackResultKinds.unexpected, 500)
      }
    },
  )
}
