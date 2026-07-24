import { runInNewContext } from "node:vm"
import { portalClientScript } from "../../src/http/portal-client.js"

export type PortalEvent = {
  defaultPrevented?: boolean
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
  readonly children: PortalElement[] = []
  readonly listeners = new Map<string, PortalListener>()
  disabled = false
  dialogOwner: PortalElement | null = null
  focusCount = 0
  hidden = false
  onFocus: (() => void) | null = null
  open = false
  textContent = ""
  type = "password"
  value = ""

  addEventListener(name: string, listener: PortalListener): void {
    this.listeners.set(name, listener)
  }

  async dispatch(name: string, event: PortalEvent = {}): Promise<void> {
    if (name === "click" && this.disabled) return
    const originalPreventDefault = event.preventDefault
    const dispatchedEvent: PortalEvent = {
      ...event,
      defaultPrevented: false,
      type: event.type ?? name,
    }
    dispatchedEvent.preventDefault = () => {
      dispatchedEvent.defaultPrevented = true
      originalPreventDefault?.()
    }
    await this.listeners.get(name)?.(dispatchedEvent)
    if (
      !dispatchedEvent.defaultPrevented &&
      ((name === "cancel" && this.open) || (name === "submit" && this.dialogOwner?.open === true))
    ) {
      ;(name === "cancel" ? this : this.dialogOwner)?.close()
    }
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
    if (!this.open) return
    this.open = false
    void this.listeners.get("close")?.({ type: "close" })
  }

  focus(): void {
    if (this.disabled) return
    this.focusCount += 1
    this.onFocus?.()
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  replaceChildren(...children: PortalElement[]): void {
    this.children.splice(0, this.children.length, ...children)
  }

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
  ["[data-status-reauthorization]", "statusReauthorization"],
  ["[data-expires-at]", "expires"],
  ["[data-refreshed-at]", "refreshed"],
  ["[data-support-reference]", "supportReference"],
  ["[data-blocked-notice]", "blockedNotice"],
  ["[data-block-reason]", "blockReason"],
  ["[data-blocked-at]", "blockedAt"],
  ["[data-reauthorization-notice]", "reauthorizationNotice"],
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
  ["[data-disconnect-cancel]", "disconnectCancel"],
  ["[data-disconnect-confirm]", "confirm"],
] as const

export function createPortalBrowserFixture(missingSelector?: string) {
  const selectors = new Map<string, string>(selectorEntries)
  if (missingSelector !== undefined) selectors.delete(missingSelector)
  const elements = new Map(
    [...new Set(selectors.values())].map((name) => [name, new PortalElement()]),
  )
  elements.set("input", new PortalElement())
  getPortalElement(elements, "rotateForm").dialogOwner = getPortalElement(elements, "rotateDialog")
  getPortalElement(elements, "disconnectForm").dialogOwner = getPortalElement(elements, "dialog")
  getPortalElement(elements, "status").hidden = true
  getPortalElement(elements, "statusBlocked").hidden = true
  getPortalElement(elements, "statusReauthorization").hidden = true
  getPortalElement(elements, "blockedNotice").hidden = true
  getPortalElement(elements, "reauthorizationNotice").hidden = true
  getPortalElement(elements, "error").hidden = true
  getPortalElement(elements, "rotatedSection").hidden = true
  getPortalElement(elements, "rotatedFeedback").hidden = true
  getPortalElement(elements, "rotatedError").hidden = true
  const selection = {
    range: null as { selected: PortalElement | null } | null,
    removeCount: 0,
  }
  const clipboard = {
    error: null as Error | null,
    writes: [] as string[],
  }
  const focus = { activeElement: null as PortalElement | null }
  for (const element of elements.values()) {
    element.onFocus = () => {
      focus.activeElement = element
    }
  }
  return {
    clipboard,
    confirmation: { accepted: true, messages: [] as string[] },
    elements,
    focus,
    selection,
    selectors,
  }
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
  const { confirmation, elements, selectors } = fixture
  runInNewContext(portalClientScript, {
    AbortController,
    clearTimeout,
    document: {
      createRange: () => {
        const range = {
          selected: null as PortalElement | null,
          selectNodeContents(element: PortalElement) {
            range.selected = element
          },
        }
        return range
      },
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
    navigator: {
      clipboard: {
        writeText: async (value: string) => {
          if (fixture.clipboard.error !== null) throw fixture.clipboard.error
          fixture.clipboard.writes.push(value)
        },
      },
    },
    setTimeout,
    window: {
      addEventListener() {},
      confirm(message: string) {
        confirmation.messages.push(message)
        return confirmation.accepted
      },
      getSelection() {
        return {
          addRange(range: { selected: PortalElement | null }) {
            fixture.selection.range = range
          },
          removeAllRanges() {
            fixture.selection.removeCount += 1
            fixture.selection.range = null
          },
        }
      },
    },
  })
}
