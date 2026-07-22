import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"
import { tokenSafetyClientScript } from "../src/http/token-safety.js"

type Listener = () => unknown

class TokenElement {
  readonly listeners = new Map<string, Listener>()
  disabled = false
  focusCount = 0
  hidden = true
  textContent = ""

  addEventListener(name: string, listener: Listener): void {
    this.listeners.set(name, listener)
  }

  async click(): Promise<void> {
    if (this.disabled) return
    await this.listeners.get("click")?.()
  }

  focus(): void {
    this.focusCount += 1
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
  output.textContent = `grw_st_${"A".repeat(43)}`
  const regionListeners = new Map<string, Listener>()
  const region = {
    addEventListener(name: string, listener: Listener) {
      regionListeners.set(name, listener)
    },
    async dispatch(name: string) {
      await regionListeners.get(name)?.()
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
  return { copy, error, feedback, output, region }
}

function runTokenSafety(
  fixture: ReturnType<typeof createFixture>,
  writeText: (value: string) => Promise<void>,
): void {
  runInNewContext(tokenSafetyClientScript, {
    document: { querySelectorAll: () => [fixture.region] },
    Error,
    navigator: { clipboard: { writeText } },
  })
}

describe("one-time token copy safety", () => {
  it("announces a successful copy through the live status", async () => {
    // Given
    const fixture = createFixture()
    const copiedValues: string[] = []
    runTokenSafety(fixture, async (value) => {
      copiedValues.push(value)
    })

    // When
    await fixture.copy.click()

    // Then
    expect(copiedValues).toEqual([fixture.output.textContent])
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)
    expect(fixture.output.focusCount).toBe(0)
  })

  it("reveals the manual-copy error and focuses the token output when copying fails", async () => {
    // Given
    const fixture = createFixture()
    runTokenSafety(fixture, async () => {
      throw new Error("clipboard unavailable")
    })

    // When
    await fixture.copy.click()

    // Then
    expect(fixture.feedback.hidden).toBe(true)
    expect(fixture.error.hidden).toBe(false)
    expect(fixture.output.focusCount).toBe(1)
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
    fixture.output.textContent = `grw_st_${"B".repeat(43)}`
    const latestClick = fixture.copy.click()
    latestCopy.resolve()
    await latestClick

    // Then
    expect(fixture.copy.disabled).toBe(false)
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)

    // When
    olderCopy.reject(new Error("stale clipboard failure"))
    await olderClick

    // Then
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)
    expect(fixture.output.focusCount).toBe(0)
  })
})
