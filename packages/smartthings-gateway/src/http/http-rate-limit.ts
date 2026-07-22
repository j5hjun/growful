import { isIP } from "node:net"
import fastifyRateLimit from "@fastify/rate-limit"
import type { FastifyInstance, FastifyRequest } from "fastify"

const rateLimitWindowMs = 60_000

function getCloudflareClientAddress(request: FastifyRequest): string {
  const cloudflareClientAddress = request.headers["cf-connecting-ip"]
  return typeof cloudflareClientAddress === "string" && isIP(cloudflareClientAddress) !== 0
    ? cloudflareClientAddress
    : (request.raw.socket.remoteAddress ?? "unknown")
}

export const httpRateLimitPolicies = {
  oauthCallback: {
    keyGenerator: getCloudflareClientAddress,
    max: 60,
    timeWindow: rateLimitWindowMs,
  },
  oauthStart: {
    max: 60,
    timeWindow: rateLimitWindowMs,
  },
  smartThingsWebhook: {
    max: 120,
    timeWindow: rateLimitWindowMs,
  },
} as const

export class HttpRequestRateLimitError extends Error {
  override readonly name = "HttpRequestRateLimitError"

  constructor() {
    super("HTTP request rate limit exceeded")
  }
}

export async function registerHttpRateLimiting(app: FastifyInstance): Promise<void> {
  await app.register(fastifyRateLimit, {
    cache: 2_048,
    errorResponseBuilder: () => new HttpRequestRateLimitError(),
    global: false,
  })
}
