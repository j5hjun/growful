import { runInNewContext } from "node:vm"
import { portalClientScript } from "../../src/http/portal-client.js"

export type PortalEvent = {
  preventDefault?: () => void
  submitter?: PortalElement
  type?: string
}

export type PortalFetch = (
  path: string,
  options: {
    readonly headers: { readonly authorization: string }
    readonly method: string
  },
) => unknown

type PortalListener = (event: PortalEvent) => unknown

export class PortalElement {
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

  dispatchEvent(event: PortalEvent): boolean {
    if (event.type !== undefined) void this.dispatch(event.type, event)
    return true
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

export function deferred<T>() {
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

export function response(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

const selectorEntries = [
  ["#growful-token", "input"],
  ["[data-portal-token-form]", "form"],
  ["[data-token-submit]", "submit"],
  ["[data-token-visibility]", "visibility"],
  ["[data-portal-feedback]", "feedback"],
  ["[data-portal-error]", "error"],
  ["[data-portal-error-message]", "errorMessage"],
  ["[data-reconnect]", "reconnect"],
  ["[data-portal-status]", "status"],
  ["[data-status-active]", "statusActive"],
  ["[data-status-blocked]", "statusBlocked"],
  ["[data-expires-at]", "expires"],
  ["[data-refreshed-at]", "refreshed"],
  ["[data-support-reference]", "supportReference"],
  ["[data-blocked-notice]", "blockedNotice"],
  ["[data-block-reason]", "blockReason"],
  ["[data-blocked-at]", "blockedAt"],
  ["[data-copy-support-reference]", "copySupportReference"],
  ["[data-scope-list]", "scopes"],
  ["[data-forget-token]", "forget"],
  ["[data-rotate-token]", "rotate"],
  ["[data-rotate-token-dialog]", "rotateDialog"],
  ["[data-rotate-token-form]", "rotateForm"],
  ["[data-rotate-token-confirm]", "rotateConfirm"],
  ["[data-rotated-token-section]", "rotatedSection"],
  ["[data-rotated-token]", "rotatedOutput"],
  ["[data-token-copy-feedback]", "rotatedFeedback"],
  ["[data-token-copy-error]", "rotatedError"],
  ["[data-copy-token]", "copy"],
  ["[data-return-status]", "returnStatus"],
  ["[data-disconnect]", "disconnect"],
  ["[data-disconnect-dialog]", "dialog"],
  ["[data-disconnect-form]", "disconnectForm"],
  ["[data-disconnect-confirm]", "confirm"],
] as const

export function createPortalBrowserFixture(missingSelector?: string) {
  const selectors = new Map<string, string>(selectorEntries)
  if (missingSelector !== undefined) selectors.delete(missingSelector)
  const elements = new Map(
    [...new Set(selectors.values())].map((name) => [name, new PortalElement()]),
  )
  elements.set("input", new PortalElement())
  getPortalElement(elements, "status").hidden = true
  getPortalElement(elements, "statusBlocked").hidden = true
  getPortalElement(elements, "blockedNotice").hidden = true
  getPortalElement(elements, "error").hidden = true
  getPortalElement(elements, "rotatedSection").hidden = true
  getPortalElement(elements, "rotatedFeedback").hidden = true
  getPortalElement(elements, "rotatedError").hidden = true
  return { elements, selectors }
}

export function getPortalElement(
  elements: Map<string, PortalElement>,
  name: string,
): PortalElement {
  const element = elements.get(name)
  if (element === undefined) throw new Error(`Missing portal element: ${name}`)
  return element
}

export function runPortalClient(
  fixture: ReturnType<typeof createPortalBrowserFixture>,
  fetch: PortalFetch,
): void {
  const { elements, selectors } = fixture
  runInNewContext(portalClientScript, {
    document: {
      createElement: () => new PortalElement(),
      getElementById: (id: string) => elements.get(id === "growful-token" ? "input" : id) ?? null,
      querySelector: (selector: string) => elements.get(selectors.get(selector) ?? "") ?? null,
      querySelectorAll: (selector: string) =>
        selector === "[data-token-safety]"
          ? [
              {
                querySelector: (regionSelector: string) =>
                  elements.get(selectors.get(regionSelector) ?? "") ?? null,
              },
            ]
          : [],
    },
    fetch,
    Event: class {
      constructor(readonly type: string) {}
    },
    Intl,
    navigator: { clipboard: { writeText: async () => {} } },
  })
}
