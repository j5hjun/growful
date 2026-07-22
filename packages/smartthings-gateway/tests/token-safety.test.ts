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
  const region = {
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

  it("ignores stale clipboard results when attempts settle out of order", async () => {
    // Given
    const fixture = createFixture()
    const olderAttempt = deferred()
    const latestAttempt = deferred()
    const attempts = [olderAttempt, latestAttempt]
    runTokenSafety(fixture, async () => {
      const attempt = attempts.shift()
      if (attempt === undefined) throw new Error("Unexpected clipboard attempt")
      await attempt.promise
    })

    // When
    const olderClick = fixture.copy.click()
    const latestClick = fixture.copy.click()
    latestAttempt.resolve()
    await latestClick

    // Then
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)
    expect(fixture.copy.disabled).toBe(false)

    // When
    olderAttempt.reject(new Error("late clipboard failure"))
    await olderClick

    // Then
    expect(fixture.feedback.hidden).toBe(false)
    expect(fixture.error.hidden).toBe(true)
    expect(fixture.output.focusCount).toBe(0)
  })
})
