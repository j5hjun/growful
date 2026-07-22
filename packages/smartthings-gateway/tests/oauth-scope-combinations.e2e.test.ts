import { afterEach, describe, expect, it } from "vitest"
import { createApp } from "../src/http/app.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import type { SmartThingsScope } from "../src/oauth/smartthings-scope.js"
import { emptyServiceStatusSource } from "../src/status/service-status.js"
import { allowAllGrowfulAbuseControl } from "./fixtures/abuse-control.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"
import { publicOAuthAccess } from "./fixtures/oauth-access.js"
import { readyProbe } from "./fixtures/readiness.js"

const apps: ReturnType<typeof createApp>[] = []
const authorizationOrigin = "https://api.smartthings.test"
const redirectOrigin = "https://smartthings.growful.click"
const deviceRanges = ["selected", "all"] as const
const devicePermissions = ["read", "control", "write"] as const
const deviceScopeByRangeAndPermission = {
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
} as const satisfies Record<
  (typeof deviceRanges)[number],
  Record<(typeof devicePermissions)[number], SmartThingsScope>
>
const resourceDefinitions: readonly {
  field: string
  label: string
  permissions: readonly { scope: SmartThingsScope; value: string }[]
}[] = [
  {
    field: "hubPermissions",
    label: "hub",
    permissions: [{ scope: "r:hubs:*", value: "read" }],
  },
  {
    field: "locationPermissions",
    label: "location",
    permissions: [
      { scope: "r:locations:*", value: "read" },
      { scope: "w:locations:*", value: "write" },
      { scope: "x:locations:*", value: "execute" },
    ],
  },
  {
    field: "scenePermissions",
    label: "scene",
    permissions: [
      { scope: "r:scenes:*", value: "read" },
      { scope: "x:scenes:*", value: "execute" },
    ],
  },
  {
    field: "rulePermissions",
    label: "rule",
    permissions: [
      { scope: "r:rules:*", value: "read" },
      { scope: "w:rules:*", value: "write" },
    ],
  },
]

function nonEmptySelections<Value>(values: readonly Value[]): readonly (readonly Value[])[] {
  return Array.from({ length: 2 ** values.length - 1 }, (_, maskIndex) =>
    values.filter((_, valueIndex) => ((maskIndex + 1) & (1 << valueIndex)) !== 0),
  )
}

const deviceSelectionCases = deviceRanges.flatMap((deviceRange) =>
  nonEmptySelections(devicePermissions).map((permissions) => {
    const parameters = new URLSearchParams({ deviceRange })
    for (const permission of permissions) {
      parameters.append("devicePermissions", permission)
    }
    return {
      expectedScopes: permissions.map(
        (permission) => deviceScopeByRangeAndPermission[deviceRange][permission],
      ),
      label: `${deviceRange}-device-${permissions.join("+")}`,
      payload: parameters.toString(),
    }
  }),
)

const resourceSelectionCases = resourceDefinitions.flatMap((definition) =>
  nonEmptySelections(definition.permissions).map((permissions) => {
    const parameters = new URLSearchParams({ deviceRange: "selected" })
    for (const permission of permissions) {
      parameters.append(definition.field, permission.value)
    }
    return {
      expectedScopes: permissions.map(({ scope }) => scope),
      label: `${definition.label}-${permissions.map(({ value }) => value).join("+")}`,
      payload: parameters.toString(),
    }
  }),
)

const everyResourcePermissions =
  "hubPermissions=read&locationPermissions=read&locationPermissions=write&locationPermissions=execute&scenePermissions=read&scenePermissions=execute&rulePermissions=read&rulePermissions=write"
const combinedSelectionCases = deviceRanges.map((deviceRange) => ({
  expectedScopes: [
    `r:devices:${deviceRange === "selected" ? "$" : "*"}`,
    `x:devices:${deviceRange === "selected" ? "$" : "*"}`,
    `w:devices:${deviceRange === "selected" ? "$" : "*"}`,
    "r:hubs:*",
    "r:locations:*",
    "w:locations:*",
    "x:locations:*",
    "r:scenes:*",
    "x:scenes:*",
    "r:rules:*",
    "w:rules:*",
  ],
  label: `${deviceRange}-every-resource-permission`,
  payload: `deviceRange=${deviceRange}&devicePermissions=read&devicePermissions=control&devicePermissions=write&${everyResourcePermissions}`,
}))
const validSelectionCases = [
  ...deviceSelectionCases,
  ...resourceSelectionCases,
  ...combinedSelectionCases,
]

function createFixture() {
  const service = new OAuthService({
    client: new FakeSmartThingsClient(),
    now: () => new Date("2026-07-21T00:00:00.000Z"),
    refreshBeforeExpiryMs: 60 * 60 * 1_000,
    refreshLeaseMs: 60_000,
    stateGenerator: () => "exhaustive-selection-test-state",
    store: new MemoryOAuthStore(),
  })
  const app = createApp({
    abuseControl: allowAllGrowfulAbuseControl,
    authorizationOrigin,
    oauthAccess: publicOAuthAccess,
    readinessProbe: readyProbe,
    redirectOrigin,
    serviceStatusSource: emptyServiceStatusSource,
    service,
    smartThingsAppId: "growful-app",
  })
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
          "content-type": "application/x-www-form-urlencoded",
          origin: redirectOrigin,
        },
        method: "POST",
        payload: `${payload}&policyConsent=accepted`,
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

  it.each(deviceRanges)("returns guidance for an empty %s selection", async (deviceRange) => {
    // Given
    const app = createFixture()

    // When
    const response = await app.inject({
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload: `deviceRange=${deviceRange}&policyConsent=accepted`,
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(400)
    expect(response.headers["content-type"]).toContain("text/html")
    expect(response.body).toContain('role="alert"')
    expect(response.body).toContain(`name="deviceRange" value="${deviceRange}" checked`)
    expect(response.headers.location).toBeUndefined()
  })

  it("preserves the allowlisted draft without reflecting rejected request values", async () => {
    // Given
    const app = createFixture()
    const rejectedValue = "private-user-identifier"
    const payload = `deviceRange=all&devicePermissions=read&devicePermissions=control&devicePermissions=admin&hubPermissions=read&locationPermissions=write&scenePermissions=execute&rulePermissions=write&policyConsent=accepted&unexpectedField=${rejectedValue}`

    // When
    const response = await app.inject({
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: redirectOrigin,
      },
      method: "POST",
      payload,
      url: "/oauth/start",
    })

    // Then
    expect(response.statusCode).toBe(400)
    for (const selection of [
      'name="deviceRange" value="all" checked',
      'name="devicePermissions" value="read" checked',
      'name="devicePermissions" value="control" checked',
      'name="hubPermissions" value="read" checked',
      'name="locationPermissions" value="write" checked',
      'name="scenePermissions" value="execute" checked',
      'name="rulePermissions" value="write" checked',
      'name="policyConsent" value="accepted" required checked',
    ]) {
      expect(response.body).toContain(selection)
    }
    expect(response.body).toContain('id="selection-error-summary"')
    expect(response.body).not.toContain("admin")
    expect(response.body).not.toContain(rejectedValue)
    expect(response.headers.location).toBeUndefined()
  })
})
