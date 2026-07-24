export type ConnectionStatus = {
  readonly authorizationHealth: AuthorizationHealth
  readonly connected: true
  readonly expiresAt: string
  readonly grantedScopes: readonly string[]
  readonly lastRefreshedAt: string | null
  readonly serviceAccess: ServiceAccess
  readonly supportReference: string
}

export type AuthorizationHealth =
  | { readonly status: "active" }
  | { readonly status: "reauthorization_required" }
export type BlockReason = "quota_abuse" | "security_incident" | "terms_violation"
export type ServiceAccess =
  | { readonly status: "active" }
  | {
      readonly blockedAt: string
      readonly reason: BlockReason
      readonly status: "blocked"
    }
export type Rotation = { readonly growfulToken: string }
export type PortalMethod = "DELETE" | "GET" | "POST"

type PortalResponse = {
  readonly authorizationHealth?: unknown
  readonly connected?: unknown
  readonly blockedAt?: unknown
  readonly expiresAt?: unknown
  readonly grantedScopes?: unknown
  readonly growfulToken?: unknown
  readonly lastRefreshedAt?: unknown
  readonly reason?: unknown
  readonly serviceAccess?: unknown
  readonly status?: unknown
  readonly supportReference?: unknown
}

export function createPortalContracts() {
  class PortalRequestError extends Error {
    override readonly name = "PortalRequestError"

    constructor(readonly status: number) {
      super("Portal request failed")
    }
  }

  function isPortalResponse(value: unknown): value is PortalResponse {
    return value !== null && typeof value === "object"
  }

  function assertNever(value: never): never {
    throw new TypeError(`Unexpected portal variant: ${String(value)}`)
  }

  function isServiceAccess(value: unknown): value is ServiceAccess {
    if (!isPortalResponse(value)) return false
    switch (value.status) {
      case "active":
        return true
      case "blocked":
        if (typeof value.blockedAt !== "string") return false
        switch (value.reason) {
          case "quota_abuse":
          case "security_incident":
          case "terms_violation":
            return true
          default:
            return false
        }
      default:
        return false
    }
  }

  function isAuthorizationHealth(value: unknown): value is AuthorizationHealth {
    if (!isPortalResponse(value)) return false
    return value.status === "active" || value.status === "reauthorization_required"
  }

  function isGrantedScope(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.length >= 1 &&
      value.length <= 512 &&
      /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(value)
    )
  }

  function isConnectionStatus(value: unknown): value is ConnectionStatus {
    return (
      isPortalResponse(value) &&
      isAuthorizationHealth(value.authorizationHealth) &&
      value.connected === true &&
      typeof value.expiresAt === "string" &&
      (value.lastRefreshedAt === null || typeof value.lastRefreshedAt === "string") &&
      Array.isArray(value.grantedScopes) &&
      value.grantedScopes.length >= 1 &&
      value.grantedScopes.every(isGrantedScope) &&
      new Set(value.grantedScopes).size === value.grantedScopes.length &&
      isServiceAccess(value.serviceAccess) &&
      typeof value.supportReference === "string" &&
      /^[a-f0-9]{64}$/.test(value.supportReference)
    )
  }

  function isRotation(value: unknown): value is Rotation {
    return (
      isPortalResponse(value) &&
      typeof value.growfulToken === "string" &&
      /^grw_st_[A-Za-z0-9_-]{43}$/.test(value.growfulToken)
    )
  }

  function blockReasonMessage(reason: BlockReason): string {
    switch (reason) {
      case "quota_abuse":
        return "반복적인 요청 한도 초과를 운영자가 확인해 이 연결의 Gateway API 중계 접근을 제한했습니다."
      case "security_incident":
        return "연결에서 보안 위험 신호가 확인되어 이 연결의 Gateway API 중계 접근을 제한했습니다."
      case "terms_violation":
        return "서비스 이용 조건 위반 검토로 이 연결의 Gateway API 중계 접근을 제한했습니다."
      default:
        return assertNever(reason)
    }
  }

  return { PortalRequestError, blockReasonMessage, isConnectionStatus, isRotation }
}

export type PortalContracts = ReturnType<typeof createPortalContracts>
