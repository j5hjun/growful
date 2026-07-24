import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import { tokenSafetyClientScript } from "../src/http/token-safety.js"

type TokenSafetyEvent = {
  preventDefault(): void
  returnValue: string
}

type Listener = (event?: TokenSafetyEvent) => unknown

class TokenElement {
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Listener>()
  defaultValue = ""
  disabled = false
  focusCount = 0
  hidden = true
  selectionEnd = 0
  selectionStart = 0
  tabIndex = 0
  textContent = ""
  value = ""

  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, listener)
  }

  async click(): Promise<void> {
    if (this.disabled) return
    await this.listeners.get("click")?.()
  }

  async dispatch(name: string): Promise<void> {
    await this.listeners.get(name)?.()
  }

  focus(): void {
    this.focusCount += 1
  }

  select(): void {
    this.selectionStart = 0
    this.selectionEnd = this.value.length
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
}

function deferred() {
  let resolve: (() => void) | undefined
  let reject: ((error: Error) => void) | undefined
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete
    reject = fail
  })
  return {
    promise,
    reject(error: Error) {
      reject?.(error)
    },
    resolve() {
      resolve?.()
    },
  }
}

function createFixture() {
  const copy = new TokenElement()
  const error = new TokenElement()
  const feedback = new TokenElement()
  const output = new TokenElement()
  const token = `grw_st_${"A".repeat(43)}`
  output.defaultValue = token
  output.textContent = token
  output.value = token
  const regionListeners = new Map<string, Listener>()
  const regionAttributes = new Map<string, string>()
  const region = {
    addEventListener(name: string, listener: Listener) {
      regionListeners.set(name, listener)
    },
    async dispatch(name: string) {
      await regionListeners.get(name)?.()
    },
    removeAttribute(name: string) {
      regionAttributes.delete(name)
    },
    setAttribute(name: string, value: string) {
      regionAttributes.set(name, value)
    },
    querySelector(selector: string) {
      return new Map([
        ["[data-copy-token]", copy],
        ["[data-token-copy-error]", error],
        ["[data-token-copy-feedback]", feedback],
        ["[data-token-value]", output],
      ]).get(selector)
    },
  }
  return { copy, error, feedback, output, region, regionAttributes }
}

function runTokenSafety(
  fixture: ReturnType<typeof createFixture>,
  writeText: (value: string) => Promise<void>,
): {
  dispatchBeforeUnload: () => Promise<{ prevented: boolean; returnValue: string }>
  dispatchPagehide: () => Promise<void>
  getSelectedText: () => string
} {
  const windowListeners = new Map<string, Listener>()
  const selection = {
    toString() {
      return fixture.output.value.slice(fixture.output.selectionStart, fixture.output.selectionEnd)
    },
  }
  runInNewContext(tokenSafetyClientScript, {
    document: {
      querySelectorAll: () => [fixture.region],
    },
    Error,
    navigator: { clipboard: { writeText } },
    window: {
      addEventListener(name: string, listener: Listener) {
        windowListeners.set(name, listener)
      },
      getSelection() {
        return selection
      },
    },
  })
  return {
    async dispatchBeforeUnload() {
      let prevented = false
      const event = {
        preventDefault() {
          prevented = true
        },
        returnValue: "unchanged",
      }
      await windowListeners.get("beforeunload")?.(event)
      return { prevented, returnValue: event.returnValue }
    },
    async dispatchPagehide() {
      await windowListeners.get("pagehide")?.()
    },
    getSelectedText() {
      return selection.toString()
    },
  }
}

describe("one-time token copy safety", () => {
  it("announces a successful copy through the live status", async () => {
    // Given
    const fixture = createFixture()
    const copiedValues: string[] = []
    runTokenSafety(fixture, async (value) => {
      copiedValues.push(value)
    })

    expect(fixture.copy.hidden).toBe(false)
    expect(fixture.copy.disabled).toBe(false)
    expect(fixture.output.tabIndex).toBe(-1)

    // When
    await fixture.copy.click()

    // Then
    expect(copiedValues).toEqual([fixture.output.value])
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)
    expect(fixture.output.focusCount).toBe(0)
    expect(fixture.regionAttributes.has("data-token-safety-acknowledged")).toBe(true)
  })

  it("selects the exact token for keyboard recovery when clipboard copying fails", async () => {
    // Given
    const fixture = createFixture()
    const tokenSafety = runTokenSafety(fixture, async () => {
      throw new Error("clipboard unavailable")
    })

    // When
    await fixture.copy.click()

    // Then
    expect(fixture.feedback.hidden).toBe(true)
    expect(fixture.error.hidden).toBe(false)
    expect(fixture.output.focusCount).toBe(1)
    expect(tokenSafety.getSelectedText()).toBe(fixture.output.value)
  })

  it("acknowledges an exact manual copy after clipboard recovery", async () => {
    // Given
    const fixture = createFixture()
    const tokenSafety = runTokenSafety(fixture, async () => {
      throw new Error("clipboard unavailable")
    })
    await fixture.copy.click()

    // When
    await fixture.output.dispatch("copy")
    const event = await tokenSafety.dispatchBeforeUnload()

    // Then
    expect(fixture.regionAttributes.has("data-token-safety-acknowledged")).toBe(true)
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)
    expect(event.prevented).toBe(false)
    expect(event.returnValue).toBe("unchanged")
  })

  it("does not acknowledge a partial manual selection", async () => {
    // Given
    const fixture = createFixture()
    const tokenSafety = runTokenSafety(fixture, async () => {})
    fixture.output.selectionEnd = fixture.output.value.length - 1

    // When
    await fixture.output.dispatch("copy")
    const event = await tokenSafety.dispatchBeforeUnload()

    // Then
    expect(fixture.regionAttributes.has("data-token-safety-acknowledged")).toBe(false)
    expect(fixture.feedback.hidden).toBe(true)
    expect(event.prevented).toBe(true)
    expect(event.returnValue).toBe("")
  })

  it("prevents another clipboard write while an attempt is pending", async () => {
    // Given
    const fixture = createFixture()
    const pendingAttempt = deferred()
    let writeCount = 0
    runTokenSafety(fixture, async () => {
      writeCount += 1
      await pendingAttempt.promise
    })

    // When
    const pendingClick = fixture.copy.click()
    await fixture.copy.click()

    // Then
    expect(writeCount).toBe(1)
    expect(fixture.copy.disabled).toBe(true)

    // When
    pendingAttempt.resolve()
    await pendingClick

    // Then
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)
    expect(fixture.copy.disabled).toBe(false)
  })

  it("invalidates a pending copy when the one-time token lifecycle resets", async () => {
    // Given
    const fixture = createFixture()
    const olderCopy = deferred()
    const latestCopy = deferred()
    const attempts = [olderCopy, latestCopy]
    runTokenSafety(fixture, async () => {
      const attempt = attempts.shift()
      if (attempt === undefined) throw new Error("Unexpected clipboard attempt")
      await attempt.promise
    })

    // When
    const olderClick = fixture.copy.click()
    await fixture.region.dispatch("token-safety-reset")
    fixture.output.value = `grw_st_${"B".repeat(43)}`
    await fixture.copy.click()

    // Then
    expect(fixture.copy.disabled).toBe(true)
    expect(fixture.feedback.hidden).toBe(true)
    expect(fixture.error.hidden).toBe(true)

    // When
    olderCopy.reject(new Error("stale clipboard failure"))
    await olderClick
    const latestClick = fixture.copy.click()
    latestCopy.resolve()
    await latestClick

    // Then
    expect(fixture.copy.disabled).toBe(false)
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)
    expect(fixture.output.focusCount).toBe(0)
  })

  it("clears the one-time token before a page can enter browser history cache", async () => {
    // Given
    const fixture = createFixture()
    const { dispatchPagehide } = runTokenSafety(fixture, async () => {})

    // When
    await dispatchPagehide()

    // Then
    expect(fixture.output.defaultValue).toBe("")
    expect(fixture.output.textContent).toBe("")
    expect(fixture.output.value).toBe("")
    expect(fixture.copy.disabled).toBe(true)
    expect(fixture.feedback.hidden).toBe(true)
    expect(fixture.error.hidden).toBe(true)
    expect(fixture.regionAttributes.has("data-token-safety-acknowledged")).toBe(false)
  })

  it("requests browser confirmation before leaving with an unacknowledged token", async () => {
    const fixture = createFixture()
    const { dispatchBeforeUnload } = runTokenSafety(fixture, async () => {})

    const event = await dispatchBeforeUnload()

    expect(event.prevented).toBe(true)
    expect(event.returnValue).toBe("")
    expect(fixture.output.value).not.toBe("")
  })

  it("allows leaving after the clipboard copy is confirmed", async () => {
    const fixture = createFixture()
    const { dispatchBeforeUnload } = runTokenSafety(fixture, async () => {})
    await fixture.copy.click()

    const event = await dispatchBeforeUnload()

    expect(event.prevented).toBe(false)
    expect(event.returnValue).toBe("unchanged")
  })

  it.each(["resolve", "reject"] as const)(
    "keeps the copy action disabled when a pending attempt %ss after pagehide",
    async (settlement) => {
      // Given
      const fixture = createFixture()
      const pendingAttempt = deferred()
      const { dispatchPagehide } = runTokenSafety(fixture, async () => {
        await pendingAttempt.promise
      })
      const pendingClick = fixture.copy.click()

      // When
      await dispatchPagehide()
      if (settlement === "resolve") pendingAttempt.resolve()
      else pendingAttempt.reject(new Error("clipboard unavailable"))
      await pendingClick

      // Then
      expect(fixture.output.defaultValue).toBe("")
      expect(fixture.output.textContent).toBe("")
      expect(fixture.output.value).toBe("")
      expect(fixture.copy.disabled).toBe(true)
      expect(fixture.feedback.hidden).toBe(true)
      expect(fixture.error.hidden).toBe(true)
      expect(fixture.output.focusCount).toBe(0)
    },
  )
})
