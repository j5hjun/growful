/// <reference lib="dom" />

export function bindTokenSafetyActions(): void {
  const regions = document.querySelectorAll<HTMLElement>("[data-token-safety]")
  for (const region of regions) {
    const copyButton = region.querySelector<HTMLButtonElement>("[data-copy-token]")
    const error = region.querySelector<HTMLElement>("[data-token-copy-error]")
    const feedback = region.querySelector<HTMLElement>("[data-token-copy-feedback]")
    const output = region.querySelector<HTMLOutputElement>("[data-token-value]")
    if (copyButton === null || error === null || feedback === null || output === null) continue
    let copyGeneration = 0
    let copyPending = false
    let pageHidden = false

    region.addEventListener("token-safety-reset", () => {
      copyGeneration += 1
      copyButton.disabled = pageHidden || copyPending
      error.hidden = true
      feedback.hidden = true
    })

    window.addEventListener("pagehide", () => {
      pageHidden = true
      copyGeneration += 1
      output.textContent = ""
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
        await navigator.clipboard.writeText(output.textContent)
        if (requestGeneration !== copyGeneration) return
        error.hidden = true
        feedback.hidden = false
      } catch (copyError) {
        if (!(copyError instanceof Error)) throw copyError
        if (requestGeneration !== copyGeneration) return
        feedback.hidden = true
        error.hidden = false
        output.focus()
      } finally {
        copyPending = false
        copyButton.disabled = pageHidden
      }
    })
  }
}

export const tokenSafetyClientScript = `(${bindTokenSafetyActions.toString()})()`
