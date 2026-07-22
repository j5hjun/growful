import { describe, expect, it } from "vitest"
import {
  createPortalBrowserFixture,
  getPortalElement,
  runPortalClient,
} from "./fixtures/portal-browser.js"

describe("Growful portal client serialization", () => {
  it("executes as a standalone browser script", () => {
    const fixture = createPortalBrowserFixture()

    runPortalClient(fixture, async () => {
      throw new Error("Unexpected fetch")
    })

    expect(getPortalElement(fixture.elements, "form").listeners.has("submit")).toBe(true)
  })

  it("exits cleanly when a required portal element is absent", () => {
    const fixture = createPortalBrowserFixture("[data-disconnect-confirm]")
    let fetchCalls = 0

    runPortalClient(fixture, async () => {
      fetchCalls += 1
    })

    expect(fetchCalls).toBe(0)
    expect(getPortalElement(fixture.elements, "form").listeners.size).toBe(0)
  })
})
