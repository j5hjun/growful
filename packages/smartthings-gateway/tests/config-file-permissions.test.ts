import { describe, expect, it, vi } from "vitest"

class PermissionDeniedError extends Error {
  readonly code = "EACCES"
}

vi.mock("node:fs", () => ({
  readFileSync: () => {
    throw new PermissionDeniedError("permission denied")
  },
}))

import { loadConfig } from "../src/config.js"

const requiredEnvironment = {
  DATABASE_URL: "postgresql://gateway:password@postgres:5432/gateway",
  OAUTH_CLIENT_ID: "client-id",
  OAUTH_CLIENT_SECRET: undefined,
  OAUTH_CLIENT_SECRET_FILE: "configured-secret-file",
  OAUTH_REDIRECT_URI: "https://smartthings.growful.click/oauth/callback",
  PRIVATE_BETA_INVITES_JSON: JSON.stringify([
    {
      passwordHash: "e214b18e99c1bca9e25c4b75ddb7f79467c142126692b2faf713376b492b297f",
      username: "beta-user",
    },
  ]),
  PUBLIC_OPERATOR_NAME: "Growful",
  PUBLIC_SUPPORT_EMAIL: "support@growful.click",
  SMARTTHINGS_APP_ID: "smartthings-app-id",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} satisfies NodeJS.ProcessEnv

describe("loadConfig file permissions", () => {
  it("reports a sanitized error when the operating system denies file access", () => {
    // Given
    const environment = { ...requiredEnvironment }

    // When
    const loadUnreadableFile = () => loadConfig(environment)

    // Then
    expect(loadUnreadableFile).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(environment.OAUTH_CLIENT_SECRET_FILE),
        name: "SecretFileReadError",
      }),
    )
  })
})
