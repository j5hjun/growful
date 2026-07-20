import { afterEach, describe, expect, it } from "vitest"
import { createApp } from "../src/http/app.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"

const apps: ReturnType<typeof createApp>[] = []
const adminToken = "test-admin-token-with-32-characters"
const adminAuthorization = `Basic ${Buffer.from(`operator:${adminToken}`).toString("base64")}`
const authorizationOrigin = "https://api.smartthings.test"
const redirectOrigin = "https://smartthings.growful.click"
const deviceRanges = ["selected", "all"] as const
const devicePermissions = ["read", "control", "write"] as const
const locationSelections = [false, true] as const
const scopeByRangeAndPermission = {
  all: {
    control: "x:devices:*",
    read: "r:devices:*",
    write: "w:devices:*",
  },
  selected: {
    control: "x:devices:$",
    read: "r:devices:$",
    write: "w:devices:$",
  },
} as const

const permissionSelections = Array.from({ length: 7 }, (_, maskIndex) =>
  devicePermissions.filter(
    (_, permissionIndex) => ((maskIndex + 1) & (1 << permissionIndex)) !== 0,
  ),
)

const validSelectionCases = deviceRanges.flatMap((deviceRange) =>
  permissionSelections.flatMap((permissions) =>
    locationSelections.map((locationRead) => {
      const parameters = new URLSearchParams({ deviceRange })
      for (const permission of permissions) {
        parameters.append("permissions", permission)
      }
      if (locationRead) {
        parameters.set("locationRead", "on")
      }
      const deviceScopes = permissions.map(
        (permission) => scopeByRangeAndPermission[deviceRange][permission],
      )
      return {
        expectedScopes: locationRead ? [...deviceScopes, "r:locations:*"] : deviceScopes,
        label: `${deviceRange}-${permissions.join("+")}-location-${locationRead}`,
        payload: parameters.toString(),
      }
    }),
  ),
)

const emptyPermissionCases = deviceRanges.flatMap((deviceRange) =>
  locationSelections.map((locationRead) => {
    const parameters = new URLSearchParams({ deviceRange })
    if (locationRead) {
      parameters.set("locationRead", "on")
    }
    return {
      label: `${deviceRange}-no-device-permission-location-${locationRead}`,
      payload: parameters.toString(),
    }
  }),
)

function createFixture() {
  const service = new OAuthService({
    client: new FakeSmartThingsClient(),
    now: () => new Date("2026-07-21T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "exhaustive-selection-test-state",
    store: new MemoryOAuthStore(),
  })
  const app = createApp({ adminToken, authorizationOrigin, redirectOrigin, service })
  apps.push(app)
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("SmartThings OAuth scope combinations", () => {
  it.each(validSelectionCases)(
    "redirects the valid $label selection",
    async ({ expectedScopes, payload }) => {
      // Given
      const app = createFixture()

      // When
      const response = await app.inject({
        headers: {
          authorization: adminAuthorization,
          "content-type": "application/x-www-form-urlencoded",
          origin: redirectOrigin,
        },
        method: "POST",
        payload,
        url: "/oauth/start",
      })

      // Then
      expect(response.statusCode).toBe(302)
      const authorizationUrl = new URL(response.headers.location ?? "")
      expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
        "https://api.smartthings.test/oauth/authorize",
      )
      expect(authorizationUrl.searchParams.get("scope")).toBe(expectedScopes.join(" "))
      expect(authorizationUrl.searchParams.get("state")).toBe("exhaustive-selection-test-state")
    },
  )

  it.each(emptyPermissionCases)("returns guidance for $label", async ({ payload }) => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload,
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.body).toContain('role="alert"')
    expect(response.headers.location).toBeUndefined()
  })
})
