export const portalClientScript = String.raw`(() => {
  "use strict"

  const tokenForm = document.querySelector("[data-portal-token-form]")
  const tokenInput = document.getElementById("growful-token")
  const tokenSubmit = document.querySelector("[data-token-submit]")
  const tokenVisibility = document.querySelector("[data-token-visibility]")
  const feedback = document.querySelector("[data-portal-feedback]")
  const errorBox = document.querySelector("[data-portal-error]")
  const errorMessage = document.querySelector("[data-portal-error-message]")
  const reconnectAction = document.querySelector("[data-reconnect]")
  const statusSection = document.querySelector("[data-portal-status]")
  const expiresAt = document.querySelector("[data-expires-at]")
  const refreshedAt = document.querySelector("[data-refreshed-at]")
  const scopeList = document.querySelector("[data-scope-list]")
  const forgetTokenButton = document.querySelector("[data-forget-token]")
  const rotateTokenButton = document.querySelector("[data-rotate-token]")
  const rotatedTokenSection = document.querySelector("[data-rotated-token-section]")
  const rotatedTokenOutput = document.querySelector("[data-rotated-token]")
  const copyTokenButton = document.querySelector("[data-copy-token]")
  const disconnectButton = document.querySelector("[data-disconnect]")
  const disconnectDialog = document.querySelector("[data-disconnect-dialog]")
  const disconnectForm = document.querySelector("[data-disconnect-form]")
  const disconnectConfirm = document.querySelector("[data-disconnect-confirm]")

  if (
    tokenForm === null || tokenInput === null || tokenSubmit === null ||
    tokenVisibility === null || feedback === null || errorBox === null || errorMessage === null ||
    reconnectAction === null ||
    statusSection === null || expiresAt === null || refreshedAt === null ||
    scopeList === null || forgetTokenButton === null || rotateTokenButton === null ||
    rotatedTokenSection === null || rotatedTokenOutput === null || copyTokenButton === null ||
    disconnectButton === null || disconnectDialog === null || disconnectForm === null ||
    disconnectConfirm === null
  ) {
    return
  }

  const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
  })
  let growfulToken = "", tokenGeneration = 0

  class PortalRequestError extends Error {
    constructor(status) {
      super("Portal request failed")
      this.name = "PortalRequestError"
      this.status = status
    }
  }

  function showFeedback(message) {
    errorBox.hidden = true
    feedback.textContent = message
    feedback.hidden = false
  }

  function showError(message, canReconnect = false) {
    feedback.hidden = true
    errorMessage.textContent = message
    reconnectAction.hidden = !canReconnect
    errorBox.hidden = false
  }

  function formatDate(value) {
    if (value === null) {
      return "아직 자동 갱신되지 않음"
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? "확인할 수 없음" : dateFormatter.format(date)
  }

  function isConnectionStatus(value) {
    return value !== null && typeof value === "object" && value.connected === true &&
      typeof value.expiresAt === "string" &&
      (value.lastRefreshedAt === null || typeof value.lastRefreshedAt === "string") &&
      Array.isArray(value.grantedScopes) &&
      value.grantedScopes.every((scope) => typeof scope === "string")
  }

  function isRotation(value) {
    return value !== null && typeof value === "object" &&
      typeof value.growfulToken === "string" &&
      /^grw_st_[A-Za-z0-9_-]{43}$/.test(value.growfulToken)
  }

  async function request(path, method) {
    const response = await fetch(path, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { authorization: "Bearer " + growfulToken },
    })
    if (!response.ok) {
      throw new PortalRequestError(response.status)
    }
    return response.status === 204 ? null : response.json()
  }

  function renderStatus(connection) {
    expiresAt.textContent = formatDate(connection.expiresAt)
    expiresAt.setAttribute("datetime", connection.expiresAt)
    refreshedAt.textContent = formatDate(connection.lastRefreshedAt)
    if (connection.lastRefreshedAt === null) {
      refreshedAt.removeAttribute("datetime")
    } else {
      refreshedAt.setAttribute("datetime", connection.lastRefreshedAt)
    }
    const items = connection.grantedScopes.map((scope) => {
      const item = document.createElement("li")
      item.textContent = scope
      return item
    })
    scopeList.replaceChildren(...items)
    tokenForm.hidden = true
    statusSection.hidden = false
  }

  function resetToTokenEntry(message) {
    tokenGeneration += 1
    growfulToken = ""
    tokenInput.value = ""
    rotatedTokenOutput.textContent = ""
    tokenForm.hidden = false
    statusSection.hidden = true
    rotatedTokenSection.hidden = true
    showError(message, true)
    tokenInput.focus()
  }

  function handleRequestError(error) {
    if (error instanceof PortalRequestError && error.status === 401) {
      resetToTokenEntry("새 Growful 토큰을 붙여 넣으세요.")
      return
    }
    showError("요청을 완료하지 못했습니다. 네트워크 상태를 확인하고 다시 시도하세요.")
  }

  async function loadConnection() {
    if (!tokenInput.checkValidity()) {
      tokenInput.reportValidity()
      return
    }
    growfulToken = tokenInput.value.trim()
    const requestGeneration = ++tokenGeneration
    tokenSubmit.disabled = true
    tokenForm.setAttribute("aria-busy", "true")
    try {
      const connection = await request("/connection", "GET")
      if (!isConnectionStatus(connection)) {
        throw new PortalRequestError(502)
      }
      if (requestGeneration !== tokenGeneration) return
      tokenInput.value = ""
      renderStatus(connection)
      showFeedback("연결 상태를 확인했습니다.")
    } catch (error) {
      if (requestGeneration !== tokenGeneration) return
      handleRequestError(error)
      if (growfulToken !== "") {
        tokenInput.value = growfulToken
      }
    } finally {
      tokenSubmit.disabled = false
      tokenForm.removeAttribute("aria-busy")
    }
  }

  tokenForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void loadConnection()
  })

  tokenVisibility.addEventListener("click", () => {
    const reveal = tokenInput.type === "password"
    tokenInput.type = reveal ? "text" : "password"
    tokenVisibility.textContent = reveal ? "토큰 가리기" : "토큰 보기"
    tokenVisibility.setAttribute("aria-pressed", String(reveal))
    tokenInput.focus()
  })

  forgetTokenButton.addEventListener("click", () => {
    tokenGeneration += 1
    growfulToken = ""
    tokenInput.value = ""
    rotatedTokenOutput.textContent = ""
    tokenInput.type = "password"
    tokenVisibility.textContent = "토큰 보기"
    tokenVisibility.setAttribute("aria-pressed", "false")
    tokenForm.hidden = false
    statusSection.hidden = true
    rotatedTokenSection.hidden = true
    showFeedback("이 탭에서 Growful 토큰을 지웠습니다.")
    tokenInput.focus()
  })

  rotateTokenButton.addEventListener("click", async () => {
    const requestGeneration = tokenGeneration
    rotateTokenButton.disabled = true
    forgetTokenButton.disabled = true
    disconnectButton.disabled = true
    try {
      const rotation = await request("/token/rotate", "POST")
      if (!isRotation(rotation)) {
        throw new PortalRequestError(502)
      }
      if (requestGeneration !== tokenGeneration) return
      growfulToken = rotation.growfulToken
      rotatedTokenOutput.textContent = rotation.growfulToken
      rotatedTokenSection.hidden = false
      showFeedback("Growful 토큰을 교체했습니다. 이전\u00a0토큰은 더 이상 사용할 수 없습니다.")
      rotatedTokenOutput.focus()
    } catch (error) {
      if (requestGeneration !== tokenGeneration) return
      handleRequestError(error)
    } finally {
      rotateTokenButton.disabled = false
      forgetTokenButton.disabled = false
      disconnectButton.disabled = false
    }
  })

  copyTokenButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(rotatedTokenOutput.textContent || "")
      showFeedback("새 Growful 토큰을 클립보드에 복사했습니다.")
    } catch (error) {
      if (error instanceof Error) {
        showError("자동 복사를 사용할 수 없습니다. 토큰을 직접 선택해 복사하세요.")
      }
    }
  })

  disconnectButton.addEventListener("click", () => disconnectDialog.showModal())
  disconnectDialog.addEventListener("close", () => {
    ;(statusSection.hidden ? tokenInput : disconnectButton).focus()
  })

  disconnectForm.addEventListener("submit", async (event) => {
    if (event.submitter !== disconnectConfirm) return
    event.preventDefault()
    tokenGeneration += 1
    rotateTokenButton.disabled = true
    forgetTokenButton.disabled = true
    disconnectButton.disabled = true
    disconnectConfirm.disabled = true
    try {
      await request("/connection", "DELETE")
      growfulToken = ""
      tokenInput.value = ""
      rotatedTokenOutput.textContent = ""
      statusSection.hidden = true
      rotatedTokenSection.hidden = true
      tokenForm.hidden = false
      disconnectDialog.close()
      showFeedback("Growful에 저장된 연결과 토큰을 삭제했습니다.")
    } catch (error) {
      disconnectDialog.close()
      handleRequestError(error)
    } finally {
      rotateTokenButton.disabled = false
      forgetTokenButton.disabled = false
      disconnectButton.disabled = false
      disconnectConfirm.disabled = false
    }
  })
})()`
