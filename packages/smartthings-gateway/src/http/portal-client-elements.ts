/// <reference lib="dom" />

export function getPortalElements() {
  const tokenForm = document.querySelector<HTMLFormElement>("[data-portal-token-form]")
  const tokenInput = document.querySelector<HTMLInputElement>("#growful-token")
  const tokenSubmit = document.querySelector<HTMLButtonElement>("[data-token-submit]")
  const tokenVisibility = document.querySelector<HTMLButtonElement>("[data-token-visibility]")
  const feedback = document.querySelector<HTMLElement>("[data-portal-feedback]")
  const errorBox = document.querySelector<HTMLElement>("[data-portal-error]")
  const errorMessage = document.querySelector<HTMLElement>("[data-portal-error-message]")
  const reconnectAction = document.querySelector<HTMLElement>("[data-reconnect]")
  const statusSection = document.querySelector<HTMLElement>("[data-portal-status]")
  const statusActive = document.querySelector<HTMLElement>("[data-status-active]")
  const statusBlocked = document.querySelector<HTMLElement>("[data-status-blocked]")
  const expiresAt = document.querySelector<HTMLTimeElement>("[data-expires-at]")
  const refreshedAt = document.querySelector<HTMLTimeElement>("[data-refreshed-at]")
  const supportReference = document.querySelector<HTMLOutputElement>("[data-support-reference]")
  const blockedNotice = document.querySelector<HTMLElement>("[data-blocked-notice]")
  const blockReason = document.querySelector<HTMLElement>("[data-block-reason]")
  const blockedAt = document.querySelector<HTMLTimeElement>("[data-blocked-at]")
  const copySupportReferenceButton = document.querySelector<HTMLButtonElement>(
    "[data-copy-support-reference]",
  )
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
    statusActive === null ||
    statusBlocked === null ||
    expiresAt === null ||
    refreshedAt === null ||
    supportReference === null ||
    blockedNotice === null ||
    blockReason === null ||
    blockedAt === null ||
    copySupportReferenceButton === null ||
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
    blockedAt,
    blockedNotice,
    blockReason,
    copyTokenButton,
    copySupportReferenceButton,
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
    statusActive,
    statusBlocked,
    supportReference,
    tokenForm,
    tokenInput,
    tokenSubmit,
    tokenVisibility,
  }
}

export type PortalElements = NonNullable<ReturnType<typeof getPortalElements>>
