import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import {
  InvalidOAuthStateError,
  OAuthScopeMismatchError,
  type OAuthService,
} from "../oauth/oauth-service.js"
import { type OAuthAccessPolicy, PrivateBetaAccessGate } from "../private-beta/http-access.js"
import { SmartThingsTokenRequestError } from "../smartthings/smartthings-client.js"
import { HttpRequestRateLimitError, httpRateLimitPolicies } from "./http-rate-limit.js"
import {
  type OAuthCallbackResultKind,
  oauthCallbackResultKinds,
  renderOAuthCallbackResult,
} from "./oauth-callback-result.js"
import { renderOAuthCompletion } from "./oauth-completion.js"
import {
  type OAuthDeviceRange,
  parseOAuthDeviceRangeSelection,
  parseOAuthScopeSelection,
  renderOAuthScopeSelection,
} from "./oauth-scope-selection.js"
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
      const authorizationAccess = await privateBetaAccess.getAuthorizationAccess(request)
      if (authorizationAccess === undefined) {
        return privateBetaAccess.require(request, reply)
      }
      const authorizationUrl = await options.service.startAuthorization({
        policyVersion: options.oauthAccess.policyVersion,
        ...authorizationAccess,
        requestedScopes: scopes,
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
