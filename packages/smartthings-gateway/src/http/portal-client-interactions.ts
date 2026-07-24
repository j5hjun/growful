/// <reference lib="dom" />

import type { PortalContracts, PortalMethod } from "./portal-client-contracts.js"
import type { PortalElements } from "./portal-client-elements.js"
import type { PortalView } from "./portal-client-view.js"

export function bindPortalInteractions(
  elements: PortalElements,
  contracts: PortalContracts,
  view: PortalView,
): void {
  const requestTimeoutMs = 10_000
  const disconnectCancel = document.querySelector<HTMLButtonElement>("[data-disconnect-cancel]")
  let growfulToken = ""
  let disconnectPending = false
  let disconnectSettledFocus: HTMLElement | null = null
  let recoveryRequired = false
  let rotationPending = false
  let rotationSubmitted = false
  let tokenGeneration = 0

  class PortalRequestTimeoutError extends Error {
    override readonly name = "PortalRequestTimeoutError"
  }

  function confirmRotatedTokenDiscard(): boolean {
    if (
      elements.rotatedTokenSection.hidden ||
      elements.rotatedTokenOutput.textContent === "" ||
      elements.rotatedTokenSection.hasAttribute("data-token-safety-acknowledged")
    ) {
      return true
    }
    const discard = window.confirm(
      "새 Growful 토큰을 복사하거나 안전한 곳에 저장했는지 아직 확인되지 않았습니다. 이 화면을 떠나면 토큰을 다시 볼 수 없습니다. 그래도 계속할까요?",
    )
    if (!discard) elements.rotatedTokenOutput.focus()
    return discard
  }

  function clearRotatedToken(): void {
    elements.rotatedTokenSection.dispatchEvent(new Event("token-safety-reset"))
    elements.rotatedTokenOutput.textContent = ""
    elements.rotatedTokenFeedback.hidden = true
    elements.rotatedTokenError.hidden = true
    elements.rotatedTokenSection.hidden = true
  }

  async function request(path: string, method: PortalMethod): Promise<unknown> {
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new PortalRequestTimeoutError("Portal request timed out"))
        controller.abort()
      }, requestTimeoutMs)
    })
    const response = (async () => {
      const result = await fetch(path, {
        method,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { authorization: `Bearer ${growfulToken}` },
        signal: controller.signal,
      })
      if (!result.ok) throw new contracts.PortalRequestError(result.status)
      return result.status === 204 ? null : result.json()
    })()
    try {
      return await Promise.race([response, timeout])
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }

  function resetToTokenEntry(message: string): void {
    tokenGeneration += 1
    recoveryRequired = false
    growfulToken = ""
    elements.tokenInput.value = ""
    clearRotatedToken()
    elements.supportReference.textContent = ""
    elements.tokenForm.hidden = false
    elements.statusSection.hidden = true
    view.showError(message)
    view.setActionState("error")
    elements.tokenInput.focus()
  }

  function resetToDisconnected(message: string): void {
    tokenGeneration += 1
    recoveryRequired = false
    growfulToken = ""
    elements.tokenInput.value = ""
    elements.statusSection.hidden = true
    clearRotatedToken()
    view.showError(message)
    view.setActionState("disconnected")
    elements.reconnectAction.focus()
  }

  type PortalOperation = "disconnect" | "read" | "rotate"

  function isUncertainMutationError(error: unknown): boolean {
    return (
      error instanceof PortalRequestTimeoutError ||
      !(error instanceof contracts.PortalRequestError) ||
      error.status >= 500
    )
  }

  function showUncertainMutationError(operation: Exclude<PortalOperation, "read">): void {
    const mutation =
      operation === "rotate"
        ? "토큰 교체가 이미 적용되었을 수 있습니다. 다시 교체하지 마세요."
        : "연결 해제가 이미 적용되었을 수 있습니다. 다시 해제하지 마세요."
    view.showError(
      `요청 결과를 확인할 수 없습니다. ${mutation} SmartThings 다시 연결을 사용해 안전하게 복구하세요.`,
    )
    tokenGeneration += 1
    recoveryRequired = true
    growfulToken = ""
    elements.tokenInput.value = ""
    clearRotatedToken()
    elements.supportReference.textContent = ""
    elements.tokenForm.hidden = false
    elements.statusSection.hidden = true
    view.setActionState("uncertain")
  }

  function handleRequestError(error: unknown, operation: PortalOperation): void {
    if (operation !== "read" && isUncertainMutationError(error)) {
      showUncertainMutationError(operation)
      return
    }
    if (error instanceof PortalRequestTimeoutError) {
      view.showError(
        "연결 상태 확인 시간이 초과되었습니다. 네트워크 연결을 확인한 뒤 다시 시도하세요.",
      )
      view.setActionState("error")
      return
    }
    if (!(error instanceof contracts.PortalRequestError)) {
      view.showError("네트워크 연결을 확인한 뒤 다시 시도하세요.")
      view.setActionState("error")
      return
    }
    switch (error.status) {
      case 401:
        resetToTokenEntry(
          "입력한 Growful 토큰이 올바르지 않거나 이미 교체되어 사용할 수 없습니다. 현재 유효한 토큰을 입력하세요.",
        )
        break
      case 404:
        resetToDisconnected("연결된 SmartThings 설치를 찾을 수 없습니다.")
        break
      case 503:
        view.showError(
          "Growful 관리 서비스를 일시적으로 사용할 수 없습니다. 연결은 삭제되지 않았습니다. 잠시 후 상태를 다시 확인하세요.",
        )
        view.setActionState("unavailable")
        break
      case 429:
        view.showError("요청이 너무 많습니다. 잠시 후 다시 확인하세요.")
        view.setActionState("error")
        break
      default:
        view.showError(
          error.status >= 400 && error.status < 500
            ? operation === "read"
              ? "연결 상태 확인 요청이 거부되었습니다. 입력한 정보와 권한을 확인하세요."
              : "요청이 거부되어 변경되지 않았습니다. 입력한 정보와 권한을 확인하세요."
            : "요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.",
        )
        view.setActionState("error")
    }
  }

  function setRotationPending(pending: boolean): void {
    const label = pending ? "Growful 토큰 교체 중…" : "Growful 토큰 교체"
    elements.rotateTokenButton.textContent = label
    elements.rotateTokenConfirm.textContent = pending ? "토큰 교체 중…" : "토큰 교체"
    elements.tokenInput.disabled = pending || recoveryRequired
    elements.tokenVisibility.disabled = pending || recoveryRequired
    elements.tokenSubmit.disabled = pending || recoveryRequired
    if (pending) {
      elements.statusSection.setAttribute("aria-busy", "true")
      elements.rotateTokenForm.setAttribute("aria-busy", "true")
      elements.rotateTokenButton.setAttribute("aria-busy", "true")
      elements.rotateTokenConfirm.setAttribute("aria-busy", "true")
      elements.tokenSubmit.setAttribute("aria-busy", "true")
      elements.rotateTokenButton.setAttribute("aria-label", "Growful 토큰 교체 중입니다")
      elements.rotateTokenConfirm.setAttribute("aria-label", "Growful 토큰 교체 중입니다")
    } else {
      elements.statusSection.removeAttribute("aria-busy")
      elements.rotateTokenForm.removeAttribute("aria-busy")
      elements.rotateTokenButton.removeAttribute("aria-busy")
      elements.rotateTokenConfirm.removeAttribute("aria-busy")
      elements.tokenSubmit.removeAttribute("aria-busy")
      elements.rotateTokenButton.removeAttribute("aria-label")
      elements.rotateTokenConfirm.removeAttribute("aria-label")
    }
  }

  function setDisconnectPending(pending: boolean): void {
    disconnectPending = pending
    elements.disconnectButton.textContent = pending ? "연결 해제 중…" : "연결 해제"
    elements.disconnectConfirm.textContent = pending ? "연결 해제 중…" : "연결 해제"
    elements.tokenInput.disabled = pending || recoveryRequired
    elements.tokenVisibility.disabled = pending || recoveryRequired
    elements.tokenSubmit.disabled = pending || recoveryRequired
    if (disconnectCancel !== null) disconnectCancel.disabled = pending
    if (pending) {
      elements.statusSection.setAttribute("aria-busy", "true")
      elements.disconnectDialog.setAttribute("aria-busy", "true")
      elements.disconnectForm.setAttribute("aria-busy", "true")
      elements.disconnectButton.setAttribute("aria-busy", "true")
      elements.disconnectConfirm.setAttribute("aria-busy", "true")
      elements.tokenSubmit.setAttribute("aria-busy", "true")
      elements.disconnectButton.setAttribute("aria-label", "연결 해제 중입니다")
      elements.disconnectConfirm.setAttribute("aria-label", "연결 해제 중입니다")
    } else {
      elements.statusSection.removeAttribute("aria-busy")
      elements.disconnectDialog.removeAttribute("aria-busy")
      elements.disconnectForm.removeAttribute("aria-busy")
      elements.disconnectButton.removeAttribute("aria-busy")
      elements.disconnectConfirm.removeAttribute("aria-busy")
      elements.tokenSubmit.removeAttribute("aria-busy")
      elements.disconnectButton.removeAttribute("aria-label")
      elements.disconnectConfirm.removeAttribute("aria-label")
    }
  }

  async function loadConnection(): Promise<void> {
    if (recoveryRequired) {
      elements.reconnectAction.focus()
      return
    }
    if (elements.rotateTokenButton.disabled) return
    const enteredToken = elements.tokenInput.value.trim()
    const missingToken = enteredToken === "" && growfulToken === ""
    const invalidToken = enteredToken !== "" && !elements.tokenInput.checkValidity()
    if (missingToken || invalidToken) {
      elements.tokenInput.setAttribute("aria-invalid", "true")
      elements.statusSection.hidden = true
      view.showError(
        "Growful 토큰 형식을 확인하세요. grw_st_로 시작하는 50자 토큰을 입력해야 합니다.",
      )
      view.setActionState("error")
      elements.tokenInput.focus()
      return
    }
    if (!confirmRotatedTokenDiscard()) return
    if (enteredToken !== "") growfulToken = enteredToken
    const requestGeneration = ++tokenGeneration
    const statusWasHidden = elements.statusSection.hidden
    elements.tokenInput.removeAttribute("aria-invalid")
    elements.statusSection.hidden = true
    view.clearMessages()
    view.setActionState("loading")
    elements.tokenForm.setAttribute("aria-busy", "true")
    try {
      const connection = await request("/connection", "GET")
      if (!contracts.isConnectionStatus(connection)) {
        throw new contracts.PortalRequestError(502)
      }
      if (requestGeneration !== tokenGeneration) return
      elements.tokenInput.value = ""
      clearRotatedToken()
      view.renderStatus(connection)
      view.showFeedback("연결 상태를 확인했습니다.")
    } catch (error) {
      if (!(error instanceof Error) && (typeof error !== "object" || error === null)) throw error
      if (requestGeneration !== tokenGeneration) return
      handleRequestError(error, "read")
      if (error instanceof contracts.PortalRequestError && error.status === 503) {
        elements.statusSection.hidden = statusWasHidden
      }
      if (enteredToken !== "" && growfulToken !== "") elements.tokenInput.value = enteredToken
    } finally {
      elements.tokenForm.removeAttribute("aria-busy")
    }
  }

  elements.tokenForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void loadConnection()
  })
  window.addEventListener("beforeunload", (event) => {
    if (!rotationPending && !disconnectPending) return
    event.preventDefault()
    event.returnValue = ""
  })
  elements.tokenVisibility.addEventListener("click", () => {
    const reveal = elements.tokenInput.type === "password"
    elements.tokenInput.type = reveal ? "text" : "password"
    elements.tokenVisibility.textContent = reveal ? "토큰 가리기" : "토큰 보기"
    elements.tokenVisibility.setAttribute("aria-pressed", String(reveal))
  })
  elements.forgetTokenButton.addEventListener("click", () => {
    if (!confirmRotatedTokenDiscard()) return
    tokenGeneration += 1
    growfulToken = ""
    elements.tokenInput.value = ""
    clearRotatedToken()
    elements.supportReference.textContent = ""
    elements.tokenInput.type = "password"
    elements.tokenVisibility.textContent = "토큰 보기"
    elements.tokenVisibility.setAttribute("aria-pressed", "false")
    elements.tokenForm.hidden = false
    elements.statusSection.hidden = true
    view.showFeedback("이 탭에서 Growful 토큰을 지웠습니다.")
    view.setActionState("initial")
    elements.tokenInput.focus()
  })
  elements.rotateTokenButton.addEventListener("click", () => {
    rotationSubmitted = false
    elements.rotateTokenDialog.showModal()
  })
  elements.rotateTokenDialog.addEventListener("close", () => {
    if (!rotationSubmitted) elements.rotateTokenButton.focus()
    rotationSubmitted = false
  })
  elements.rotateTokenForm.addEventListener("submit", async (event) => {
    if (event.submitter !== elements.rotateTokenConfirm) return
    event.preventDefault()
    rotationSubmitted = true
    const requestGeneration = tokenGeneration
    elements.rotateTokenButton.disabled = true
    elements.forgetTokenButton.disabled = true
    elements.disconnectButton.disabled = true
    elements.rotateTokenConfirm.disabled = true
    rotationPending = true
    setRotationPending(true)
    elements.rotateTokenDialog.close()
    elements.statusSection.focus()
    let settledFocus: HTMLElement | null = null
    try {
      const rotation = await request("/token/rotate", "POST")
      if (!contracts.isRotation(rotation)) throw new contracts.PortalRequestError(502)
      if (requestGeneration !== tokenGeneration) return
      growfulToken = rotation.growfulToken
      elements.rotatedTokenSection.dispatchEvent(new Event("token-safety-reset"))
      elements.rotatedTokenOutput.textContent = rotation.growfulToken
      elements.rotatedTokenFeedback.hidden = true
      elements.rotatedTokenError.hidden = true
      elements.rotatedTokenSection.hidden = false
      elements.statusSection.hidden = true
      view.clearMessages()
      elements.rotatedTokenOutput.focus()
    } catch (error) {
      if (requestGeneration !== tokenGeneration) return
      handleRequestError(error, "rotate")
      if (isUncertainMutationError(error)) {
        settledFocus = elements.reconnectAction
      } else if (
        error instanceof contracts.PortalRequestError &&
        (error.status === 401 || error.status === 404)
      ) {
        // The status-specific recovery helper already moved focus to its stable target.
      } else if (!elements.statusSection.hidden) {
        settledFocus = elements.rotateTokenButton
      }
    } finally {
      rotationPending = false
      setRotationPending(false)
      elements.rotateTokenButton.disabled = false
      elements.forgetTokenButton.disabled = false
      elements.disconnectButton.disabled = false
      elements.rotateTokenConfirm.disabled = false
      settledFocus?.focus()
    }
  })

  elements.returnStatusButton.addEventListener("click", () => {
    if (!confirmRotatedTokenDiscard()) return
    clearRotatedToken()
    elements.statusSection.hidden = false
    elements.statusSection.focus()
  })

  async function copySupportReference(): Promise<void> {
    try {
      await navigator.clipboard.writeText(elements.supportReference.textContent)
      view.showFeedback("지원 참조를 클립보드에 복사했습니다.")
    } catch {
      view.showError("자동 복사를 사용할 수 없습니다. 값을 직접 선택해 복사하세요.")
      elements.supportReference.focus()
      const selection = window.getSelection()
      if (selection !== null) {
        const range = document.createRange()
        range.selectNodeContents(elements.supportReference)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
  }

  elements.copySupportReferenceButton.addEventListener("click", async () => {
    await copySupportReference()
  })
  elements.disconnectButton.addEventListener("click", () => {
    if (recoveryRequired) {
      elements.reconnectAction.focus()
      return
    }
    disconnectSettledFocus = null
    elements.disconnectDialog.showModal()
  })
  elements.disconnectDialog.addEventListener("close", () => {
    if (disconnectPending) {
      elements.statusSection.focus()
      return
    }
    if (disconnectSettledFocus !== null) {
      disconnectSettledFocus.focus()
      disconnectSettledFocus = null
    } else if (elements.statusSection.hidden) {
      elements.tokenInput.focus()
    } else {
      elements.disconnectButton.focus()
    }
  })
  elements.disconnectDialog.addEventListener("cancel", (event) => {
    if (!disconnectPending) return
    event.preventDefault()
    elements.disconnectDialog.focus()
  })
  elements.disconnectForm.addEventListener("submit", async (event) => {
    if (disconnectPending) {
      event.preventDefault()
      elements.disconnectDialog.focus()
      return
    }
    if (event.submitter !== elements.disconnectConfirm) return
    event.preventDefault()
    tokenGeneration += 1
    elements.rotateTokenButton.disabled = true
    elements.forgetTokenButton.disabled = true
    elements.disconnectButton.disabled = true
    elements.disconnectConfirm.disabled = true
    setDisconnectPending(true)
    elements.disconnectDialog.focus()
    try {
      await request("/connection", "DELETE")
      recoveryRequired = false
      growfulToken = ""
      elements.tokenInput.value = ""
      clearRotatedToken()
      elements.supportReference.textContent = ""
      elements.statusSection.hidden = true
      elements.tokenForm.hidden = false
      view.setActionState("disconnected")
      view.showFeedback("Growful에 저장된 연결과 토큰을 삭제했습니다.")
      disconnectSettledFocus = elements.tokenInput
    } catch (error) {
      if (!(error instanceof Error) && (typeof error !== "object" || error === null)) throw error
      handleRequestError(error, "disconnect")
      disconnectSettledFocus =
        isUncertainMutationError(error) ||
        (error instanceof contracts.PortalRequestError && error.status === 404)
          ? elements.reconnectAction
          : elements.statusSection.hidden
            ? elements.tokenInput
            : elements.disconnectButton
    } finally {
      setDisconnectPending(false)
      elements.rotateTokenButton.disabled = false
      elements.forgetTokenButton.disabled = false
      elements.disconnectButton.disabled = false
      elements.disconnectConfirm.disabled = false
      const dialogWasOpen = elements.disconnectDialog.open
      elements.disconnectDialog.close()
      if (!dialogWasOpen && disconnectSettledFocus !== null) {
        disconnectSettledFocus.focus()
        disconnectSettledFocus = null
      }
    }
  })
}
