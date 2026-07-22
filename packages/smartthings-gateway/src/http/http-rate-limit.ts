import fastifyRateLimit from "@fastify/rate-limit"
import type { FastifyInstance } from "fastify"

const rateLimitWindowMs = 60_000

export const httpRateLimitPolicies = {
  oauthCallback: {
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
