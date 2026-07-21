import type { FastifyInstance } from "fastify"
import ky from "ky"
import { z } from "zod"
import { InstalledAppIdSchema } from "../oauth/contracts.js"
import type { OAuthService } from "../oauth/oauth-service.js"
import {
  type SmartThingsWebhookKeyProvider,
  SmartThingsWebhookPublicKeyClient,
  verifySmartThingsWebhook,
} from "../smartthings/webhook-verifier.js"

const confirmationSchema = z.object({
  confirmationData: z.object({
    appId: z.string().min(1),
    confirmationUrl: z.url(),
  }),
  messageType: z.literal("CONFIRMATION"),
})
const eventEnvelopeSchema = z.object({
  eventData: z.object({
    events: z.array(z.unknown()),
    installedApp: z.object({
      installedAppId: InstalledAppIdSchema,
      locationId: z.string().min(1),
    }),
  }),
  messageType: z.literal("EVENT"),
})
const eventTypeSchema = z.object({ eventType: z.string().min(1) }).passthrough()
const installedAppLifecycleSchema = z.object({
  eventType: z.literal("INSTALLED_APP_LIFECYCLE_EVENT"),
  installedAppLifecycleEvent: z.object({
    installedAppId: InstalledAppIdSchema,
    appId: z.string().min(1),
    lifecycle: z.enum(["CREATE", "INSTALL", "UPDATE", "DELETE", "OTHER"]),
  }),
})
const messageTypeSchema = z.object({
  messageType: z.enum(["CONFIRMATION", "EVENT"]),
})
const rawBodySchema = z.instanceof(Buffer)

export type SmartThingsConfirmationRequester = (url: URL) => Promise<void>

export type SmartThingsWebhookRouteOptions = {
  readonly confirmationRequester: SmartThingsConfirmationRequester | undefined
  readonly now: (() => Date) | undefined
  readonly publicKeyProvider: SmartThingsWebhookKeyProvider | undefined
  readonly service: OAuthService
  readonly smartThingsAppId: string
}

export class InvalidSmartThingsWebhookRequestError extends Error {
  override readonly name = "InvalidSmartThingsWebhookRequestError"

  constructor(options?: ErrorOptions) {
    super("SmartThings webhook request is invalid", options)
  }
}

export class SmartThingsConfirmationRequestError extends Error {
  override readonly name = "SmartThingsConfirmationRequestError"

  constructor() {
    super("SmartThings confirmation request failed")
  }
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new InvalidSmartThingsWebhookRequestError({ cause: error })
    }
    throw error
  }
}

function parseConfirmationUrl(expectedAppId: string, appId: string, rawUrl: string): URL {
  const url = new URL(rawUrl)
  const expectedPath = `/v1/apps/${encodeURIComponent(appId)}/confirm-registration`
  const queryKeys = [...url.searchParams.keys()]
  if (
    appId !== expectedAppId ||
    url.origin !== "https://api.smartthings.com" ||
    url.pathname !== expectedPath ||
    queryKeys.length !== 1 ||
    queryKeys[0] !== "token" ||
    !url.searchParams.get("token")
  ) {
    throw new InvalidSmartThingsWebhookRequestError()
  }
  return url
}

async function requestSmartThingsConfirmation(url: URL): Promise<void> {
  await ky.get(url, { redirect: "error", retry: 0, timeout: 5_000 })
}

function deleteLifecycleConnectionIds(
  message: z.infer<typeof eventEnvelopeSchema>,
  expectedAppId: string,
) {
  const installedAppIds = new Set<ReturnType<typeof InstalledAppIdSchema.parse>>()
  for (const rawEvent of message.eventData.events) {
    const event = eventTypeSchema.parse(rawEvent)
    switch (event.eventType) {
      case "INSTALLED_APP_LIFECYCLE_EVENT": {
        const lifecycleEvent = installedAppLifecycleSchema.parse(event).installedAppLifecycleEvent
        if (
          lifecycleEvent.appId !== expectedAppId ||
          lifecycleEvent.installedAppId !== message.eventData.installedApp.installedAppId
        ) {
          throw new InvalidSmartThingsWebhookRequestError()
        }
        switch (lifecycleEvent.lifecycle) {
          case "DELETE":
            installedAppIds.add(lifecycleEvent.installedAppId)
            break
          case "CREATE":
          case "INSTALL":
          case "OTHER":
          case "UPDATE":
            break
        }
        break
      }
      default:
        break
    }
  }
  return [...installedAppIds]
}

export function registerSmartThingsWebhookRoute(
  app: FastifyInstance,
  options: SmartThingsWebhookRouteOptions,
): void {
  const now = options.now ?? (() => new Date())
  const publicKeyProvider =
    options.publicKeyProvider ?? new SmartThingsWebhookPublicKeyClient(now).getPublicKey
  const confirmationRequester = options.confirmationRequester ?? requestSmartThingsConfirmation

  app.post("/smartthings/webhook", async (request, reply) => {
    const body = rawBodySchema.parse(request.body)
    const parsedJson = parseJson(body)
    const messageType = messageTypeSchema.parse(parsedJson).messageType
    switch (messageType) {
      case "CONFIRMATION": {
        const message = confirmationSchema.parse(parsedJson)
        const confirmationUrl = parseConfirmationUrl(
          options.smartThingsAppId,
          message.confirmationData.appId,
          message.confirmationData.confirmationUrl,
        )
        try {
          await confirmationRequester(confirmationUrl)
        } catch {
          throw new SmartThingsConfirmationRequestError()
        }
        return reply.header("Cache-Control", "no-store").send({})
      }
      case "EVENT": {
        await verifySmartThingsWebhook({
          body,
          headers: request.headers,
          method: request.method,
          now: now(),
          publicKeyProvider,
          rawUrl: request.raw.url ?? "/smartthings/webhook",
        })
        const message = eventEnvelopeSchema.parse(parsedJson)
        await Promise.all(
          deleteLifecycleConnectionIds(message, options.smartThingsAppId).map((installedAppId) =>
            options.service.forgetConnection(installedAppId),
          ),
        )
        return reply.header("Cache-Control", "no-store").send({})
      }
    }
  })
}
