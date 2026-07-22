import { describe, expect, it } from "vitest"
import {
  createPortalBrowserFixture,
  deferred,
  getPortalElement,
  response,
  runPortalClient,
} from "./fixtures/portal-browser.js"

const validToken = `grw_st_${"A".repeat(43)}`

function activeConnection() {
  return {
    connected: true,
    expiresAt: "2026-07-23T00:00:00.000Z",
    grantedScopes: ["r:devices:*"],
    lastRefreshedAt: null,
    serviceAccess: { status: "active" },
    supportReference: "a".repeat(64),
  }
}

describe("Growful portal connection states", () => {
  it("keeps the form frame mounted and clears only the token after a successful check", async () => {
    // Given
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const status = getPortalElement(fixture.elements, "status")
    const submit = getPortalElement(fixture.elements, "submit")
    let requestCount = 0
    runPortalClient(fixture, async () => {
      requestCount += 1
      return response(200, activeConnection())
    })
    expect(submit.textContent).toBe("연결 상태 확인")
    input.value = validToken

    // When
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Then
    expect(form.hidden).toBe(false)
    expect(input.value).toBe("")
    expect(status.hidden).toBe(false)
    expect(submit.textContent).toBe("상태 다시 확인")

    // When
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Then
    expect(requestCount).toBe(2)
    expect(input.value).toBe("")

    // When
    input.value = "invalid"
    input.checkValidity = () => false
    await form.dispatch("submit", { preventDefault() {} })

    // Then
    expect(requestCount).toBe(2)
    expect(status.hidden).toBe(true)
    expect(submit.textContent).toBe("다시 확인")
  })

  it("uses the fixed action slot for loading and retry states", async () => {
    // Given
    const gate = deferred<ReturnType<typeof response>>()
    const fixture = createPortalBrowserFixture()
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const submit = getPortalElement(fixture.elements, "submit")
    runPortalClient(fixture, async () => gate.promise)
    input.value = validToken

    // When
    await form.dispatch("submit", { preventDefault() {} })

    // Then
    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toBe("확인 중…")

    // When
    gate.resolve(response(429))
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Then
    expect(submit.disabled).toBe(false)
    expect(submit.textContent).toBe("다시 확인")
    expect(errorMessage.textContent).toBe("요청이 너무 많습니다. 잠시 후 다시 확인하세요.")
  })

  it.each([
    [401, "토큰이 교체되었거나 만료되었습니다. 새 Growful 토큰을 입력하세요.", "다시 확인"],
    [404, "연결된 SmartThings 설치를 찾을 수 없습니다.", "SmartThings 다시 연결"],
    [429, "요청이 너무 많습니다. 잠시 후 다시 확인하세요.", "다시 확인"],
  ])("maps HTTP %i to a distinct Korean recovery message", async (status, message, action) => {
    const fixture = createPortalBrowserFixture()
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const reconnect = getPortalElement(fixture.elements, "reconnect")
    const submit = getPortalElement(fixture.elements, "submit")
    runPortalClient(fixture, async () => response(status))
    input.value = validToken

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(errorMessage.textContent).toBe(message)
    expect(reconnect.hidden ? submit.textContent : reconnect.textContent).toBe(action)
  })

  it("renders an inline Korean format error without sending a request", async () => {
    const fixture = createPortalBrowserFixture()
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const submit = getPortalElement(fixture.elements, "submit")
    let requestCount = 0
    input.checkValidity = () => false
    runPortalClient(fixture, async () => {
      requestCount += 1
      return response(200, activeConnection())
    })

    await form.dispatch("submit", { preventDefault() {} })

    expect(requestCount).toBe(0)
    expect(errorMessage.textContent).toBe(
      "Growful 토큰 형식을 확인하세요. grw_st_로 시작하는 50자 토큰을 입력해야 합니다.",
    )
    expect(submit.textContent).toBe("다시 확인")
  })

  it("distinguishes a network failure from HTTP errors", async () => {
    const fixture = createPortalBrowserFixture()
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    input.value = validToken
    runPortalClient(fixture, async () => {
      throw new Error("offline")
    })

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(errorMessage.textContent).toBe("네트워크 연결을 확인한 뒤 다시 시도하세요.")
  })

  it("offers SmartThings reconnection in the action slot after disconnecting", async () => {
    const fixture = createPortalBrowserFixture()
    const confirm = getPortalElement(fixture.elements, "confirm")
    const disconnect = getPortalElement(fixture.elements, "disconnect")
    const disconnectForm = getPortalElement(fixture.elements, "disconnectForm")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const reconnect = getPortalElement(fixture.elements, "reconnect")
    const status = getPortalElement(fixture.elements, "status")
    runPortalClient(fixture, async (_path, options) =>
      options.method === "DELETE" ? response(204) : response(200, activeConnection()),
    )
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    await disconnect.dispatch("click")
    await disconnectForm.dispatch("submit", { preventDefault() {}, submitter: confirm })

    expect(status.hidden).toBe(true)
    expect(form.hidden).toBe(false)
    expect(reconnect.hidden).toBe(false)
    expect(reconnect.textContent).toBe("SmartThings 다시 연결")
  })

  it("does not start a status check while token rotation is pending", async () => {
    const rotation = deferred<ReturnType<typeof response>>()
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const rotate = getPortalElement(fixture.elements, "rotate")
    const rotateConfirm = getPortalElement(fixture.elements, "rotateConfirm")
    const rotateForm = getPortalElement(fixture.elements, "rotateForm")
    const rotatedOutput = getPortalElement(fixture.elements, "rotatedOutput")
    let statusRequestCount = 0
    runPortalClient(fixture, async (path) => {
      if (path === "/token/rotate") return rotation.promise
      statusRequestCount += 1
      return response(200, activeConnection())
    })
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    await rotate.dispatch("click")
    const rotationRequest = rotateForm.dispatch("submit", {
      preventDefault() {},
      submitter: rotateConfirm,
    })
    await form.dispatch("submit", { preventDefault() {} })
    rotation.resolve(response(200, { growfulToken: `grw_st_${"B".repeat(43)}` }))
    await rotationRequest

    expect(statusRequestCount).toBe(1)
    expect(rotatedOutput.textContent).toBe(`grw_st_${"B".repeat(43)}`)
  })

  it("clears the one-time token when the visible status action restores status", async () => {
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const rotate = getPortalElement(fixture.elements, "rotate")
    const rotateConfirm = getPortalElement(fixture.elements, "rotateConfirm")
    const rotateForm = getPortalElement(fixture.elements, "rotateForm")
    const rotatedOutput = getPortalElement(fixture.elements, "rotatedOutput")
    const rotatedSection = getPortalElement(fixture.elements, "rotatedSection")
    const status = getPortalElement(fixture.elements, "status")
    runPortalClient(fixture, async (path) =>
      path === "/token/rotate"
        ? response(200, { growfulToken: `grw_st_${"B".repeat(43)}` })
        : response(200, activeConnection()),
    )
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await rotate.dispatch("click")
    await rotateForm.dispatch("submit", { preventDefault() {}, submitter: rotateConfirm })
    expect(rotatedSection.hidden).toBe(false)

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(rotatedSection.hidden).toBe(true)
    expect(rotatedOutput.textContent).toBe("")
    expect(status.hidden).toBe(false)
  })

  it("restores the rotation trigger focus after a recoverable rotation error", async () => {
    const fixture = createPortalBrowserFixture()
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const rotate = getPortalElement(fixture.elements, "rotate")
    const rotateConfirm = getPortalElement(fixture.elements, "rotateConfirm")
    const rotateForm = getPortalElement(fixture.elements, "rotateForm")
    runPortalClient(fixture, async (path) =>
      path === "/token/rotate" ? response(429) : response(200, activeConnection()),
    )
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    await rotate.dispatch("click")
    await rotateForm.dispatch("submit", { preventDefault() {}, submitter: rotateConfirm })

    expect(errorMessage.textContent).toBe("요청이 너무 많습니다. 잠시 후 다시 확인하세요.")
    expect(rotate.focusCount).toBe(1)
  })
})
