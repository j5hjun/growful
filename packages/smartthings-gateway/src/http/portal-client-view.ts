/// <reference lib="dom" />

import type { ConnectionStatus, PortalContracts } from "./portal-client-contracts.js"
import type { PortalElements } from "./portal-client-elements.js"

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

  function showError(message: string, canReconnect = false): void {
    elements.feedback.hidden = true
    elements.errorMessage.textContent = message
    elements.reconnectAction.hidden = !canReconnect
    elements.errorBox.hidden = false
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
    elements.tokenForm.hidden = true
    elements.statusSection.hidden = false
    elements.statusSection.focus()
  }

  return { renderStatus, showError, showFeedback }
}

export type PortalView = ReturnType<typeof createPortalView>
