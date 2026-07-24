/// <reference lib="dom" />

import type { PortalContracts, PortalMethod } from "./portal-client-contracts.js"
import type { PortalElements } from "./portal-client-elements.js"
import type { PortalView } from "./portal-client-view.js"

export function bindPortalInteractions(
  elements: PortalElements,
  contracts: PortalContracts,
  view: PortalView,
): void {
  let growfulToken = ""
  let rotationSubmitted = false
  let tokenGeneration = 0

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
    const response = await fetch(path, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { authorization: `Bearer ${growfulToken}` },
    })
    if (!response.ok) throw new contracts.PortalRequestError(response.status)
    return response.status === 204 ? null : response.json()
  }

  function resetToTokenEntry(message: string): void {
    tokenGeneration += 1
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
    growfulToken = ""
    elements.tokenInput.value = ""
    elements.statusSection.hidden = true
    clearRotatedToken()
    view.showError(message)
    view.setActionState("disconnected")
    elements.reconnectAction.focus()
  }

  function handleRequestError(error: unknown): void {
    if (!(error instanceof contracts.PortalRequestError)) {
      view.showError("네트워크 연결을 확인한 뒤 다시 시도하세요.")
      view.setActionState("error")
      return
    }
    switch (error.status) {
      case 401:
        resetToTokenEntry(
          "입력한 Growful 토큰이 올바르지 않거나 이미 교체 또는 회수되었습니다. 현재 유효한 토큰을 입력하세요.",
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
        view.showError("요청을 완료하지 못했습니다. 잠시 후 다시 시도하세요.")
        view.setActionState("error")
    }
  }

  async function loadConnection(): Promise<void> {
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
      handleRequestError(error)
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
  elements.tokenVisibility.addEventListener("click", () => {
    const reveal = elements.tokenInput.type === "password"
    elements.tokenInput.type = reveal ? "text" : "password"
    elements.tokenVisibility.textContent = reveal ? "토큰 가리기" : "토큰 보기"
    elements.tokenVisibility.setAttribute("aria-pressed", String(reveal))
    elements.tokenInput.focus()
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
    elements.rotateTokenDialog.close()
    const requestGeneration = tokenGeneration
    elements.rotateTokenButton.disabled = true
    elements.forgetTokenButton.disabled = true
    elements.disconnectButton.disabled = true
    elements.rotateTokenConfirm.disabled = true
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
      handleRequestError(error)
      if (!elements.statusSection.hidden) elements.rotateTokenButton.focus()
    } finally {
      elements.rotateTokenButton.disabled = false
      elements.forgetTokenButton.disabled = false
      elements.disconnectButton.disabled = false
      elements.rotateTokenConfirm.disabled = false
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
    } catch (error) {
      if (!(error instanceof Error)) throw error
      view.showError("자동 복사를 사용할 수 없습니다. 값을 직접 선택해 복사하세요.")
    }
  }

  elements.copySupportReferenceButton.addEventListener("click", async () => {
    await copySupportReference()
  })
  elements.disconnectButton.addEventListener("click", () => elements.disconnectDialog.showModal())
  elements.disconnectDialog.addEventListener("close", () => {
    if (elements.statusSection.hidden) {
      elements.tokenInput.focus()
    } else {
      elements.disconnectButton.focus()
    }
  })
  elements.disconnectForm.addEventListener("submit", async (event) => {
    if (event.submitter !== elements.disconnectConfirm) return
    event.preventDefault()
    tokenGeneration += 1
    elements.rotateTokenButton.disabled = true
    elements.forgetTokenButton.disabled = true
    elements.disconnectButton.disabled = true
    elements.disconnectConfirm.disabled = true
    try {
      await request("/connection", "DELETE")
      growfulToken = ""
      elements.tokenInput.value = ""
      clearRotatedToken()
      elements.supportReference.textContent = ""
      elements.statusSection.hidden = true
      elements.tokenForm.hidden = false
      view.setActionState("disconnected")
      elements.disconnectDialog.close()
      view.showFeedback("Growful에 저장된 연결과 토큰을 삭제했습니다.")
    } catch (error) {
      if (!(error instanceof Error) && (typeof error !== "object" || error === null)) throw error
      elements.disconnectDialog.close()
      handleRequestError(error)
    } finally {
      elements.rotateTokenButton.disabled = false
      elements.forgetTokenButton.disabled = false
      elements.disconnectButton.disabled = false
      elements.disconnectConfirm.disabled = false
    }
  })
}
