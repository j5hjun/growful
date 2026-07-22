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

    region.addEventListener("token-safety-reset", () => {
      copyGeneration += 1
      copyButton.disabled = false
      error.hidden = true
      feedback.hidden = true
    })

    copyButton.addEventListener("click", async () => {
      const requestGeneration = ++copyGeneration
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
        if (requestGeneration === copyGeneration) copyButton.disabled = false
      }
    })
  }
}

export const tokenSafetyClientScript = `(${bindTokenSafetyActions.toString()})()`
