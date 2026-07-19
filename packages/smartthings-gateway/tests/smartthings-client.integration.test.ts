import { createServer, type IncomingMessage } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { HttpSmartThingsClient } from "../src/smartthings/smartthings-client.js"

const addressSchema = z.object({ port: z.number().int().positive() })
const servers: ReturnType<typeof createServer>[] = []

type CapturedRequest = {
  readonly authorization: string | undefined
  readonly body: URLSearchParams
}

async function readBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8")
  let body = ""
  for await (const chunk of request) {
    body += z.string().parse(chunk)
  }
  return body
}

async function createTokenServer(capturedRequests: CapturedRequest[]): Promise<URL> {
  const server = createServer(async (request, response) => {
    const body = new URLSearchParams(await readBody(request))
    capturedRequests.push({ authorization: request.headers.authorization, body })
    response.writeHead(200, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        access_token: "access-token",
        expires_in: 86_399,
        installed_app_id: "installed-app-1",
        refresh_token: "refresh-token",
        scope: "r:devices:*",
        token_type: "bearer",
      }),
    )
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = addressSchema.parse(server.address())
  return new URL(`http://127.0.0.1:${port}/oauth/token`)
}

function createClient(tokenUrl: URL): HttpSmartThingsClient {
  return new HttpSmartThingsClient({
    authorizationUrl: new URL("https://api.smartthings.test/oauth/authorize"),
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: new URL("https://smartthings.growful.click/oauth/callback"),
    scopes: ["r:devices:*"],
    tokenUrl,
  })
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)))
        }),
    ),
  )
})

describe("HttpSmartThingsClient", () => {
  it("builds the authorization URL with the registered redirect and state", () => {
    // Given
    const client = createClient(new URL("https://api.smartthings.test/oauth/token"))

    // When
    const url = client.buildAuthorizationUrl("unguessable-state")

    // Then
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-id",
      redirect_uri: "https://smartthings.growful.click/oauth/callback",
      response_type: "code",
      scope: "r:devices:*",
      state: "unguessable-state",
    })
  })

  it("exchanges an authorization code using HTTP Basic and form data", async () => {
    // Given
    const capturedRequests: CapturedRequest[] = []
    const client = createClient(await createTokenServer(capturedRequests))

    // When
    const grant = await client.exchangeCode("authorization-code")

    // Then
    expect(grant.accessToken).toBe("access-token")
    expect(capturedRequests[0]?.authorization).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    )
    expect(Object.fromEntries(capturedRequests[0]?.body ?? [])).toEqual({
      client_id: "client-id",
      code: "authorization-code",
      grant_type: "authorization_code",
      redirect_uri: "https://smartthings.growful.click/oauth/callback",
    })
  })

  it("sends only the latest refresh token when refreshing", async () => {
    // Given
    const capturedRequests: CapturedRequest[] = []
    const client = createClient(await createTokenServer(capturedRequests))

    // When
    await client.refresh("latest-refresh-token")

    // Then
    expect(Object.fromEntries(capturedRequests[0]?.body ?? [])).toEqual({
      client_id: "client-id",
      grant_type: "refresh_token",
      refresh_token: "latest-refresh-token",
    })
  })
})
