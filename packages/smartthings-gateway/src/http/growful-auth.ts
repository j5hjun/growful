import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import type { InstalledAppId } from "../oauth/contracts.js"
import type { OAuthService } from "../oauth/oauth-service.js"
import { GrowfulTokenSchema } from "../security/growful-token.js"

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

export async function requireGrowfulAuthentication(
  request: FastifyRequest,
  reply: FastifyReply,
  service: OAuthService,
): Promise<FastifyReply | undefined> {
  const parsed = bearerAuthorizationSchema.safeParse(request.headers.authorization)
  if (!parsed.success) {
    return reply.status(401).send({ error: "unauthorized" as const })
  }
  const installedAppId = await service.authenticate(parsed.data)
  if (installedAppId === null) {
    return reply.status(401).send({ error: "unauthorized" as const })
  }
  request.growfulConnectionId = installedAppId
  return undefined
}

export function getGrowfulConnectionId(request: FastifyRequest): InstalledAppId {
  if (request.growfulConnectionId === null) {
    throw new MissingGrowfulAuthenticationContextError()
  }
  return request.growfulConnectionId
}
