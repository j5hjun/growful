import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import type { OAuthService } from "../oauth/oauth-service.js"
import { matchesPrivateBetaInvite, type PrivateBetaInvite } from "../private-beta/invite.js"
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

export type OAuthRouteOptions = {
  readonly authorizationOrigin: string
  readonly oauthAccess: OAuthAccessPolicy
  readonly redirectOrigin: string
  readonly service: OAuthService
}

export type OAuthAccessPolicy =
  | { readonly mode: "public" }
  | {
      readonly invites: readonly PrivateBetaInvite[]
      readonly mode: "private_beta"
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
        showSelectionError: options.showSelectionError,
      }),
    )
}

function requireOAuthStartAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  access: OAuthAccessPolicy,
) {
  if (
    access.mode === "public" ||
    matchesPrivateBetaInvite(request.headers.authorization, access.invites)
  ) {
    return undefined
  }
  return reply
    .header("Cache-Control", "no-store")
    .header("WWW-Authenticate", 'Basic realm="Growful private beta", charset="UTF-8"')
    .status(401)
    .send({ error: "private_beta_access_required" as const })
}

export function registerOAuthRoutes(app: FastifyInstance, options: OAuthRouteOptions): void {
  app.get(
    "/oauth/start",
    {
      onRequest: async (request, reply) =>
        requireOAuthStartAccess(request, reply, options.oauthAccess),
    },
    async (_request, reply) => sendOAuthScopeSelectionPage(reply, options.authorizationOrigin),
  )

  app.post(
    "/oauth/start",
    {
      bodyLimit: 4_096,
      onRequest: async (request, reply) => {
        const accessDenied = requireOAuthStartAccess(request, reply, options.oauthAccess)
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
        return sendOAuthScopeSelectionPage(reply, options.authorizationOrigin, {
          deviceRange: parseOAuthDeviceRangeSelection(request.body) ?? "selected",
          showSelectionError: true,
          statusCode: 400,
        })
      }
      const authorizationUrl = await options.service.startAuthorization(scopes)
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
