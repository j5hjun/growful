import Fastify, { type FastifyInstance, type FastifyServerOptions, LogController } from "fastify"
import { z } from "zod"
import type { GrowfulAbuseControl } from "../abuse/abuse-control.js"
import { hashAuditSubject } from "../audit/audit-event.js"
import type { ReadinessProbe } from "../health/readiness.js"
import {
  InvalidOAuthStateError,
  OAuthConnectionRequiredError,
  OAuthScopeMismatchError,
  type OAuthService,
} from "../oauth/oauth-service.js"
import { SmartThingsTokenRequestError } from "../smartthings/smartthings-client.js"
import {
  InvalidSmartThingsWebhookSignatureError,
  type SmartThingsWebhookKeyProvider,
} from "../smartthings/webhook-verifier.js"
import type { ServiceStatusSource } from "../status/service-status.js"
import {
  getGrowfulConnectionId,
  registerGrowfulAuthentication,
  requireGrowfulAuthentication,
} from "./growful-auth.js"
import { HttpRequestRateLimitError, registerHttpRateLimiting } from "./http-rate-limit.js"
import {
  InvalidOAuthOriginError,
  type OAuthAccessPolicy,
  registerOAuthRoutes,
} from "./oauth-routes.js"
import { registerPortalRoutes } from "./portal-routes.js"
import {
  SmartThingsGatewayResponseTooLargeError,
  SmartThingsGatewayTimeoutError,
  SmartThingsGatewayUnavailableError,
} from "./smartthings-proxy.js"
import { ProxyRequestBodyTooLargeError } from "./smartthings-proxy-route.js"
import {
  InvalidSmartThingsWebhookRequestError,
  registerSmartThingsWebhookRoute,
  SmartThingsConfirmationRateLimitError,
  SmartThingsConfirmationRequestError,
  type SmartThingsConfirmationRequester,
} from "./smartthings-webhook.js"

const pathsWithSensitiveRequestData = new Set([
  "/healthz",
  "/readyz",
  "/oauth/callback",
  "/oauth/start",
  "/manage",
  "/smartthings/webhook",
])
const requestBodyTooLargeErrorSchema = z.object({ statusCode: z.literal(413) })

export type AppOptions = {
  readonly abuseControl: GrowfulAbuseControl
  readonly authorizationOrigin: string
  readonly logger?: FastifyServerOptions["logger"]
  readonly oauthAccess: OAuthAccessPolicy
  readonly readinessProbe: ReadinessProbe
  readonly redirectOrigin: string
  readonly serviceStatusSource: ServiceStatusSource
  readonly service: OAuthService
  readonly smartThingsAppId: string
  readonly smartThingsConfirmationRequester?: SmartThingsConfirmationRequester
  readonly smartThingsWebhookKeyProvider?: SmartThingsWebhookKeyProvider
  readonly webhookNow?: () => Date
}

function containsSensitiveRequestData(pathname: string): boolean {
  return (
    pathsWithSensitiveRequestData.has(pathname) || pathname === "/v1" || pathname.startsWith("/v1/")
  )
}

export function createApp(options: AppOptions): FastifyInstance {
  const app = Fastify({
    logController: new LogController({
      disableRequestLogging: (request) =>
        containsSensitiveRequestData(new URL(request.url, "http://localhost").pathname),
    }),
    logger: options.logger ?? false,
    trustProxy: 1,
  })
  app.addContentTypeParser<Buffer>(
    "application/x-www-form-urlencoded",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body)
    },
  )
  app.removeContentTypeParser("application/json")
  app.addContentTypeParser<Buffer>(
    "application/json",
    { parseAs: "buffer" },
    (_request, body, done) => {
      done(null, body)
    },
  )
  registerGrowfulAuthentication(app)
  app.get("/healthz", async () => ({ status: "ok" as const }))
  app.get("/readyz", async (_request, reply) => {
    const status = await options.readinessProbe.check()
    reply.header("Cache-Control", "no-store")
    switch (status) {
      case "ready":
        return reply.send({ status })
      case "unavailable":
        return reply.status(503).send({ status })
      default: {
        const unreachable: never = status
        return unreachable
      }
    }
  })
  registerPortalRoutes(
    app,
    options.oauthAccess,
    options.readinessProbe,
    options.serviceStatusSource,
  )
  app.register(async (rateLimitedApp) => {
    await registerHttpRateLimiting(rateLimitedApp)
    registerOAuthRoutes(rateLimitedApp, {
      authorizationOrigin: options.authorizationOrigin,
      oauthAccess: options.oauthAccess,
      redirectOrigin: options.redirectOrigin,
      service: options.service,
    })
    registerSmartThingsWebhookRoute(rateLimitedApp, {
      confirmationRequester: options.smartThingsConfirmationRequester,
      now: options.webhookNow,
      publicKeyProvider: options.smartThingsWebhookKeyProvider,
      service: options.service,
      smartThingsAppId: options.smartThingsAppId,
    })
  })
  app.get(
    "/connection",
    {
      onRequest: async (request, reply) =>
        requireGrowfulAuthentication(request, reply, options.service),
    },
    async (request, reply) => {
      const installedAppId = getGrowfulConnectionId(request)
      const block = await options.abuseControl.getBlock(installedAppId)
      return reply.header("Cache-Control", "no-store").send({
        ...(await options.service.getConnectionStatus(installedAppId)),
        serviceAccess:
          block === null
            ? { status: "active" as const }
            : {
                blockedAt: block.blockedAt,
                reason: block.reason,
                status: "blocked" as const,
              },
        supportReference: hashAuditSubject(installedAppId),
      })
    },
  )
  app.post(
    "/token/rotate",
    {
      onRequest: async (request, reply) =>
        requireGrowfulAuthentication(request, reply, options.service),
    },
    async (request, reply) =>
      reply.header("Cache-Control", "no-store").send({
        growfulToken: await options.service.rotateGrowfulToken(getGrowfulConnectionId(request)),
      }),
  )
  app.delete(
    "/connection",
    {
      onRequest: async (request, reply) =>
        requireGrowfulAuthentication(request, reply, options.service),
    },
    async (request, reply) => {
      await options.service.disconnect(getGrowfulConnectionId(request))
      return reply.status(204).send()
    },
  )

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
    if (error instanceof InvalidSmartThingsWebhookSignatureError) {
      return reply.status(401).send({ error: "invalid_webhook_signature" as const })
    }
    if (error instanceof InvalidSmartThingsWebhookRequestError) {
      return reply.status(400).send({ error: "invalid_webhook_request" as const })
    }
    if (error instanceof SmartThingsConfirmationRateLimitError) {
      return reply
        .header("Retry-After", String(error.retryAfterSeconds))
        .status(429)
        .send({ error: "smartthings_confirmation_rate_limited" as const })
    }
    if (error instanceof SmartThingsConfirmationRequestError) {
      return reply.status(502).send({ error: "smartthings_confirmation_failed" as const })
    }
    if (error instanceof HttpRequestRateLimitError) {
      return reply
        .header("Cache-Control", "no-store")
        .status(429)
        .send({ error: "request_rate_limited" as const })
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
