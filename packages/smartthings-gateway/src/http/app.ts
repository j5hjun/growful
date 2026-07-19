import { timingSafeEqual } from "node:crypto"
import Fastify, { type FastifyInstance, type FastifyServerOptions, LogController } from "fastify"
import { z } from "zod"
import { InvalidOAuthStateError, type OAuthService } from "../oauth/oauth-service.js"
import { SmartThingsTokenRequestError } from "../smartthings/smartthings-client.js"

const callbackQuerySchema = z.union([
  z.object({ code: z.string().min(1), state: z.string().min(1) }),
  z.object({ error: z.literal("access_denied"), state: z.string().min(1) }),
])
const basicAuthorizationSchema = z.string().regex(/^Basic [A-Za-z0-9+/]+={0,2}$/)
const pathsWithSensitiveRequestData = new Set(["/healthz", "/oauth/callback", "/oauth/start"])

export type AppOptions = {
  readonly adminToken: string
  readonly logger?: FastifyServerOptions["logger"]
  readonly service: OAuthService
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

export function createApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logController: new LogController({
      disableRequestLogging: (request) =>
        pathsWithSensitiveRequestData.has(new URL(request.url, "http://localhost").pathname),
    }),
    logger: options.logger ?? false,
  })
  app.get("/healthz", async () => ({ status: "ok" as const }))

  app.get("/oauth/start", async (request, reply) => {
    if (!hasValidAdminAuthorization(request.headers.authorization, options.adminToken)) {
      return reply
        .header("WWW-Authenticate", 'Basic realm="SmartThings Gateway"')
        .status(401)
        .send({ error: "unauthorized" as const })
    }
    const authorizationUrl = await options.service.startAuthorization()
    return reply.redirect(authorizationUrl.toString())
  })

  app.get("/oauth/callback", async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query)
    if ("error" in query) {
      await options.service.cancelAuthorization(query.state)
      return reply.status(400).send({ error: "authorization_denied" as const })
    }
    return options.service.completeAuthorization(query.code, query.state)
  })

  app.get("/connection", async () => options.service.getConnectionStatus())

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "invalid_request" as const })
    }
    if (error instanceof InvalidOAuthStateError) {
      return reply.status(400).send({ error: "invalid_oauth_state" as const })
    }
    if (error instanceof SmartThingsTokenRequestError) {
      return reply.status(502).send({ error: "token_exchange_failed" as const })
    }
    request.log.error({ err: error }, "request.failed")
    return reply.status(500).send({ error: "internal_server_error" as const })
  })

  return app
}
