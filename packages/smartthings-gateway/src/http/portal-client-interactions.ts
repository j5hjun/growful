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
    view.showError(message, true)
    elements.tokenInput.focus()
  }

  function handleRequestError(error: unknown): void {
    if (error instanceof contracts.PortalRequestError && error.status === 401) {
      resetToTokenEntry("새 Growful 토큰을 붙여 넣으세요.")
      return
    }
    view.showError("요청을 완료하지 못했습니다. 네트워크 상태를 확인하고 다시 시도하세요.")
  }

  async function loadConnection(): Promise<void> {
    if (!elements.tokenInput.checkValidity()) {
      elements.tokenInput.reportValidity()
      return
    }
    growfulToken = elements.tokenInput.value.trim()
    const requestGeneration = ++tokenGeneration
    elements.tokenSubmit.disabled = true
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
      if (requestGeneration !== tokenGeneration) return
      handleRequestError(error)
      if (growfulToken !== "") elements.tokenInput.value = growfulToken
    } finally {
      elements.tokenSubmit.disabled = false
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
    ;(elements.statusSection.hidden ? elements.tokenInput : elements.disconnectButton).focus()
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
      elements.disconnectDialog.close()
      view.showFeedback("Growful에 저장된 연결과 토큰을 삭제했습니다.")
    } catch (error) {
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
