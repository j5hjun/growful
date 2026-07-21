/// <reference lib="dom" />

function initializePortal(): void {
  type ConnectionStatus = {
    readonly connected: true
    readonly expiresAt: string
    readonly grantedScopes: readonly string[]
    readonly lastRefreshedAt: string | null
  }
  type Rotation = { readonly growfulToken: string }
  type PortalMethod = "DELETE" | "GET" | "POST"
  type PortalResponse = {
    readonly connected?: unknown
    readonly expiresAt?: unknown
    readonly grantedScopes?: unknown
    readonly growfulToken?: unknown
    readonly lastRefreshedAt?: unknown
  }

  function getPortalElements() {
    const tokenForm = document.querySelector<HTMLFormElement>("[data-portal-token-form]")
    const tokenInput = document.querySelector<HTMLInputElement>("#growful-token")
    const tokenSubmit = document.querySelector<HTMLButtonElement>("[data-token-submit]")
    const tokenVisibility = document.querySelector<HTMLButtonElement>("[data-token-visibility]")
    const feedback = document.querySelector<HTMLElement>("[data-portal-feedback]")
    const errorBox = document.querySelector<HTMLElement>("[data-portal-error]")
    const errorMessage = document.querySelector<HTMLElement>("[data-portal-error-message]")
    const reconnectAction = document.querySelector<HTMLElement>("[data-reconnect]")
    const statusSection = document.querySelector<HTMLElement>("[data-portal-status]")
    const expiresAt = document.querySelector<HTMLTimeElement>("[data-expires-at]")
    const refreshedAt = document.querySelector<HTMLTimeElement>("[data-refreshed-at]")
    const scopeList = document.querySelector<HTMLUListElement>("[data-scope-list]")
    const forgetTokenButton = document.querySelector<HTMLButtonElement>("[data-forget-token]")
    const rotateTokenButton = document.querySelector<HTMLButtonElement>("[data-rotate-token]")
    const rotatedTokenSection = document.querySelector<HTMLElement>("[data-rotated-token-section]")
    const rotatedTokenOutput = document.querySelector<HTMLOutputElement>("[data-rotated-token]")
    const copyTokenButton = document.querySelector<HTMLButtonElement>("[data-copy-token]")
    const disconnectButton = document.querySelector<HTMLButtonElement>("[data-disconnect]")
    const disconnectDialog = document.querySelector<HTMLDialogElement>("[data-disconnect-dialog]")
    const disconnectForm = document.querySelector<HTMLFormElement>("[data-disconnect-form]")
    const disconnectConfirm = document.querySelector<HTMLButtonElement>("[data-disconnect-confirm]")

    if (
      tokenForm === null ||
      tokenInput === null ||
      tokenSubmit === null ||
      tokenVisibility === null ||
      feedback === null ||
      errorBox === null ||
      errorMessage === null ||
      reconnectAction === null ||
      statusSection === null ||
      expiresAt === null ||
      refreshedAt === null ||
      scopeList === null ||
      forgetTokenButton === null ||
      rotateTokenButton === null ||
      rotatedTokenSection === null ||
      rotatedTokenOutput === null ||
      copyTokenButton === null ||
      disconnectButton === null ||
      disconnectDialog === null ||
      disconnectForm === null ||
      disconnectConfirm === null
    ) {
      return null
    }
    return {
      copyTokenButton,
      disconnectButton,
      disconnectConfirm,
      disconnectDialog,
      disconnectForm,
      errorBox,
      errorMessage,
      expiresAt,
      feedback,
      forgetTokenButton,
      reconnectAction,
      refreshedAt,
      rotatedTokenOutput,
      rotatedTokenSection,
      rotateTokenButton,
      scopeList,
      statusSection,
      tokenForm,
      tokenInput,
      tokenSubmit,
      tokenVisibility,
    }
  }

  const elements = getPortalElements()
  if (elements === null) {
    return
  }
  const {
    copyTokenButton,
    disconnectButton,
    disconnectConfirm,
    disconnectDialog,
    disconnectForm,
    errorBox,
    errorMessage,
    expiresAt,
    feedback,
    forgetTokenButton,
    reconnectAction,
    refreshedAt,
    rotatedTokenOutput,
    rotatedTokenSection,
    rotateTokenButton,
    scopeList,
    statusSection,
    tokenForm,
    tokenInput,
    tokenSubmit,
    tokenVisibility,
  } = elements

  const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
  })
  let growfulToken = ""
  let tokenGeneration = 0

  class PortalRequestError extends Error {
    override readonly name = "PortalRequestError"

    constructor(readonly status: number) {
      super("Portal request failed")
    }
  }

  function showFeedback(message: string): void {
    errorBox.hidden = true
    feedback.textContent = message
    feedback.hidden = false
  }

  function showError(message: string, canReconnect = false): void {
    feedback.hidden = true
    errorMessage.textContent = message
    reconnectAction.hidden = !canReconnect
    errorBox.hidden = false
  }

  function formatDate(value: string | null): string {
    if (value === null) {
      return "아직 자동 갱신되지 않음"
    }
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? "확인할 수 없음" : dateFormatter.format(date)
  }

  function isPortalResponse(value: unknown): value is PortalResponse {
    return value !== null && typeof value === "object"
  }

  function isConnectionStatus(value: unknown): value is ConnectionStatus {
    return (
      isPortalResponse(value) &&
      value.connected === true &&
      typeof value.expiresAt === "string" &&
      (value.lastRefreshedAt === null || typeof value.lastRefreshedAt === "string") &&
      Array.isArray(value.grantedScopes) &&
      value.grantedScopes.every((scope: unknown) => typeof scope === "string")
    )
  }

  function isRotation(value: unknown): value is Rotation {
    return (
      isPortalResponse(value) &&
      typeof value.growfulToken === "string" &&
      /^grw_st_[A-Za-z0-9_-]{43}$/.test(value.growfulToken)
    )
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
    if (!response.ok) {
      throw new PortalRequestError(response.status)
    }
    return response.status === 204 ? null : response.json()
  }

  function renderStatus(connection: ConnectionStatus): void {
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

  function resetToTokenEntry(message: string): void {
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

  function handleRequestError(error: unknown): void {
    if (error instanceof PortalRequestError && error.status === 401) {
      resetToTokenEntry("새 Growful 토큰을 붙여 넣으세요.")
      return
    }
    showError("요청을 완료하지 못했습니다. 네트워크 상태를 확인하고 다시 시도하세요.")
  }

  async function loadConnection(): Promise<void> {
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
      await navigator.clipboard.writeText(rotatedTokenOutput.textContent)
      showFeedback("새 Growful 토큰을 클립보드에 복사했습니다.")
    } catch {
      // no-excuse-ok: catch — clipboard failures are converted into actionable UI feedback.
      showError("자동 복사를 사용할 수 없습니다. 토큰을 직접 선택해 복사하세요.")
    }
  })

  disconnectButton.addEventListener("click", () => disconnectDialog.showModal())
  disconnectDialog.addEventListener("close", () => {
    ;(statusSection.hidden ? tokenInput : disconnectButton).focus()
  })

  disconnectForm.addEventListener("submit", async (event) => {
    if ((event as SubmitEvent).submitter !== disconnectConfirm) return
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
}

export const portalClientScript = `(${initializePortal.toString()})()`
