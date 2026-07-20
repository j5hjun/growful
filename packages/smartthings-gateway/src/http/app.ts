import { timingSafeEqual } from "node:crypto"
import type { IncomingMessage } from "node:http"
import Fastify, { type FastifyInstance, type FastifyServerOptions, LogController } from "fastify"
import { z } from "zod"
import {
  InvalidOAuthStateError,
  OAuthConnectionRequiredError,
  OAuthScopeMismatchError,
  type OAuthService,
} from "../oauth/oauth-service.js"
import { SmartThingsTokenRequestError } from "../smartthings/smartthings-client.js"
import { InvalidOAuthOriginError, registerOAuthRoutes } from "./oauth-routes.js"
import {
  SmartThingsGatewayResponseTooLargeError,
  SmartThingsGatewayTimeoutError,
  SmartThingsGatewayUnavailableError,
  type SmartThingsProxy,
} from "./smartthings-proxy.js"

const bearerAuthorizationSchema = z.string().regex(/^Bearer [A-Za-z0-9._~+/=-]+$/)
const pathsWithSensitiveRequestData = new Set(["/healthz", "/oauth/callback", "/oauth/start"])
const allowedProxyMethods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
const allowedProxyMethodSet = new Set(allowedProxyMethods)
const proxyBodySchema = z.union([z.instanceof(Buffer), z.undefined()])
const encodedBytePattern = /%[0-9a-f]{2}/i

function isWithinProxyNamespace(rawUrl: string): boolean {
  const queryIndex = rawUrl.indexOf("?")
  let decodedPath = queryIndex < 0 ? rawUrl : rawUrl.slice(0, queryIndex)
  for (let depth = 0; depth < 4 && encodedBytePattern.test(decodedPath); depth += 1) {
    try {
      decodedPath = decodeURIComponent(decodedPath)
    } catch {
      return false
    }
  }
  if (encodedBytePattern.test(decodedPath)) {
    return false
  }

  const normalizedSegments: string[] = []
  for (const segment of decodedPath.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") {
      continue
    }
    if (segment === "..") {
      normalizedSegments.pop()
      continue
    }
    normalizedSegments.push(segment)
  }
  return normalizedSegments[0] === "v1"
}

const proxyUrlSchema = z
  .string()
  .regex(/^\/v1(?:\/|\?|$)/)
  .refine(isWithinProxyNamespace)
const requestBodyTooLargeErrorSchema = z.object({ statusCode: z.literal(413) })
const proxyRequestBodyLimit = 1_048_576

class ProxyRequestBodyTooLargeError extends Error {
  override readonly name = "ProxyRequestBodyTooLargeError"

  constructor() {
    super("Gateway request body exceeded the limit")
  }
}

export type AppOptions = {
  readonly adminToken: string
  readonly logger?: FastifyServerOptions["logger"]
  readonly redirectOrigin: string
  readonly service: OAuthService
}

export type SmartThingsProxyRouteOptions = {
  readonly gatewayApiToken: string
  readonly proxy: SmartThingsProxy
}

function hasValidGatewayAuthorization(
  authorization: string | undefined,
  gatewayApiToken: string,
): boolean {
  const parsed = bearerAuthorizationSchema.safeParse(authorization)
  if (!parsed.success) {
    return false
  }
  const suppliedToken = Buffer.from(parsed.data.slice("Bearer ".length), "utf8")
  const expectedToken = Buffer.from(gatewayApiToken, "utf8")
  return (
    suppliedToken.length === expectedToken.length && timingSafeEqual(suppliedToken, expectedToken)
  )
}

function containsSensitiveRequestData(pathname: string): boolean {
  return (
    pathsWithSensitiveRequestData.has(pathname) || pathname === "/v1" || pathname.startsWith("/v1/")
  )
}

async function readProxyRequestBody(body: unknown, rawRequest: IncomingMessage) {
  const parsedBody = proxyBodySchema.parse(body)
  if (parsedBody !== undefined || rawRequest.readableEnded) {
    return parsedBody
  }

  const chunks: Buffer[] = []
  let receivedBytes = 0
  for await (const chunk of rawRequest) {
    const parsedChunk = z.union([z.instanceof(Buffer), z.string()]).parse(chunk)
    const buffer = Buffer.from(parsedChunk)
    receivedBytes += buffer.length
    if (receivedBytes > proxyRequestBodyLimit) {
      throw new ProxyRequestBodyTooLargeError()
    }
    chunks.push(buffer)
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks)
}

export function createApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logController: new LogController({
      disableRequestLogging: (request) =>
        containsSensitiveRequestData(new URL(request.url, "http://localhost").pathname),
    }),
    logger: options.logger ?? false,
  })
  app.addContentTypeParser<Buffer>(
    "application/x-www-form-urlencoded",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body)
    },
  )
  app.get("/healthz", async () => ({ status: "ok" as const }))
  registerOAuthRoutes(app, {
    adminToken: options.adminToken,
    redirectOrigin: options.redirectOrigin,
    service: options.service,
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "invalid_request" as const })
    }
    if (error instanceof InvalidOAuthStateError) {
      return reply.status(400).send({ error: "invalid_oauth_state" as const })
    }
    if (error instanceof InvalidOAuthOriginError) {
      return reply.status(403).send({ error: "invalid_origin" as const })
    }
    if (error instanceof OAuthScopeMismatchError) {
      return reply.status(502).send({ error: "oauth_scope_mismatch" as const })
    }
    if (error instanceof SmartThingsTokenRequestError) {
      return reply.status(502).send({ error: "token_exchange_failed" as const })
    }
    if (error instanceof OAuthConnectionRequiredError) {
      return reply.status(503).send({ error: "oauth_connection_required" as const })
    }
    if (error instanceof SmartThingsGatewayTimeoutError) {
      return reply.status(504).send({ error: "smartthings_gateway_timeout" as const })
    }
    if (error instanceof SmartThingsGatewayResponseTooLargeError) {
      return reply.status(502).send({ error: "smartthings_gateway_response_too_large" as const })
    }
    if (error instanceof SmartThingsGatewayUnavailableError) {
      return reply.status(502).send({ error: "smartthings_gateway_unavailable" as const })
    }
    if (
      error instanceof ProxyRequestBodyTooLargeError ||
      requestBodyTooLargeErrorSchema.safeParse(error).success
    ) {
      return reply.status(413).send({ error: "request_body_too_large" as const })
    }
    request.log.error({ err: error }, "request.failed")
    return reply.status(500).send({ error: "internal_server_error" as const })
  })

  return app
}

export function registerSmartThingsProxy(
  app: FastifyInstance,
  options: SmartThingsProxyRouteOptions,
): void {
  app.removeAllContentTypeParsers()
  app.addContentTypeParser<Buffer>("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body)
  })
  app.all(
    "/v1/*",
    {
      onRequest: async (request, reply) => {
        if (!hasValidGatewayAuthorization(request.headers.authorization, options.gatewayApiToken)) {
          return reply.status(401).send({ error: "unauthorized" as const })
        }
        if (!allowedProxyMethodSet.has(request.method)) {
          return reply
            .header("Allow", allowedProxyMethods.join(", "))
            .status(405)
            .send({ error: "method_not_allowed" as const })
        }
      },
    },
    async (request, reply) => {
      const response = await options.proxy.forward({
        body: await readProxyRequestBody(request.body, request.raw),
        headers: request.headers,
        method: request.method,
        rawUrl: proxyUrlSchema.parse(request.raw.url),
      })
      for (const [header, value] of Object.entries(response.headers)) {
        reply.raw.setHeader(header, typeof value === "string" ? value : [...value])
      }
      reply.raw.statusCode = response.statusCode
      reply.raw.sendDate = false
      reply.hijack()
      reply.raw.end(request.method === "HEAD" ? undefined : response.body)
      return reply
    },
  )
}
