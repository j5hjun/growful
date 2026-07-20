import { timingSafeEqual } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import type { OAuthService } from "../oauth/oauth-service.js"
import { parseOAuthScopeSelection, renderOAuthScopeSelection } from "./oauth-scope-selection.js"

const callbackQuerySchema = z.union([
  z.object({ code: z.string().min(1), state: z.string().min(1) }),
  z.object({ error: z.literal("access_denied"), state: z.string().min(1) }),
])
const basicAuthorizationSchema = z.string().regex(/^Basic [A-Za-z0-9+/]+={0,2}$/)

export type OAuthRouteOptions = {
  readonly adminToken: string
  readonly authorizationOrigin: string
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
  options: { readonly showSelectionError: boolean; readonly statusCode: 200 | 400 } = {
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
    .send(renderOAuthScopeSelection(options.showSelectionError))
}

function hasValidAdminAuthorization(
  authorization: string | undefined,
  adminToken: string,
): boolean {
  const parsed = basicAuthorizationSchema.safeParse(authorization)
  if (!parsed.success) {
    return false
  }
  const credentials = Buffer.from(parsed.data.slice("Basic ".length), "base64").toString("utf8")
  const separatorIndex = credentials.indexOf(":")
  if (separatorIndex < 0) {
    return false
  }
  const suppliedToken = Buffer.from(credentials.slice(separatorIndex + 1), "utf8")
  const expectedToken = Buffer.from(adminToken, "utf8")
  return (
    suppliedToken.length === expectedToken.length && timingSafeEqual(suppliedToken, expectedToken)
  )
}

function requireAdminAuthorization(
  request: FastifyRequest,
  reply: FastifyReply,
  adminToken: string,
): FastifyReply | undefined {
  if (hasValidAdminAuthorization(request.headers.authorization, adminToken)) {
    return undefined
  }
  return reply
    .header("WWW-Authenticate", 'Basic realm="SmartThings Gateway"')
    .status(401)
    .send({ error: "unauthorized" as const })
}

export function registerOAuthRoutes(app: FastifyInstance, options: OAuthRouteOptions): void {
  app.get(
    "/oauth/start",
    {
      onRequest: async (request, reply) =>
        requireAdminAuthorization(request, reply, options.adminToken),
    },
    async (_request, reply) => sendOAuthScopeSelectionPage(reply, options.authorizationOrigin),
  )

  app.post(
    "/oauth/start",
    {
      bodyLimit: 4_096,
      onRequest: async (request, reply) => {
        const unauthorizedReply = requireAdminAuthorization(request, reply, options.adminToken)
        if (unauthorizedReply !== undefined) {
          return unauthorizedReply
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
    return options.service.completeAuthorization(query.code, query.state)
  })

  app.get("/connection", async (_request, reply) =>
    reply.header("Cache-Control", "no-store").send(await options.service.getConnectionStatus()),
  )
}
