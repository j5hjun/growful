import { describe, expect, it } from "vitest"
import {
  createPortalBrowserFixture,
  deferred,
  getPortalElement,
  response,
  runPortalClient,
} from "./fixtures/portal-browser.js"

describe("Growful portal token mutations", () => {
  it("serializes rotation and disconnect in both orderings", async () => {
    // Given
    const tokenA = `grw_st_${"A".repeat(43)}`
    const tokenB = `grw_st_${"B".repeat(43)}`
    const rotationResponse = deferred<ReturnType<typeof response>>()
    const fixture = createPortalBrowserFixture()
    const { elements } = fixture
    const confirm = getPortalElement(elements, "confirm")
    const dialog = getPortalElement(elements, "dialog")
    const disconnect = getPortalElement(elements, "disconnect")
    const disconnectForm = getPortalElement(elements, "disconnectForm")
    const forget = getPortalElement(elements, "forget")
    const form = getPortalElement(elements, "form")
    const input = getPortalElement(elements, "input")
    const rotate = getPortalElement(elements, "rotate")
    const status = getPortalElement(elements, "status")
    let serverToken: string | null = tokenA
    let deleteGate: ReturnType<typeof deferred<void>> | undefined
    let rotationRequests = 0
    const deleteAuthorizations: string[] = []
    const fetch = async (
      path: string,
      options: { headers: { authorization: string }; method: string },
    ) => {
      const authorization = options.headers.authorization.slice("Bearer ".length)
      if (path === "/connection" && options.method === "GET") {
        return response(authorization === serverToken ? 200 : 401, {
          connected: true,
          expiresAt: "2026-07-23T00:00:00.000Z",
          grantedScopes: [],
          lastRefreshedAt: null,
          serviceAccess: { status: "active" },
          supportReference: "c".repeat(64),
        })
      }
      if (path === "/token/rotate") {
        rotationRequests += 1
        if (authorization !== serverToken) return response(401)
        serverToken = tokenB
        return rotationResponse.promise
      }
      deleteAuthorizations.push(authorization)
      await deleteGate?.promise
      if (authorization !== serverToken) return response(401)
      serverToken = null
      return response(204)
    }
    runPortalClient(fixture, fetch)
    input.value = tokenA
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(status.focusCount).toBe(1)

    // When
    const pendingRotation = rotate.dispatch("click")
    await Promise.resolve()
    await disconnect.dispatch("click")

    // Then
    expect(serverToken).toBe(tokenB)
    expect(forget.disabled).toBe(true)
    expect(disconnect.disabled).toBe(true)
    expect(dialog.open).toBe(false)
    expect(deleteAuthorizations).toEqual([])

    rotationResponse.resolve(response(200, { growfulToken: tokenB }))
    await pendingRotation
    await disconnect.dispatch("click")
    await disconnectForm.dispatch("submit", {
      preventDefault() {},
      submitter: confirm,
    })
    expect(deleteAuthorizations).toEqual([tokenB])
    expect(serverToken).toBeNull()

    serverToken = tokenA
    deleteAuthorizations.length = 0
    input.value = tokenA
    await form.dispatch("submit", { preventDefault() {} })
    await new Promise<void>((resolve) => setImmediate(resolve))
    deleteGate = deferred<void>()
    await disconnect.dispatch("click")
    const pendingDisconnect = disconnectForm.dispatch("submit", {
      preventDefault() {},
      submitter: confirm,
    })
    await Promise.resolve()
    dialog.close()
    await dialog.dispatch("close")
    await rotate.dispatch("click")
    expect(rotate.disabled).toBe(true)
    expect(rotationRequests).toBe(1)
    expect(serverToken).toBe(tokenA)
    deleteGate.resolve()
    await pendingDisconnect
    expect(deleteAuthorizations).toEqual([tokenA])
    expect(serverToken).toBeNull()
  })
})
