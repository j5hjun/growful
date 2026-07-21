import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import { portalClientScript } from "../src/http/portal-client.js"

type PortalEvent = {
  preventDefault?: () => void
  submitter?: PortalElement
}

type PortalListener = (event: PortalEvent) => unknown

class PortalElement {
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, PortalListener>()
  disabled = false
  focusCount = 0
  hidden = false
  open = false
  textContent = ""
  type = "password"
  value = ""

  addEventListener(name: string, listener: PortalListener): void {
    this.listeners.set(name, listener)
  }

  async dispatch(name: string, event: PortalEvent = {}): Promise<void> {
    if (name === "click" && this.disabled) return
    await this.listeners.get(name)?.(event)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  checkValidity(): boolean {
    return true
  }

  close(): void {
    this.open = false
  }

  focus(): void {
    this.focusCount += 1
  }

  replaceChildren(..._children: unknown[]): void {}

  reportValidity(): void {}

  showModal(): void {
    this.open = true
  }
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return {
    promise,
    resolve(value: T) {
      resolve?.(value)
    },
  }
}

function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

function createElements() {
  const selectors = new Map([
    ["#growful-token", "input"],
    ["[data-portal-token-form]", "form"],
    ["[data-token-submit]", "submit"],
    ["[data-token-visibility]", "visibility"],
    ["[data-portal-feedback]", "feedback"],
    ["[data-portal-error]", "error"],
    ["[data-portal-error-message]", "errorMessage"],
    ["[data-reconnect]", "reconnect"],
    ["[data-portal-status]", "status"],
    ["[data-expires-at]", "expires"],
    ["[data-refreshed-at]", "refreshed"],
    ["[data-scope-list]", "scopes"],
    ["[data-forget-token]", "forget"],
    ["[data-rotate-token]", "rotate"],
    ["[data-rotated-token-section]", "rotatedSection"],
    ["[data-rotated-token]", "rotatedOutput"],
    ["[data-copy-token]", "copy"],
    ["[data-disconnect]", "disconnect"],
    ["[data-disconnect-dialog]", "dialog"],
    ["[data-disconnect-form]", "disconnectForm"],
    ["[data-disconnect-confirm]", "confirm"],
  ])
  const elements = new Map(
    [...new Set(selectors.values())].map((name) => [name, new PortalElement()]),
  )
  elements.set("input", new PortalElement())
  getElement(elements, "status").hidden = true
  getElement(elements, "rotatedSection").hidden = true
  return { elements, selectors }
}

function getElement(elements: Map<string, PortalElement>, name: string): PortalElement {
  const element = elements.get(name)
  if (element === undefined) throw new Error(`Missing portal element: ${name}`)
  return element
}

describe("Growful portal token mutations", () => {
  it("serializes rotation and disconnect in both orderings", async () => {
    // Given
    const tokenA = `grw_st_${"A".repeat(43)}`
    const tokenB = `grw_st_${"B".repeat(43)}`
    const rotationResponse = deferred<ReturnType<typeof response>>()
    const { elements, selectors } = createElements()
    const confirm = getElement(elements, "confirm")
    const dialog = getElement(elements, "dialog")
    const disconnect = getElement(elements, "disconnect")
    const disconnectForm = getElement(elements, "disconnectForm")
    const forget = getElement(elements, "forget")
    const form = getElement(elements, "form")
    const input = getElement(elements, "input")
    const rotate = getElement(elements, "rotate")
    const status = getElement(elements, "status")
    let serverToken: string | null = tokenA
    let deleteGate: ReturnType<typeof deferred<void>> | undefined
    let rotationRequests = 0
    const deleteAuthorizations: string[] = []
    const fetch = async (
      path: string,
      options: { headers: { authorization: string }; method: string },
    ) => {
      const authorization = options.headers.authorization.slice("Bearer ".length)
      if (path === "/connection" && options.method === "GET") {
        return response(authorization === serverToken ? 200 : 401, {
          connected: true,
          expiresAt: "2026-07-23T00:00:00.000Z",
          grantedScopes: [],
          lastRefreshedAt: null,
        })
      }
      if (path === "/token/rotate") {
        rotationRequests += 1
        if (authorization !== serverToken) return response(401)
        serverToken = tokenB
        return rotationResponse.promise
      }
      deleteAuthorizations.push(authorization)
      await deleteGate?.promise
      if (authorization !== serverToken) return response(401)
      serverToken = null
      return response(204)
    }
    runInNewContext(portalClientScript, {
      document: {
        createElement: () => new PortalElement(),
        getElementById: (id: string) => elements.get(id === "growful-token" ? "input" : id),
        querySelector: (selector: string) => elements.get(selectors.get(selector) ?? ""),
      },
      fetch,
      Intl,
      navigator: { clipboard: { writeText: async () => {} } },
    })
    input.value = tokenA
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(status.focusCount).toBe(1)

    // When
    const pendingRotation = rotate.dispatch("click")
    await Promise.resolve()
    await disconnect.dispatch("click")

    // Then
    expect(serverToken).toBe(tokenB)
    expect(forget.disabled).toBe(true)
    expect(disconnect.disabled).toBe(true)
    expect(dialog.open).toBe(false)
    expect(deleteAuthorizations).toEqual([])

    rotationResponse.resolve(response(200, { growfulToken: tokenB }))
    await pendingRotation
    await disconnect.dispatch("click")
    await disconnectForm.dispatch("submit", {
      preventDefault() {},
      submitter: confirm,
    })
    expect(deleteAuthorizations).toEqual([tokenB])
    expect(serverToken).toBeNull()

    serverToken = tokenA
    deleteAuthorizations.length = 0
    input.value = tokenA
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    deleteGate = deferred<void>()
    await disconnect.dispatch("click")
    const pendingDisconnect = disconnectForm.dispatch("submit", {
      preventDefault() {},
      submitter: confirm,
    })
    await Promise.resolve()
    dialog.close()
    await dialog.dispatch("close")
    await rotate.dispatch("click")
    expect(rotate.disabled).toBe(true)
    expect(rotationRequests).toBe(1)
    expect(serverToken).toBe(tokenA)
    deleteGate.resolve()
    await pendingDisconnect
    expect(deleteAuthorizations).toEqual([tokenA])
    expect(serverToken).toBeNull()
  })
})
