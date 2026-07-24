import { describe, expect, it, vi } from "vitest"
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
    authorizationHealth: { status: "active" },
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
    const statusActive = getPortalElement(fixture.elements, "statusActive")
    const statusReauthorization = getPortalElement(fixture.elements, "statusReauthorization")
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
    expect(statusActive.hidden).toBe(false)
    expect(statusReauthorization.hidden).toBe(true)
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
    [
      401,
      "입력한 Growful 토큰이 올바르지 않거나 이미 교체 또는 회수되었습니다. 현재 유효한 토큰을 입력하세요.",
      "다시 확인",
    ],
    [404, "연결된 SmartThings 설치를 찾을 수 없습니다.", "SmartThings 다시 연결"],
    [429, "요청이 너무 많습니다. 잠시 후 다시 확인하세요.", "다시 확인"],
    [
      503,
      "Growful 관리 서비스를 일시적으로 사용할 수 없습니다. 연결은 삭제되지 않았습니다. 잠시 후 상태를 다시 확인하세요.",
      "상태 다시 확인",
    ],
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

  it("preserves the last status and entered token during a temporary service outage", async () => {
    const replacementToken = `grw_st_${"B".repeat(43)}`
    const fixture = createPortalBrowserFixture()
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const reconnect = getPortalElement(fixture.elements, "reconnect")
    const status = getPortalElement(fixture.elements, "status")
    const submit = getPortalElement(fixture.elements, "submit")
    let requestCount = 0
    runPortalClient(fixture, async () => {
      requestCount += 1
      return requestCount === 1 ? response(200, activeConnection()) : response(503)
    })
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    input.value = replacementToken

    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(status.hidden).toBe(false)
    expect(input.value).toBe(replacementToken)
    expect(reconnect.hidden).toBe(true)
    expect(submit.textContent).toBe("상태 다시 확인")
    expect(errorMessage.textContent).toContain("연결은 삭제되지 않았습니다")
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

  it.each([
    ["response", async () => new Promise(() => {})],
    [
      "response body",
      async () => ({
        ok: true,
        status: 200,
        async json() {
          return new Promise(() => {})
        },
      }),
    ],
  ])("times out a never-settling %s and gives safe retry guidance", async (_phase, fetch) => {
    vi.useFakeTimers()
    try {
      const fixture = createPortalBrowserFixture()
      const errorMessage = getPortalElement(fixture.elements, "errorMessage")
      const form = getPortalElement(fixture.elements, "form")
      const input = getPortalElement(fixture.elements, "input")
      input.value = validToken
      runPortalClient(fixture, fetch)

      await form.dispatch("submit", { preventDefault() {} })
      expect(form.attributes.get("aria-busy")).toBe("true")

      await vi.advanceTimersByTimeAsync(10_000)

      expect(errorMessage.textContent).toBe(
        "연결 상태 확인 시간이 초과되었습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요.",
      )
      expect(form.attributes.has("aria-busy")).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps focus on the visibility toggle while changing token visibility", async () => {
    const fixture = createPortalBrowserFixture()
    const input = getPortalElement(fixture.elements, "input")
    const visibility = getPortalElement(fixture.elements, "visibility")
    runPortalClient(fixture, async () => response(200, activeConnection()))

    await visibility.dispatch("click")

    expect(input.type).toBe("text")
    expect(input.focusCount).toBe(0)
    expect(visibility.textContent).toBe("토큰 가리기")
    expect(visibility.attributes.get("aria-pressed")).toBe("true")
  })

  it("focuses and selects only the support reference when clipboard access fails", async () => {
    const fixture = createPortalBrowserFixture()
    const copy = getPortalElement(fixture.elements, "copySupportReference")
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const supportReference = getPortalElement(fixture.elements, "supportReference")
    supportReference.textContent = "f".repeat(64)
    fixture.clipboard.error = new Error("clipboard denied")
    runPortalClient(fixture, async () => response(200, activeConnection()))

    await copy.dispatch("click")

    expect(errorMessage.textContent).toBe(
      "자동 복사를 사용할 수 없습니다. 값을 직접 선택해 복사하세요.",
    )
    expect(supportReference.focusCount).toBe(1)
    expect(fixture.selection.removeCount).toBe(1)
    expect(fixture.selection.range?.selected).toBe(supportReference)
  })

  it("checks another token while keeping SmartThings reconnection after disconnecting", async () => {
    // Given
    const replacementToken = `grw_st_${"B".repeat(43)}`
    const fixture = createPortalBrowserFixture()
    const confirm = getPortalElement(fixture.elements, "confirm")
    const disconnect = getPortalElement(fixture.elements, "disconnect")
    const disconnectForm = getPortalElement(fixture.elements, "disconnectForm")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const reconnect = getPortalElement(fixture.elements, "reconnect")
    const status = getPortalElement(fixture.elements, "status")
    const submit = getPortalElement(fixture.elements, "submit")
    let statusRequests = 0
    runPortalClient(fixture, async (_path, options) => {
      if (options.method === "DELETE") return response(204)
      statusRequests += 1
      return response(200, activeConnection())
    })
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    // When
    await disconnect.dispatch("click")
    await disconnectForm.dispatch("submit", { preventDefault() {}, submitter: confirm })

    // Then
    expect(status.hidden).toBe(true)
    expect(form.hidden).toBe(false)
    expect(submit.hidden).toBe(false)
    expect(submit.textContent).toBe("연결 상태 확인")
    expect(reconnect.hidden).toBe(false)
    expect(reconnect.textContent).toBe("SmartThings 다시 연결")
    expect(input.focusCount).toBe(1)
    expect(reconnect.focusCount).toBe(0)
    expect(fixture.focus.activeElement).toBe(input)

    // When
    input.value = replacementToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    // Then
    expect(statusRequests).toBe(2)
    expect(status.hidden).toBe(false)
    expect(status.focusCount).toBe(2)
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
    const status = getPortalElement(fixture.elements, "status")
    const submit = getPortalElement(fixture.elements, "submit")
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
    expect(fixture.focus.activeElement).toBe(status)
    expect(submit.disabled).toBe(true)
    expect(submit.attributes.get("aria-busy")).toBe("true")
    await form.dispatch("submit", { preventDefault() {} })
    rotation.resolve(response(200, { growfulToken: `grw_st_${"B".repeat(43)}` }))
    await rotationRequest

    expect(statusRequestCount).toBe(1)
    expect(rotatedOutput.textContent).toBe(`grw_st_${"B".repeat(43)}`)
    expect(submit.disabled).toBe(false)
    expect(submit.attributes.has("aria-busy")).toBe(false)
  })

  it("keeps the one-time token until the visible status action successfully restores status", async () => {
    const refreshedConnection = deferred<ReturnType<typeof response>>()
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const rotate = getPortalElement(fixture.elements, "rotate")
    const rotateConfirm = getPortalElement(fixture.elements, "rotateConfirm")
    const rotateForm = getPortalElement(fixture.elements, "rotateForm")
    const rotatedOutput = getPortalElement(fixture.elements, "rotatedOutput")
    const rotatedSection = getPortalElement(fixture.elements, "rotatedSection")
    const status = getPortalElement(fixture.elements, "status")
    let statusRequests = 0
    runPortalClient(fixture, async (path) => {
      if (path === "/token/rotate") {
        return response(200, { growfulToken: `grw_st_${"B".repeat(43)}` })
      }
      statusRequests += 1
      return statusRequests === 1 ? response(200, activeConnection()) : refreshedConnection.promise
    })
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await rotate.dispatch("click")
    await rotateForm.dispatch("submit", { preventDefault() {}, submitter: rotateConfirm })
    expect(rotatedSection.hidden).toBe(false)

    const statusRefresh = form.dispatch("submit", { preventDefault() {} })

    expect(rotatedSection.hidden).toBe(false)
    expect(rotatedOutput.textContent).toBe(`grw_st_${"B".repeat(43)}`)
    refreshedConnection.resolve(response(200, activeConnection()))
    await statusRefresh
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(status.hidden).toBe(false)
    expect(rotatedSection.hidden).toBe(true)
    expect(rotatedOutput.textContent).toBe("")
  })

  it("keeps an unconfirmed replacement token visible when status return is cancelled", async () => {
    const fixture = createPortalBrowserFixture()
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const returnStatus = getPortalElement(fixture.elements, "returnStatus")
    const rotate = getPortalElement(fixture.elements, "rotate")
    const rotateConfirm = getPortalElement(fixture.elements, "rotateConfirm")
    const rotateForm = getPortalElement(fixture.elements, "rotateForm")
    const rotatedOutput = getPortalElement(fixture.elements, "rotatedOutput")
    const rotatedSection = getPortalElement(fixture.elements, "rotatedSection")
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
    fixture.confirmation.accepted = false

    await returnStatus.dispatch("click")

    expect(rotatedSection.hidden).toBe(false)
    expect(rotatedOutput.textContent).toBe(`grw_st_${"B".repeat(43)}`)
    expect(rotatedOutput.focusCount).toBe(2)
    expect(fixture.confirmation.messages[0]).toContain("다시 볼 수 없습니다")
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

  it("bounds a never-settling rotation and treats its outcome as uncertain", async () => {
    vi.useFakeTimers()
    try {
      const fixture = createPortalBrowserFixture()
      const errorMessage = getPortalElement(fixture.elements, "errorMessage")
      const form = getPortalElement(fixture.elements, "form")
      const input = getPortalElement(fixture.elements, "input")
      const reconnect = getPortalElement(fixture.elements, "reconnect")
      const rotate = getPortalElement(fixture.elements, "rotate")
      const rotateConfirm = getPortalElement(fixture.elements, "rotateConfirm")
      const rotateForm = getPortalElement(fixture.elements, "rotateForm")
      const status = getPortalElement(fixture.elements, "status")
      runPortalClient(fixture, async (path) =>
        path === "/token/rotate"
          ? new Promise(() => {})
          : Promise.resolve(response(200, activeConnection())),
      )
      input.value = validToken
      await form.dispatch("submit", { preventDefault() {} })
      await vi.advanceTimersByTimeAsync(0)

      await rotate.dispatch("click")
      const pendingRotation = rotateForm.dispatch("submit", {
        preventDefault() {},
        submitter: rotateConfirm,
      })
      expect(rotate.textContent).toBe("Growful 토큰 교체 중…")
      expect(rotate.attributes.get("aria-label")).toBe("Growful 토큰 교체 중입니다")
      expect(rotate.attributes.get("aria-busy")).toBe("true")
      expect(status.attributes.get("aria-busy")).toBe("true")

      await vi.advanceTimersByTimeAsync(10_000)
      await pendingRotation

      expect(errorMessage.textContent).toContain("토큰 교체가 이미 적용되었을 수 있습니다")
      expect(errorMessage.textContent).toContain("다시 교체하지 마세요")
      expect(reconnect.hidden).toBe(false)
      expect(reconnect.focusCount).toBe(1)
      expect(rotate.textContent).toBe("Growful 토큰 교체")
      expect(rotate.attributes.has("aria-label")).toBe(false)
      expect(rotate.attributes.has("aria-busy")).toBe(false)
      expect(status.hidden).toBe(true)
      expect(status.attributes.has("aria-busy")).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ["network", () => Promise.reject(new Error("offline"))],
    ["server", () => Promise.resolve(response(502))],
    ["schema", () => Promise.resolve(response(200, { growfulToken: "invalid" }))],
  ])(
    "uses OAuth recovery instead of a blind retry after an uncertain rotation %s failure",
    async (_failure, rotationResponse) => {
      const fixture = createPortalBrowserFixture()
      const errorMessage = getPortalElement(fixture.elements, "errorMessage")
      const form = getPortalElement(fixture.elements, "form")
      const input = getPortalElement(fixture.elements, "input")
      const reconnect = getPortalElement(fixture.elements, "reconnect")
      const rotate = getPortalElement(fixture.elements, "rotate")
      const rotateConfirm = getPortalElement(fixture.elements, "rotateConfirm")
      const rotateForm = getPortalElement(fixture.elements, "rotateForm")
      runPortalClient(fixture, async (path) =>
        path === "/token/rotate" ? rotationResponse() : response(200, activeConnection()),
      )
      input.value = validToken
      await form.dispatch("submit", { preventDefault() {} })
      await new Promise<void>((resolve) => setImmediate(resolve))

      await rotate.dispatch("click")
      await rotateForm.dispatch("submit", {
        preventDefault() {},
        submitter: rotateConfirm,
      })

      expect(errorMessage.textContent).toContain("토큰 교체가 이미 적용되었을 수 있습니다")
      expect(errorMessage.textContent).toContain("다시 교체하지 마세요")
      expect(reconnect.hidden).toBe(false)
      expect(reconnect.textContent).toBe("SmartThings 다시 연결")
      expect(reconnect.focusCount).toBe(1)
      expect(rotate.textContent).toBe("Growful 토큰 교체")
      expect(rotate.attributes.has("aria-label")).toBe(false)
      expect(rotate.attributes.has("aria-busy")).toBe(false)
    },
  )

  it("latches OAuth recovery and ignores stale-token status submissions after uncertain rotation", async () => {
    const fixture = createPortalBrowserFixture()
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const reconnect = getPortalElement(fixture.elements, "reconnect")
    const rotate = getPortalElement(fixture.elements, "rotate")
    const rotateConfirm = getPortalElement(fixture.elements, "rotateConfirm")
    const rotateForm = getPortalElement(fixture.elements, "rotateForm")
    const status = getPortalElement(fixture.elements, "status")
    const submit = getPortalElement(fixture.elements, "submit")
    let statusRequests = 0
    runPortalClient(fixture, async (path) => {
      if (path === "/token/rotate") return response(502)
      statusRequests += 1
      return response(200, activeConnection())
    })
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await rotate.dispatch("click")

    await rotateForm.dispatch("submit", {
      preventDefault() {},
      submitter: rotateConfirm,
    })
    const recoveryMessage = errorMessage.textContent
    await form.dispatch("submit", { preventDefault() {} })

    expect(statusRequests).toBe(1)
    expect(errorMessage.textContent).toBe(recoveryMessage)
    expect(status.hidden).toBe(true)
    expect(input.value).toBe("")
    expect(input.disabled).toBe(true)
    expect(submit.hidden).toBe(true)
    expect(submit.disabled).toBe(true)
    expect(reconnect.hidden).toBe(false)
    expect(reconnect.attributes.get("class")).toBe("action action-primary")
    expect(fixture.focus.activeElement).toBe(reconnect)
  })

  it("announces pending disconnect state and safely recovers from an uncertain outcome", async () => {
    const disconnectResponse = deferred<ReturnType<typeof response>>()
    const fixture = createPortalBrowserFixture()
    const cancel = getPortalElement(fixture.elements, "disconnectCancel")
    const confirm = getPortalElement(fixture.elements, "confirm")
    const dialog = getPortalElement(fixture.elements, "dialog")
    const disconnect = getPortalElement(fixture.elements, "disconnect")
    const disconnectForm = getPortalElement(fixture.elements, "disconnectForm")
    const errorMessage = getPortalElement(fixture.elements, "errorMessage")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const reconnect = getPortalElement(fixture.elements, "reconnect")
    const status = getPortalElement(fixture.elements, "status")
    runPortalClient(fixture, async (_path, options) =>
      options.method === "DELETE" ? disconnectResponse.promise : response(200, activeConnection()),
    )
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))

    await disconnect.dispatch("click")
    const pendingDisconnect = disconnectForm.dispatch("submit", {
      preventDefault() {},
      submitter: confirm,
    })
    expect(confirm.textContent).toBe("연결 해제 중…")
    expect(confirm.attributes.get("aria-label")).toBe("연결 해제 중입니다")
    expect(confirm.attributes.get("aria-busy")).toBe("true")
    expect(disconnect.attributes.get("aria-busy")).toBe("true")
    expect(disconnectForm.attributes.get("aria-busy")).toBe("true")
    expect(status.attributes.get("aria-busy")).toBe("true")
    expect(dialog.open).toBe(true)
    expect(cancel.disabled).toBe(true)
    expect(fixture.focus.activeElement).toBe(dialog)

    await dialog.dispatch("cancel")
    await disconnectForm.dispatch("submit", { submitter: cancel })

    expect(dialog.open).toBe(true)
    expect(fixture.focus.activeElement).toBe(dialog)

    disconnectResponse.resolve(response(503))
    await pendingDisconnect

    expect(errorMessage.textContent).toContain("연결 해제가 이미 적용되었을 수 있습니다")
    expect(errorMessage.textContent).toContain("다시 해제하지 마세요")
    expect(reconnect.hidden).toBe(false)
    expect(reconnect.focusCount).toBe(1)
    expect(status.hidden).toBe(true)
    expect(confirm.textContent).toBe("연결 해제")
    expect(confirm.attributes.has("aria-busy")).toBe(false)
    expect(disconnect.attributes.has("aria-busy")).toBe(false)
    expect(disconnectForm.attributes.has("aria-busy")).toBe(false)
    expect(status.attributes.has("aria-busy")).toBe(false)
    expect(dialog.open).toBe(false)
    expect(cancel.disabled).toBe(false)
    expect(fixture.focus.activeElement).toBe(reconnect)
  })

  it("treats a disconnect timeout as uncertain and focuses OAuth recovery", async () => {
    vi.useFakeTimers()
    try {
      const fixture = createPortalBrowserFixture()
      const confirm = getPortalElement(fixture.elements, "confirm")
      const disconnect = getPortalElement(fixture.elements, "disconnect")
      const disconnectForm = getPortalElement(fixture.elements, "disconnectForm")
      const errorMessage = getPortalElement(fixture.elements, "errorMessage")
      const form = getPortalElement(fixture.elements, "form")
      const input = getPortalElement(fixture.elements, "input")
      const reconnect = getPortalElement(fixture.elements, "reconnect")
      runPortalClient(fixture, async (_path, options) =>
        options.method === "DELETE" ? new Promise(() => {}) : response(200, activeConnection()),
      )
      input.value = validToken
      await form.dispatch("submit", { preventDefault() {} })
      await vi.runAllTicks()
      await disconnect.dispatch("click")

      const pendingDisconnect = disconnectForm.dispatch("submit", {
        preventDefault() {},
        submitter: confirm,
      })
      await vi.advanceTimersByTimeAsync(10_000)
      await pendingDisconnect

      expect(errorMessage.textContent).toContain("연결 해제가 이미 적용되었을 수 있습니다")
      expect(reconnect.hidden).toBe(false)
      expect(reconnect.focusCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("focuses OAuth recovery after a definite missing-connection response to disconnect", async () => {
    const fixture = createPortalBrowserFixture()
    const confirm = getPortalElement(fixture.elements, "confirm")
    const disconnect = getPortalElement(fixture.elements, "disconnect")
    const disconnectForm = getPortalElement(fixture.elements, "disconnectForm")
    const form = getPortalElement(fixture.elements, "form")
    const input = getPortalElement(fixture.elements, "input")
    const reconnect = getPortalElement(fixture.elements, "reconnect")
    runPortalClient(fixture, async (_path, options) =>
      options.method === "DELETE" ? response(404) : response(200, activeConnection()),
    )
    input.value = validToken
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    await disconnect.dispatch("click")

    await disconnectForm.dispatch("submit", { preventDefault() {}, submitter: confirm })

    expect(reconnect.hidden).toBe(false)
    expect(reconnect.focusCount).toBe(2)
    expect(input.focusCount).toBe(0)
    expect(fixture.focus.activeElement).toBe(reconnect)
  })

  it.each([
    [401, "input"],
    [429, "disconnect"],
  ] as const)(
    "settles disconnect HTTP %i on the correct stable control",
    async (disconnectStatus, focusTarget) => {
      const fixture = createPortalBrowserFixture()
      const confirm = getPortalElement(fixture.elements, "confirm")
      const disconnect = getPortalElement(fixture.elements, "disconnect")
      const disconnectForm = getPortalElement(fixture.elements, "disconnectForm")
      const form = getPortalElement(fixture.elements, "form")
      const input = getPortalElement(fixture.elements, "input")
      runPortalClient(fixture, async (_path, options) =>
        options.method === "DELETE"
          ? response(disconnectStatus)
          : response(200, activeConnection()),
      )
      input.value = validToken
      await form.dispatch("submit", { preventDefault() {} })
      await new Promise<void>((resolve) => setImmediate(resolve))
      await disconnect.dispatch("click")

      await disconnectForm.dispatch("submit", {
        preventDefault() {},
        submitter: confirm,
      })

      expect(fixture.focus.activeElement).toBe(getPortalElement(fixture.elements, focusTarget))
    },
  )
})
