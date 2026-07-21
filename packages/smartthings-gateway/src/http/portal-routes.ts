import type { FastifyInstance, FastifyReply } from "fastify"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import { portalClientScript } from "./portal-client.js"
import { renderPortalHome } from "./portal-home.js"
import { renderPortalManagement } from "./portal-manage.js"

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

export function registerPortalRoutes(app: FastifyInstance, access: OAuthAccessPolicy): void {
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
  app.get("/portal.js", async (_request, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .header("Cross-Origin-Resource-Policy", "same-origin")
      .header("X-Content-Type-Options", "nosniff")
      .type("application/javascript; charset=utf-8")
      .send(portalClientScript),
  )
}
