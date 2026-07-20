import { type IncomingHttpHeaders, type IncomingMessage, request as requestHttp } from "node:http"
import { request as requestHttps } from "node:https"
import type { InstalledAppId } from "../oauth/contracts.js"
import { OAuthConnectionRequiredError, type OAuthService } from "../oauth/oauth-service.js"

const defaultMaxResponseBytes = 10 * 1_024 * 1_024
const forwardedRequestHeaders = [
  "accept",
  "accept-encoding",
  "accept-language",
  "content-encoding",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-unmodified-since",
  "range",
  "x-request-id",
] as const

const omittedResponseHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

export type SmartThingsProxyOptions = {
  readonly apiBaseUrl: URL
  readonly maxResponseBytes?: number
  readonly service: OAuthService
  readonly timeoutMs: number
}

export type SmartThingsProxyRequest = {
  readonly body: Buffer | undefined
  readonly headers: Readonly<IncomingHttpHeaders>
  readonly method: string
  readonly rawUrl: string
}

type SmartThingsProxyResponseHeaders = Readonly<Record<string, string | readonly string[]>>

export type SmartThingsProxyResponse = {
  readonly body: Buffer
  readonly headers: SmartThingsProxyResponseHeaders
  readonly statusCode: number
}

export class SmartThingsGatewayTimeoutError extends Error {
  override readonly name = "SmartThingsGatewayTimeoutError"

  constructor(options?: ErrorOptions) {
    super("SmartThings API request timed out", options)
  }
}

export class SmartThingsGatewayUnavailableError extends Error {
  override readonly name = "SmartThingsGatewayUnavailableError"

  constructor(options?: ErrorOptions) {
    super("SmartThings API request failed", options)
  }
}

export class SmartThingsGatewayResponseTooLargeError extends Error {
  override readonly name = "SmartThingsGatewayResponseTooLargeError"

  constructor() {
    super("SmartThings API response exceeded the gateway limit")
  }
}

export class SmartThingsProxy {
  private readonly maxResponseBytes: number

  constructor(private readonly options: SmartThingsProxyOptions) {
    this.maxResponseBytes = options.maxResponseBytes ?? defaultMaxResponseBytes
  }

  async forward(
    request: SmartThingsProxyRequest,
    installedAppId: InstalledAppId,
  ): Promise<SmartThingsProxyResponse> {
    try {
      const rejectedAccessToken = await this.options.service.getAccessToken(installedAppId)
      const firstResponse = await this.request(request, rejectedAccessToken)
      if (firstResponse.statusCode !== 401) {
        return firstResponse
      }

      const refreshed = await this.options.service.refreshAccessToken(
        installedAppId,
        rejectedAccessToken,
      )
      const retryAccessToken = await this.options.service.getAccessToken(installedAppId)
      if (!refreshed && retryAccessToken === rejectedAccessToken) {
        return firstResponse
      }
      return this.request(request, retryAccessToken)
    } catch (error) {
      if (
        error instanceof OAuthConnectionRequiredError ||
        error instanceof SmartThingsGatewayTimeoutError ||
        error instanceof SmartThingsGatewayUnavailableError ||
        error instanceof SmartThingsGatewayResponseTooLargeError
      ) {
        throw error
      }
      throw new SmartThingsGatewayUnavailableError({ cause: error })
    }
  }

  private request(
    request: SmartThingsProxyRequest,
    accessToken: string,
  ): Promise<SmartThingsProxyResponse> {
    const target = this.options.apiBaseUrl
    const requestTransport =
      target.protocol === "http:" ? requestHttp : target.protocol === "https:" ? requestHttps : null
    if (requestTransport === null) {
      throw new SmartThingsGatewayUnavailableError()
    }

    return new Promise((resolve, reject) => {
      let settled = false
      let timeout: NodeJS.Timeout | undefined
      const fail = (error: unknown): void => {
        if (settled) {
          return
        }
        settled = true
        if (timeout !== undefined) {
          clearTimeout(timeout)
        }
        reject(error)
      }
      const succeed = (response: SmartThingsProxyResponse): void => {
        if (settled) {
          return
        }
        settled = true
        if (timeout !== undefined) {
          clearTimeout(timeout)
        }
        resolve(response)
      }

      const headers = this.requestHeaders(request.headers, accessToken)
      if (request.body !== undefined) {
        headers["content-length"] = request.body.length.toString()
      }
      const upstreamRequest = requestTransport(
        {
          headers,
          hostname: target.hostname,
          method: request.method,
          path: request.rawUrl,
          port: target.port === "" ? undefined : target.port,
          protocol: target.protocol,
        },
        (upstreamResponse) => {
          this.readResponse(upstreamResponse, upstreamRequest, succeed, fail)
        },
      )
      upstreamRequest.once("error", fail)
      timeout = setTimeout(() => {
        const error = new SmartThingsGatewayTimeoutError()
        fail(error)
        upstreamRequest.destroy(error)
      }, this.options.timeoutMs)
      if (request.body === undefined) {
        upstreamRequest.end()
      } else {
        upstreamRequest.end(request.body)
      }
    })
  }

  private readResponse(
    response: IncomingMessage,
    upstreamRequest: ReturnType<typeof requestHttp>,
    succeed: (response: SmartThingsProxyResponse) => void,
    fail: (error: unknown) => void,
  ): void {
    const chunks: Buffer[] = []
    let receivedBytes = 0
    response.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length
      if (receivedBytes > this.maxResponseBytes) {
        const error = new SmartThingsGatewayResponseTooLargeError()
        fail(error)
        response.destroy(error)
        upstreamRequest.destroy(error)
        return
      }
      chunks.push(chunk)
    })
    response.once("error", fail)
    response.once("end", () => {
      succeed({
        body: Buffer.concat(chunks),
        headers: this.responseHeaders(response),
        statusCode: response.statusCode ?? 502,
      })
    })
  }

  private requestHeaders(
    requestHeaders: Readonly<IncomingHttpHeaders>,
    accessToken: string,
  ): Record<string, string | string[]> {
    const headers: Record<string, string | string[]> = {
      authorization: `Bearer ${accessToken}`,
    }
    const nominatedHeaders = new Set(
      (requestHeaders.connection ?? "")
        .split(",")
        .map((header) => header.trim().toLowerCase())
        .filter((header) => header.length > 0),
    )
    for (const header of forwardedRequestHeaders) {
      if (nominatedHeaders.has(header)) {
        continue
      }
      const value = requestHeaders[header]
      if (value !== undefined) {
        headers[header] = value
      }
    }
    return headers
  }

  private responseHeaders(response: IncomingMessage): SmartThingsProxyResponseHeaders {
    const omittedHeaders = new Set(omittedResponseHeaders)
    const connection = response.headers.connection
    const connectionValues = connection === undefined ? [] : [connection]
    for (const value of connectionValues) {
      for (const header of value.split(",")) {
        omittedHeaders.add(header.trim().toLowerCase())
      }
    }

    const headers: Record<string, string | string[]> = {}
    for (let index = 0; index < response.rawHeaders.length; index += 2) {
      const header = response.rawHeaders[index]
      const value = response.rawHeaders[index + 1]
      if (header === undefined || value === undefined) {
        continue
      }
      const normalizedHeader = header.toLowerCase()
      if (omittedHeaders.has(normalizedHeader)) {
        continue
      }
      const existing = headers[normalizedHeader]
      if (existing === undefined) {
        headers[normalizedHeader] = value
      } else if (Array.isArray(existing)) {
        existing.push(value)
      } else {
        headers[normalizedHeader] = [existing, value]
      }
    }
    return headers
  }
}
