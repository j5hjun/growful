/// <reference lib="dom" />

export function bindTokenSafetyActions(): void {
  const regions = document.querySelectorAll<HTMLElement>("[data-token-safety]")
  for (const region of regions) {
    const copyButton = region.querySelector<HTMLButtonElement>("[data-copy-token]")
    const error = region.querySelector<HTMLElement>("[data-token-copy-error]")
    const feedback = region.querySelector<HTMLElement>("[data-token-copy-feedback]")
    const output = region.querySelector<HTMLOutputElement>("[data-token-value]")
    if (copyButton === null || error === null || feedback === null || output === null) continue

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(output.textContent)
        error.hidden = true
        feedback.hidden = false
      } catch (copyError) {
        if (!(copyError instanceof Error)) throw copyError
        feedback.hidden = true
        error.hidden = false
        output.focus()
      }
    })
  }
}

export const tokenSafetyClientScript = `(${bindTokenSafetyActions.toString()})()`
