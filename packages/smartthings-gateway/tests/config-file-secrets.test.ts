import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "../src/config.js"

const requiredEnvironment = {
  DATABASE_URL: "postgresql://gateway:password@postgres:5432/gateway",
  OAUTH_CLIENT_ID: "client-id",
  OAUTH_CLIENT_SECRET: "client-secret",
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

const fileSecretCases = [
  {
    configKey: "databaseUrl",
    directKey: "DATABASE_URL",
    fileKey: "DATABASE_URL_FILE",
    value: requiredEnvironment.DATABASE_URL,
  },
  {
    configKey: "clientSecret",
    directKey: "OAUTH_CLIENT_SECRET",
    fileKey: "OAUTH_CLIENT_SECRET_FILE",
    value: requiredEnvironment.OAUTH_CLIENT_SECRET,
  },
  {
    configKey: "encryptionKeyBase64",
    directKey: "TOKEN_ENCRYPTION_KEY",
    fileKey: "TOKEN_ENCRYPTION_KEY_FILE",
    value: requiredEnvironment.TOKEN_ENCRYPTION_KEY,
  },
] as const

const secretDirectories: string[] = []

afterEach(() => {
  for (const directory of secretDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function writeSecretFile(name: string, value: string): string {
  const directory = mkdtempSync(join(tmpdir(), "growful-config-test-"))
  secretDirectories.push(directory)
  const path = join(directory, name)
  writeFileSync(path, value, { mode: 0o600 })
  return path
}

describe("loadConfig file-backed secrets", () => {
  it("preserves the existing direct-only environment contract", () => {
    // Given
    const environment = { ...requiredEnvironment }

    // When
    const config = loadConfig(environment)

    // Then
    expect(config.databaseUrl).toBe(requiredEnvironment.DATABASE_URL)
    expect(config.clientSecret).toBe(requiredEnvironment.OAUTH_CLIENT_SECRET)
    expect(config.encryptionKeyBase64).toBe(requiredEnvironment.TOKEN_ENCRYPTION_KEY)
  })

  it.each(fileSecretCases)(
    "loads $directKey from its file when the direct key is absent",
    (secret) => {
      // Given
      const environment: NodeJS.ProcessEnv = { ...requiredEnvironment }
      environment[secret.directKey] = undefined
      environment[secret.fileKey] = writeSecretFile(
        secret.fileKey.toLowerCase(),
        `${secret.value}\n`,
      )

      // When
      const config = loadConfig(environment)

      // Then
      expect(config[secret.configKey]).toBe(secret.value)
    },
  )

  it.each(fileSecretCases)(
    "keeps direct $directKey precedence when both sources exist",
    (secret) => {
      // Given
      const environment: NodeJS.ProcessEnv = {
        ...requiredEnvironment,
        [secret.fileKey]: writeSecretFile(secret.fileKey.toLowerCase(), "unused-file-value"),
      }

      // When
      const config = loadConfig(environment)

      // Then
      expect(config[secret.configKey]).toBe(secret.value)
    },
  )

  it.each(fileSecretCases)("rejects missing $directKey and file source", (secret) => {
    // Given
    const environment: NodeJS.ProcessEnv = { ...requiredEnvironment }
    environment[secret.directKey] = undefined

    // When
    const loadMissingSecret = () => loadConfig(environment)

    // Then
    expect(loadMissingSecret).toThrow()
  })

  it.each(fileSecretCases)("rejects an empty $fileKey file", (secret) => {
    // Given
    const environment: NodeJS.ProcessEnv = { ...requiredEnvironment }
    environment[secret.directKey] = undefined
    environment[secret.fileKey] = writeSecretFile(secret.fileKey.toLowerCase(), "\n")

    // When
    const loadEmptySecret = () => loadConfig(environment)

    // Then
    expect(loadEmptySecret).toThrow()
  })

  it.each(fileSecretCases)("reports a sanitized $fileKey read failure", (secret) => {
    // Given
    const environment: NodeJS.ProcessEnv = { ...requiredEnvironment }
    environment[secret.directKey] = undefined
    const missingPath = join(tmpdir(), `missing-${secret.fileKey.toLowerCase()}`)
    environment[secret.fileKey] = missingPath

    // When
    const loadMissingFile = () => loadConfig(environment)

    // Then
    expect(loadMissingFile).toThrowError(
      expect.objectContaining({
        message: expect.not.stringContaining(missingPath),
        name: "SecretFileReadError",
      }),
    )
  })

  it.each(["\n", "\r\n"])("normalizes one trailing %j from file-backed values", (lineEnding) => {
    // Given
    const environment: NodeJS.ProcessEnv = { ...requiredEnvironment }
    for (const secret of fileSecretCases) {
      environment[secret.directKey] = undefined
      environment[secret.fileKey] = writeSecretFile(
        `${secret.fileKey.toLowerCase()}-${lineEnding.length}`,
        `${secret.value}${lineEnding}`,
      )
    }

    // When
    const config = loadConfig(environment)

    // Then
    for (const secret of fileSecretCases) {
      expect(config[secret.configKey]).toBe(secret.value)
    }
  })

  it("does not mutate the caller environment while resolving files", () => {
    // Given
    const environment = {
      ...requiredEnvironment,
      OAUTH_CLIENT_SECRET: undefined,
      OAUTH_CLIENT_SECRET_FILE: writeSecretFile(
        "oauth-secret",
        requiredEnvironment.OAUTH_CLIENT_SECRET,
      ),
    }

    // When
    loadConfig(environment)

    // Then
    expect(environment.OAUTH_CLIENT_SECRET).toBeUndefined()
  })
})
