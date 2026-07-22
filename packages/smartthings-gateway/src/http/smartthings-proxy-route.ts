import type { IncomingMessage } from "node:http"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import type { GrowfulAbuseControl } from "../abuse/abuse-control.js"
import { hashAuditSubject } from "../audit/audit-event.js"
import type { OAuthService } from "../oauth/oauth-service.js"
import { getGrowfulConnectionId, requireGrowfulAuthentication } from "./growful-auth.js"
import type { GrowfulRequestQuota } from "./growful-request-quota.js"
import type { SmartThingsProxy } from "./smartthings-proxy.js"
import type { SmartThingsRateLimitBackoff } from "./smartthings-rate-limit-backoff.js"

const allowedProxyMethods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
const allowedProxyMethodSet = new Set(allowedProxyMethods)
const proxyBodySchema = z.union([z.instanceof(Buffer), z.undefined()])
const encodedBytePattern = /%[0-9a-f]{2}/i
const proxyRequestBodyLimit = 1_048_576

export type SmartThingsProxyRouteOptions = {
  readonly abuseControl: GrowfulAbuseControl
  readonly proxy: SmartThingsProxy
  readonly rateLimitBackoff: SmartThingsRateLimitBackoff
  readonly requestQuota: GrowfulRequestQuota
  readonly service: OAuthService
}

export class ProxyRequestBodyTooLargeError extends Error {
  override readonly name = "ProxyRequestBodyTooLargeError"

  constructor() {
    super("Gateway request body exceeded the limit")
  }
}

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
        const unauthorizedReply = await requireGrowfulAuthentication({
          reply,
          request,
          requestQuota: options.requestQuota,
          service: options.service,
        })
        if (unauthorizedReply !== undefined) {
          return unauthorizedReply
        }
        if (!allowedProxyMethodSet.has(request.method)) {
          return reply
            .header("Allow", allowedProxyMethods.join(", "))
            .status(405)
            .send({ error: "method_not_allowed" as const })
        }
        const installedAppId = getGrowfulConnectionId(request)
        const block = await options.abuseControl.getBlock(installedAppId)
        if (block !== null) {
          return reply.status(403).send({
            error: "growful_access_blocked" as const,
            reason: block.reason,
            supportReference: hashAuditSubject({ installedAppId }),
          })
        }
        const retryAfterSeconds =
          await options.rateLimitBackoff.getRetryAfterSeconds(installedAppId)
        if (retryAfterSeconds !== null) {
          return reply
            .header("Retry-After", String(retryAfterSeconds))
            .status(429)
            .send({ error: "smartthings_rate_limited" as const })
        }
      },
    },
    async (request, reply) => {
      const installedAppId = getGrowfulConnectionId(request)
      const response = await options.proxy.forward(
        {
          body: await readProxyRequestBody(request.body, request.raw),
          headers: request.headers,
          method: request.method,
          rawUrl: proxyUrlSchema.parse(request.raw.url),
        },
        installedAppId,
      )
      await options.rateLimitBackoff.observeResponse(installedAppId, response)
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
