import { createServer, type IncomingMessage } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  HttpSmartThingsClient,
  SmartThingsReauthorizationRequiredError,
  SmartThingsTokenRequestError,
} from "../src/smartthings/smartthings-client.js"

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

async function createTokenServer(
  capturedRequests: CapturedRequest[],
  grantedScope = "r:devices:*",
): Promise<URL> {
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
        scope: grantedScope,
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

async function createRejectedTokenServer(
  statusCode: number,
  body: string,
  contentType = "application/json",
): Promise<URL> {
  const server = createServer((_request, response) => {
    response.writeHead(statusCode, { "content-type": contentType })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = addressSchema.parse(server.address())
  return new URL(`http://127.0.0.1:${port}/oauth/token`)
}

async function createStalledTokenServer(): Promise<URL> {
  const server = createServer(() => {})
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const { port } = addressSchema.parse(server.address())
  return new URL(`http://127.0.0.1:${port}/oauth/token`)
}

function createClient(tokenUrl: URL, tokenRequestTimeoutMs?: number): HttpSmartThingsClient {
  return new HttpSmartThingsClient({
    authorizationUrl: new URL("https://api.smartthings.test/oauth/authorize"),
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: new URL("https://smartthings.growful.click/oauth/callback"),
    ...(tokenRequestTimeoutMs === undefined ? {} : { tokenRequestTimeoutMs }),
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
    const url = client.buildAuthorizationUrl("unguessable-state", ["r:devices:*"])

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
    expect(grant.scopes).toEqual(["r:devices:*"])
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

  it("preserves a registered legacy scope in a token response", async () => {
    const capturedRequests: CapturedRequest[] = []
    const client = createClient(await createTokenServer(capturedRequests, "r:scenes:*"))

    const grant = await client.refresh("latest-refresh-token")

    expect(grant.scopes).toEqual(["r:scenes:*"])
  })

  it("classifies only a safely parsed OAuth invalid_grant as reauthorization required", async () => {
    const client = createClient(
      await createRejectedTokenServer(
        400,
        JSON.stringify({
          error: "invalid_grant",
          error_description: "revoked credential secret-refresh-token",
        }),
      ),
    )

    const error = await client.refresh("secret-refresh-token").catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SmartThingsReauthorizationRequiredError)
    expect(error).toMatchObject({ statusCode: 400 })
    expect(String(error)).not.toContain("revoked credential")
    expect(String(error)).not.toContain("secret-refresh-token")
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })

  it.each([
    ["a bare 401", 401, "", "application/json"],
    ["an HTML error", 401, "<html>secret upstream detail</html>", "text/html"],
    [
      "a non-terminal OAuth JSON error",
      400,
      JSON.stringify({ error: "temporarily_unavailable", error_description: "secret detail" }),
      "application/json",
    ],
    ["a malformed OAuth body", 400, "{not-json", "application/json"],
    [
      "a transient 5xx even with an invalid_grant-shaped body",
      503,
      JSON.stringify({ error: "invalid_grant" }),
      "application/json",
    ],
    [
      "an invalid_grant-shaped 401 outside the OAuth error contract",
      401,
      JSON.stringify({ error: "invalid_grant" }),
      "application/json",
    ],
    [
      "an invalid_grant-shaped 403 outside the OAuth error contract",
      403,
      JSON.stringify({ error: "invalid_grant" }),
      "application/json",
    ],
    [
      "an invalid_grant-shaped 429 outside the OAuth error contract",
      429,
      JSON.stringify({ error: "invalid_grant" }),
      "application/json",
    ],
  ])(
    "keeps %s as a sanitized generic token request failure",
    async (_case, statusCode, body, contentType) => {
      const client = createClient(await createRejectedTokenServer(statusCode, body, contentType))

      const error = await client.refresh("secret-refresh-token").catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(SmartThingsTokenRequestError)
      expect(error).not.toBeInstanceOf(SmartThingsReauthorizationRequiredError)
      expect(error).toMatchObject({ name: "SmartThingsTokenRequestError", statusCode })
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
      expect(String(error)).not.toContain("secret")
    },
  )

  it("sanitizes a real token request timeout without changing its transient classification", async () => {
    const client = createClient(await createStalledTokenServer(), 25)

    const error = await client.refresh("secret-refresh-token").catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(SmartThingsTokenRequestError)
    expect(error).not.toBeInstanceOf(SmartThingsReauthorizationRequiredError)
    expect(error).toMatchObject({
      name: "SmartThingsTokenRequestError",
      statusCode: undefined,
    })
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
    expect(String(error)).not.toContain("secret-refresh-token")
  })
})
