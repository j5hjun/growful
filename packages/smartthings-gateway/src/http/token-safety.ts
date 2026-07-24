/// <reference lib="dom" />

export function bindTokenSafetyActions(): void {
  const regions = document.querySelectorAll<HTMLElement>("[data-token-safety]")
  for (const region of regions) {
    const copyButton = region.querySelector<HTMLButtonElement>("[data-copy-token]")
    const error = region.querySelector<HTMLElement>("[data-token-copy-error]")
    const feedback = region.querySelector<HTMLElement>("[data-token-copy-feedback]")
    const tokenValue = region.querySelector<HTMLTextAreaElement | HTMLOutputElement>(
      "[data-token-value]",
    )
    if (copyButton === null || error === null || feedback === null || tokenValue === null) continue
    const textControl = "selectionStart" in tokenValue ? tokenValue : undefined
    const readToken = () => textControl?.value ?? tokenValue.textContent
    const clearToken = () => {
      if (textControl === undefined) tokenValue.textContent = ""
      else {
        textControl.value = ""
        textControl.defaultValue = ""
        textControl.textContent = ""
      }
    }
    let copyGeneration = 0
    let copyPending = false
    let pageHidden = false
    let tokenAcknowledged = false

    if (textControl !== undefined) textControl.tabIndex = -1
    copyButton.hidden = false
    copyButton.disabled = false

    tokenValue.addEventListener("copy", () => {
      const token = readToken()
      const exactSelection =
        textControl === undefined
          ? window.getSelection()?.toString() === token
          : textControl.selectionStart === 0 && textControl.selectionEnd === token.length
      if (!exactSelection) return
      tokenAcknowledged = true
      region.setAttribute("data-token-safety-acknowledged", "")
      error.hidden = true
      feedback.hidden = false
    })

    region.addEventListener("token-safety-reset", () => {
      copyGeneration += 1
      tokenAcknowledged = false
      region.removeAttribute("data-token-safety-acknowledged")
      copyButton.disabled = pageHidden || copyPending
      error.hidden = true
      feedback.hidden = true
    })

    window.addEventListener("beforeunload", (event) => {
      if (tokenAcknowledged || readToken() === "") return
      event.preventDefault()
      event.returnValue = ""
    })

    window.addEventListener("pagehide", () => {
      pageHidden = true
      copyGeneration += 1
      tokenAcknowledged = false
      region.removeAttribute("data-token-safety-acknowledged")
      clearToken()
      copyButton.disabled = true
      error.hidden = true
      feedback.hidden = true
    })

    copyButton.addEventListener("click", async () => {
      if (copyPending) return
      const requestGeneration = ++copyGeneration
      copyPending = true
      copyButton.disabled = true
      try {
        await navigator.clipboard.writeText(readToken())
        if (requestGeneration !== copyGeneration) return
        tokenAcknowledged = true
        region.setAttribute("data-token-safety-acknowledged", "")
        error.hidden = true
        feedback.hidden = false
      } catch (copyError) {
        if (!(copyError instanceof Error)) throw copyError
        if (requestGeneration !== copyGeneration) return
        feedback.hidden = true
        error.hidden = false
        tokenValue.focus()
        if (textControl === undefined) {
          const tokenRange = document.createRange()
          tokenRange.selectNodeContents(tokenValue)
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(tokenRange)
        } else {
          textControl.select()
        }
      } finally {
        copyPending = false
        copyButton.disabled = pageHidden
      }
    })
  }
}

export const tokenSafetyClientScript = `(${bindTokenSafetyActions.toString()})()`
