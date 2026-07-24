/// <reference lib="dom" />

import type { ConnectionStatus, PortalContracts } from "./portal-client-contracts.js"
import type { PortalElements } from "./portal-client-elements.js"

type PortalActionState =
  | "connected"
  | "disconnected"
  | "error"
  | "initial"
  | "loading"
  | "uncertain"
  | "unavailable"

export function createPortalView(elements: PortalElements, contracts: PortalContracts) {
  const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
  })

  function showFeedback(message: string): void {
    elements.errorBox.hidden = true
    elements.feedback.textContent = message
    elements.feedback.hidden = false
  }

  function showError(message: string): void {
    elements.feedback.hidden = true
    elements.errorMessage.textContent = message
    elements.errorBox.hidden = false
  }

  function clearMessages(): void {
    elements.feedback.hidden = true
    elements.errorBox.hidden = true
  }

  function setActionState(state: PortalActionState): void {
    const reconnect = state === "disconnected" || state === "uncertain"
    const uncertain = state === "uncertain"
    elements.reconnectAction.hidden = !reconnect
    elements.reconnectAction.setAttribute(
      "class",
      uncertain ? "action action-primary" : "action action-secondary",
    )
    elements.tokenInput.disabled = uncertain
    elements.tokenVisibility.disabled = uncertain
    elements.tokenSubmit.hidden = uncertain
    elements.tokenSubmit.disabled = state === "loading" || uncertain
    switch (state) {
      case "connected":
        elements.tokenSubmit.textContent = "상태 다시 확인"
        break
      case "disconnected":
        elements.tokenSubmit.textContent = "연결 상태 확인"
        elements.reconnectAction.textContent = "SmartThings 다시 연결"
        break
      case "error":
        elements.tokenSubmit.textContent = "다시 확인"
        break
      case "initial":
        elements.tokenSubmit.textContent = "연결 상태 확인"
        break
      case "loading":
        elements.tokenSubmit.textContent = "확인 중…"
        break
      case "uncertain":
        elements.tokenSubmit.textContent = "연결 상태 확인 불가"
        elements.reconnectAction.textContent = "SmartThings 다시 연결"
        break
      case "unavailable":
        elements.tokenSubmit.textContent = "상태 다시 확인"
        break
      default:
        state satisfies never
    }
  }

  function formatDate(value: string | null): string {
    if (value === null) return "아직 자동 갱신되지 않음"
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? "확인할 수 없음" : dateFormatter.format(date)
  }

  function renderStatus(connection: ConnectionStatus): void {
    elements.expiresAt.textContent = formatDate(connection.expiresAt)
    elements.expiresAt.setAttribute("datetime", connection.expiresAt)
    elements.refreshedAt.textContent = formatDate(connection.lastRefreshedAt)
    if (connection.lastRefreshedAt === null) {
      elements.refreshedAt.removeAttribute("datetime")
    } else {
      elements.refreshedAt.setAttribute("datetime", connection.lastRefreshedAt)
    }
    const items = connection.grantedScopes.map((scope) => {
      const item = document.createElement("li")
      item.textContent = scope
      return item
    })
    elements.scopeList.replaceChildren(...items)
    elements.supportReference.textContent = connection.supportReference
    switch (connection.serviceAccess.status) {
      case "active":
        elements.statusActive.hidden = false
        elements.statusBlocked.hidden = true
        elements.blockedNotice.hidden = true
        elements.blockReason.textContent = ""
        elements.blockedAt.textContent = ""
        elements.blockedAt.removeAttribute("datetime")
        break
      case "blocked":
        elements.statusActive.hidden = true
        elements.statusBlocked.hidden = false
        elements.blockedNotice.hidden = false
        elements.blockReason.textContent = contracts.blockReasonMessage(
          connection.serviceAccess.reason,
        )
        elements.blockedAt.textContent = formatDate(connection.serviceAccess.blockedAt)
        elements.blockedAt.setAttribute("datetime", connection.serviceAccess.blockedAt)
        break
      default:
        contracts.blockReasonMessage(connection.serviceAccess)
    }
    elements.tokenForm.hidden = false
    elements.statusSection.hidden = false
    setActionState("connected")
    elements.statusSection.focus()
  }

  return { clearMessages, renderStatus, setActionState, showError, showFeedback }
}

export type PortalView = ReturnType<typeof createPortalView>
