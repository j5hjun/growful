import type { AddressInfo } from "node:net"
import type { FastifyInstance } from "fastify"
import { afterEach, describe, expect, it } from "vitest"
import { createGatewayAppFixture } from "./fixtures/gateway-app-fixture.js"

const apps: FastifyInstance[] = []
const strictTransportSecurity = "max-age=63072000"

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

async function listenOnLoopback(app: FastifyInstance): Promise<URL> {
  await app.listen({ host: "127.0.0.1", port: 0 })
  const address = app.server.address()
  if (address === null || typeof address === "string") {
    throw new TypeError("expected an assigned TCP address")
  }
  const { port } = address satisfies AddressInfo
  return new URL(`http://127.0.0.1:${port}`)
}

describe("SmartThings Gateway transport security", () => {
  it.each([
    { forwardedProtocol: undefined, name: "direct HTTP" },
    { forwardedProtocol: "http", name: "forwarded HTTP" },
  ])("does not advertise HSTS for $name inject requests", async ({ forwardedProtocol }) => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const headers =
      forwardedProtocol === undefined ? {} : { "x-forwarded-proto": forwardedProtocol }

    // When
    const response = await fixture.app.inject({ headers, method: "GET", url: "/healthz" })

    // Then
    expect(response.headers).not.toHaveProperty("strict-transport-security")
  })

  it.each([
    { expectedStatus: 200, name: "successful response", url: "/healthz" },
    { expectedStatus: 401, name: "authentication error", url: "/connection" },
    { expectedStatus: 404, name: "not-found response", url: "/not-found" },
  ])("advertises HSTS for every forwarded HTTPS $name", async ({ expectedStatus, url }) => {
    // Given
    const fixture = createGatewayAppFixture({ apps })

    // When
    const response = await fixture.app.inject({
      headers: { "x-forwarded-proto": "https" },
      method: "GET",
      url,
    })

    // Then
    expect(response.statusCode).toBe(expectedStatus)
    expect(response.headers["strict-transport-security"]).toBe(strictTransportSecurity)
  })

  it("omits HSTS on a real direct HTTP response", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const origin = await listenOnLoopback(fixture.app)

    // When
    const response = await fetch(new URL("/healthz", origin))

    // Then
    expect(response.headers.get("strict-transport-security")).toBeNull()
  })

  it("advertises HSTS on a real HTTP request forwarded as HTTPS", async () => {
    // Given
    const fixture = createGatewayAppFixture({ apps })
    const origin = await listenOnLoopback(fixture.app)

    // When
    const response = await fetch(new URL("/healthz", origin), {
      headers: { "x-forwarded-proto": "https" },
    })

    // Then
    expect(response.headers.get("strict-transport-security")).toBe(strictTransportSecurity)
  })
})
