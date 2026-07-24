import type { FastifyInstance, FastifyReply } from "fastify"
import type { ReadinessProbe } from "../health/readiness.js"
import type { ServiceStatusSource } from "../status/service-status.js"
import type { OAuthAccessPolicy } from "./oauth-routes.js"
import { portalClientScript } from "./portal-client.js"
import { renderPortalHome } from "./portal-home.js"
import { renderPortalManagement } from "./portal-manage.js"
import { renderPortalNotFound } from "./portal-not-found.js"
import { renderPortalPolicy } from "./portal-policy.js"
import { type PortalStatusIncidentHistory, renderPortalStatus } from "./portal-status.js"
import { renderPortalSupport } from "./portal-support.js"

const sharedContentSecurityPolicy =
  "default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
const machinePathPrefixes = [
  "/connection",
  "/healthz",
  "/readyz",
  "/smartthings",
  "/token",
  "/v1",
] as const
const maximumPathDecodeDepth = 3

function matchesMachinePath(pathname: string): boolean {
  const separatorNormalizedPathname = pathname.replaceAll("\\", "/").replace(/\/+/gu, "/")
  const segments: string[] = []
  for (const segment of separatorNormalizedPathname.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  const dotNormalizedPathname = `/${segments.join("/")}`

  return [separatorNormalizedPathname, dotNormalizedPathname].some((candidate) =>
    machinePathPrefixes.some(
      (prefix) =>
        candidate === prefix ||
        candidate.startsWith(`${prefix}/`) ||
        candidate.startsWith(`${prefix}%`),
    ),
  )
}

function isMachinePath(rawUrl: string): boolean {
  let pathname = rawUrl.split("?", 1)[0] ?? rawUrl

  for (let depth = 0; depth <= maximumPathDecodeDepth; depth += 1) {
    if (matchesMachinePath(pathname)) return true

    try {
      const decodedPathname = decodeURIComponent(pathname)
      if (decodedPathname === pathname) return false
      if (depth === maximumPathDecodeDepth) return true
      pathname = decodedPathname
    } catch {
      return true
    }
  }

  return true
}

function acceptsHtml(accept: string | undefined): boolean {
  if (accept === undefined) return false
  return accept.split(",").some((mediaRange) => {
    const [mediaType, ...parameters] = mediaRange
      .split(";")
      .map((part) => part.trim().toLowerCase())
    if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") return false
    const quality = parameters.find((parameter) => parameter.startsWith("q="))
    return quality === undefined || Number(quality.slice(2)) > 0
  })
}

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
      `${sharedContentSecurityPolicy.replace("form-action 'none'", "form-action 'self'")}; script-src 'self'`,
    ),
  )
  app.get("/status", async (request, reply) => {
    const readinessStatus = await readinessProbe.check()
    let incidentHistory: PortalStatusIncidentHistory
    if (readinessStatus === "unavailable") {
      incidentHistory = { state: "skipped" }
    } else {
      try {
        incidentHistory = {
          incidents: await serviceStatusSource.listPublicIncidents(),
          state: "available",
        }
      } catch {
        request.log.warn("portal.status.incident_history_retrieval_failed")
        incidentHistory = { state: "retrieval-failed" }
      }
    }
    const respondedAt = new Date()
    return sendPortalPage(
      reply,
      renderPortalStatus(readinessStatus, incidentHistory, access, respondedAt),
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
  app.setNotFoundHandler((request, reply) => {
    reply.header("Vary", "Accept")
    if (
      request.method === "GET" &&
      !isMachinePath(request.url) &&
      acceptsHtml(request.headers.accept)
    ) {
      return sendPortalPage(
        reply.status(404),
        renderPortalNotFound(access),
        sharedContentSecurityPolicy,
      )
    }
    return reply.status(404).send({ error: "not_found" as const })
  })
}
