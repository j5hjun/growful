import { once } from "node:events"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"

export type CapturedSmartThingsRequest = {
  readonly body: Buffer
  readonly headers: IncomingHttpHeaders
  readonly method: string | undefined
  readonly url: string | undefined
}

export type FakeSmartThingsResponse = {
  readonly body: Buffer
  readonly delayMs?: number
  readonly headers: Readonly<Record<string, string>>
  readonly statusCode: number
}

const defaultResponse: FakeSmartThingsResponse = {
  body: Buffer.from('{"ok":true}'),
  headers: { "content-type": "application/json" },
  statusCode: 200,
}

export class FakeSmartThingsApi {
  readonly requests: CapturedSmartThingsRequest[] = []
  private readonly responses: FakeSmartThingsResponse[] = []
  private readonly server: Server
  private hangingResponseCount = 0
  private stalledBodyDelayMs: number | null = null
  private origin: URL | undefined
  private started = false

  constructor() {
    this.server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = []
        request.on("data", (chunk: Buffer) => chunks.push(chunk))
        await once(request, "end")
        this.requests.push({
          body: Buffer.concat(chunks),
          headers: request.headers,
          method: request.method,
          url: request.url,
        })
        if (this.hangingResponseCount > 0) {
          this.hangingResponseCount -= 1
          return
        }
        if (this.stalledBodyDelayMs !== null) {
          const delayMs = this.stalledBodyDelayMs
          this.stalledBodyDelayMs = null
          response.writeHead(200, { "content-type": "application/json" })
          response.write('{"partial":')
          setTimeout(() => response.end("true}"), delayMs)
          return
        }
        const configuredResponse = this.responses.shift() ?? defaultResponse
        if (configuredResponse.delayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, configuredResponse.delayMs))
        }
        response.writeHead(configuredResponse.statusCode, configuredResponse.headers)
        response.end(configuredResponse.body)
      })()
    })
  }

  get baseUrl(): URL {
    if (this.origin === undefined) {
      throw new FakeSmartThingsApiNotStartedError()
    }
    return this.origin
  }

  enqueueResponse(response: FakeSmartThingsResponse): void {
    this.responses.push(response)
  }

  hangNextResponse(): void {
    this.hangingResponseCount += 1
  }

  stallNextResponseBody(delayMs: number): void {
    this.stalledBodyDelayMs = delayMs
  }

  async start(): Promise<void> {
    this.server.listen(0, "127.0.0.1")
    await once(this.server, "listening")
    this.started = true
    const address = this.server.address()
    if (address === null || typeof address === "string") {
      throw new FakeSmartThingsApiAddressError()
    }
    this.origin = new URL(`http://127.0.0.1:${address.port}`)
  }

  async close(): Promise<void> {
    if (!this.started) {
      return
    }
    this.started = false
    this.server.closeAllConnections()
    this.server.close()
    await once(this.server, "close")
  }
}

class FakeSmartThingsApiNotStartedError extends Error {
  override readonly name = "FakeSmartThingsApiNotStartedError"

  constructor() {
    super("Fake SmartThings API has not started")
  }
}

class FakeSmartThingsApiAddressError extends Error {
  override readonly name = "FakeSmartThingsApiAddressError"

  constructor() {
    super("Fake SmartThings API did not bind a TCP address")
  }
}
