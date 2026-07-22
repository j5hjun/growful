import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import type { InstalledAppId } from "../oauth/contracts.js"
import type { OAuthService } from "../oauth/oauth-service.js"
import { GrowfulTokenSchema } from "../security/growful-token.js"
import {
  type GrowfulRequestQuota,
  GrowfulRequestQuotaExceededError,
} from "./growful-request-quota.js"

declare module "fastify" {
  interface FastifyRequest {
    growfulConnectionId: InstalledAppId | null
  }
}

const bearerAuthorizationSchema = z
  .string()
  .regex(/^Bearer grw_st_[A-Za-z0-9_-]{43}$/)
  .transform((authorization) => GrowfulTokenSchema.parse(authorization.slice("Bearer ".length)))

export class MissingGrowfulAuthenticationContextError extends Error {
  override readonly name = "MissingGrowfulAuthenticationContextError"

  constructor() {
    super("Growful authentication context is missing")
  }
}

export function registerGrowfulAuthentication(app: FastifyInstance): void {
  app.decorateRequest("growfulConnectionId", null)
}

export type GrowfulAuthenticationOptions = {
  readonly reply: FastifyReply
  readonly request: FastifyRequest
  readonly requestQuota: GrowfulRequestQuota
  readonly service: OAuthService
}

export async function requireGrowfulAuthentication(
  options: GrowfulAuthenticationOptions,
): Promise<FastifyReply | undefined> {
  const parsed = bearerAuthorizationSchema.safeParse(options.request.headers.authorization)
  if (!parsed.success) {
    return options.reply.status(401).send({ error: "unauthorized" as const })
  }
  let installedAppId: InstalledAppId | null
  try {
    installedAppId = await options.service.authenticate(parsed.data, async (connectionId) => {
      const retryAfterSeconds = await options.requestQuota.consume(connectionId)
      if (retryAfterSeconds !== null) {
        throw new GrowfulRequestQuotaExceededError(retryAfterSeconds)
      }
    })
  } catch (error: unknown) {
    if (error instanceof GrowfulRequestQuotaExceededError) {
      return options.reply
        .header("Cache-Control", "no-store")
        .header("Retry-After", String(error.retryAfterSeconds))
        .status(429)
        .send({ error: "growful_rate_limited" as const })
    }
    throw error
  }
  if (installedAppId === null) {
    return options.reply.status(401).send({ error: "unauthorized" as const })
  }
  options.request.growfulConnectionId = installedAppId
  return undefined
}

export function getGrowfulConnectionId(request: FastifyRequest): InstalledAppId {
  if (request.growfulConnectionId === null) {
    throw new MissingGrowfulAuthenticationContextError()
  }
  return request.growfulConnectionId
}
