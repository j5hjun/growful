/// <reference lib="dom" />

import type { SmartThingsScope } from "../oauth/smartthings-scope.js"
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
  const scopeLabels: Readonly<Record<string, string>> = {
    "r:devices:$": "SmartThings에서 선택한 디바이스 정보와 상태 읽기",
    "r:devices:*": "연결된 모든 디바이스 정보와 상태 읽기",
    "r:hubs:*": "연결에 허용된 허브 정보 읽기",
    "r:locations:*": "연결에 허용된 모든 위치 정보 읽기",
    "r:rules:*": "연결에 허용된 규칙 읽기",
    "r:scenes:*": "연결에 허용된 장면 정보 읽기",
    "w:devices:$": "SmartThings에서 선택한 디바이스 이름 변경·삭제",
    "w:devices:*": "연결된 모든 디바이스 이름 변경·삭제",
    "w:locations:*": "SmartThings 위치 만들기·정보 변경·삭제",
    "w:rules:*": "연결에 허용된 규칙 만들기·수정·삭제",
    "x:devices:$": "SmartThings에서 선택한 디바이스 명령 실행",
    "x:devices:*": "연결된 모든 디바이스 명령 실행",
    "x:locations:*": "연결에 허용된 위치 모드 변경 실행",
    "x:scenes:*": "연결에 허용된 장면 실행",
  } satisfies Readonly<Record<SmartThingsScope, string>>

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
      const knownLabel = scopeLabels[scope]
      const label = document.createElement("span")
      const code = document.createElement("code")
      label.setAttribute("class", "scope-label")
      label.textContent = knownLabel ?? "알 수 없는 SmartThings 권한"
      code.setAttribute("class", "scope-code")
      code.setAttribute("aria-label", `원문 권한 코드: ${scope}`)
      code.textContent = scope
      item.setAttribute("data-scope-kind", knownLabel === undefined ? "unknown" : "known")
      item.replaceChildren(label, code)
      return item
    })
    elements.scopeList.replaceChildren(...items)
    elements.supportReference.textContent = connection.supportReference
    elements.statusActive.hidden = true
    elements.statusBlocked.hidden = true
    elements.statusReauthorization.hidden = true
    elements.blockedNotice.hidden = true
    elements.reauthorizationNotice.hidden = true
    elements.rotateTokenButton.hidden = false
    elements.blockReason.textContent = ""
    elements.blockedAt.textContent = ""
    elements.blockedAt.removeAttribute("datetime")
    if (connection.serviceAccess.status === "blocked") {
      elements.statusBlocked.hidden = false
      elements.blockedNotice.hidden = false
      elements.blockReason.textContent = contracts.blockReasonMessage(
        connection.serviceAccess.reason,
      )
      elements.blockedAt.textContent = formatDate(connection.serviceAccess.blockedAt)
      elements.blockedAt.setAttribute("datetime", connection.serviceAccess.blockedAt)
    } else if (connection.authorizationHealth.status === "reauthorization_required") {
      elements.statusReauthorization.hidden = false
      elements.reauthorizationNotice.hidden = false
      elements.rotateTokenButton.hidden = true
    } else {
      elements.statusActive.hidden = false
    }
    elements.tokenForm.hidden = false
    elements.statusSection.hidden = false
    setActionState("connected")
    elements.statusSection.focus()
  }

  return { clearMessages, renderStatus, setActionState, showError, showFeedback }
}

export type PortalView = ReturnType<typeof createPortalView>
