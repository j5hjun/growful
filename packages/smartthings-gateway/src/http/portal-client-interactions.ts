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
  let tokenGeneration = 0

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
    elements.rotatedTokenOutput.textContent = ""
    elements.supportReference.textContent = ""
    elements.tokenForm.hidden = false
    elements.statusSection.hidden = true
    elements.rotatedTokenSection.hidden = true
    view.showError(message)
    view.setActionState("error")
    elements.tokenInput.focus()
  }

  function resetToDisconnected(message: string): void {
    tokenGeneration += 1
    growfulToken = ""
    elements.tokenInput.value = ""
    elements.statusSection.hidden = true
    elements.rotatedTokenSection.hidden = true
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
        resetToTokenEntry("토큰이 교체되었거나 만료되었습니다. 새 Growful 토큰을 입력하세요.")
        break
      case 404:
      case 503:
        resetToDisconnected("연결된 SmartThings 설치를 찾을 수 없습니다.")
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
    if (enteredToken !== "") growfulToken = enteredToken
    const requestGeneration = ++tokenGeneration
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
      view.renderStatus(connection)
      view.showFeedback("연결 상태를 확인했습니다.")
    } catch (error) {
      if (!(error instanceof Error) && (typeof error !== "object" || error === null)) throw error
      if (requestGeneration !== tokenGeneration) return
      handleRequestError(error)
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
    tokenGeneration += 1
    growfulToken = ""
    elements.tokenInput.value = ""
    elements.rotatedTokenOutput.textContent = ""
    elements.supportReference.textContent = ""
    elements.tokenInput.type = "password"
    elements.tokenVisibility.textContent = "토큰 보기"
    elements.tokenVisibility.setAttribute("aria-pressed", "false")
    elements.tokenForm.hidden = false
    elements.statusSection.hidden = true
    elements.rotatedTokenSection.hidden = true
    view.showFeedback("이 탭에서 Growful 토큰을 지웠습니다.")
    view.setActionState("initial")
    elements.tokenInput.focus()
  })
  elements.rotateTokenButton.addEventListener("click", async () => {
    const requestGeneration = tokenGeneration
    elements.rotateTokenButton.disabled = true
    elements.forgetTokenButton.disabled = true
    elements.disconnectButton.disabled = true
    try {
      const rotation = await request("/token/rotate", "POST")
      if (!contracts.isRotation(rotation)) throw new contracts.PortalRequestError(502)
      if (requestGeneration !== tokenGeneration) return
      growfulToken = rotation.growfulToken
      elements.rotatedTokenOutput.textContent = rotation.growfulToken
      elements.rotatedTokenSection.hidden = false
      view.showFeedback("Growful 토큰을 교체했습니다. 이전\u00a0토큰은 더 이상 사용할 수 없습니다.")
      elements.rotatedTokenOutput.focus()
    } catch (error) {
      if (requestGeneration !== tokenGeneration) return
      handleRequestError(error)
    } finally {
      elements.rotateTokenButton.disabled = false
      elements.forgetTokenButton.disabled = false
      elements.disconnectButton.disabled = false
    }
  })

  async function copyToClipboard(value: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      view.showFeedback(successMessage)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      view.showError("자동 복사를 사용할 수 없습니다. 값을 직접 선택해 복사하세요.")
    }
  }

  elements.copyTokenButton.addEventListener("click", async () => {
    await copyToClipboard(
      elements.rotatedTokenOutput.textContent,
      "새 Growful 토큰을 클립보드에 복사했습니다.",
    )
  })
  elements.copySupportReferenceButton.addEventListener("click", async () => {
    await copyToClipboard(
      elements.supportReference.textContent,
      "지원 참조를 클립보드에 복사했습니다.",
    )
  })
  elements.disconnectButton.addEventListener("click", () => elements.disconnectDialog.showModal())
  elements.disconnectDialog.addEventListener("close", () => {
    if (!elements.reconnectAction.hidden) {
      elements.reconnectAction.focus()
    } else {
      ;(elements.statusSection.hidden ? elements.tokenInput : elements.disconnectButton).focus()
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
      elements.rotatedTokenOutput.textContent = ""
      elements.supportReference.textContent = ""
      elements.statusSection.hidden = true
      elements.rotatedTokenSection.hidden = true
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
