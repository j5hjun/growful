import type { FastifyInstance, FastifyReply } from "fastify"
import type { ReadinessProbe } from "../health/readiness.js"
import type { ServiceStatusSource } from "../status/service-status.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import { portalClientScript } from "./portal-client.js"
import { renderPortalHome } from "./portal-home.js"
import { renderPortalManagement } from "./portal-manage.js"
import { renderPortalPolicy } from "./portal-policy.js"
import { renderPortalStatus } from "./portal-status.js"
import { renderPortalSupport } from "./portal-support.js"

const sharedContentSecurityPolicy =
  "default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"

function sendPortalPage(reply: FastifyReply, html: string, contentSecurityPolicy: string) {
  return reply
    .header("Cache-Control", "no-store")
    .header("Content-Security-Policy", contentSecurityPolicy)
    .header("Cross-Origin-Opener-Policy", "same-origin")
    .header("Cross-Origin-Resource-Policy", "same-origin")
    .header("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
    .header("Referrer-Policy", "no-referrer")
    .header("X-Content-Type-Options", "nosniff")
    .header("X-Frame-Options", "DENY")
    .type("text/html; charset=utf-8")
    .send(html)
}

export function registerPortalRoutes(
  app: FastifyInstance,
  access: OAuthAccessPolicy,
  readinessProbe: ReadinessProbe,
  serviceStatusSource: ServiceStatusSource,
): void {
  const isPublic = access.mode === "public"
  app.get("/robots.txt", async (_request, reply) =>
    reply
      .header("Cache-Control", isPublic ? "public, max-age=3600" : "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .type("text/plain; charset=utf-8")
      .send(isPublic ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n"),
  )
  app.get("/", async (_request, reply) =>
    sendPortalPage(reply, renderPortalHome(access), sharedContentSecurityPolicy),
  )
  app.get("/manage", async (_request, reply) =>
    sendPortalPage(
      reply,
      renderPortalManagement(access),
      `${sharedContentSecurityPolicy}; script-src 'self'`,
    ),
  )
  app.get("/status", async (_request, reply) => {
    const readinessStatus = await readinessProbe.check()
    const incidents =
      readinessStatus === "ready" ? await serviceStatusSource.listPublicIncidents() : null
    return sendPortalPage(
      reply,
      renderPortalStatus(readinessStatus, incidents, access),
      sharedContentSecurityPolicy,
    )
  })
  app.get("/privacy", async (_request, reply) =>
    sendPortalPage(reply, renderPortalPolicy("privacy", access), sharedContentSecurityPolicy),
  )
  app.get("/terms", async (_request, reply) =>
    sendPortalPage(reply, renderPortalPolicy("terms", access), sharedContentSecurityPolicy),
  )
  app.get("/support", async (_request, reply) =>
    sendPortalPage(reply, renderPortalSupport(access), sharedContentSecurityPolicy),
  )
  app.get("/portal.js", async (_request, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .header("Cross-Origin-Resource-Policy", "same-origin")
      .header("X-Content-Type-Options", "nosniff")
      .type("application/javascript; charset=utf-8")
      .send(portalClientScript),
  )
}
