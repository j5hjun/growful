import { describe, expect, it } from "vitest"
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
  PUBLIC_PRIVACY_POLICY_URL: "https://smartthings.growful.click/privacy",
  PUBLIC_SUPPORT_EMAIL: "support@growful.click",
  PUBLIC_TERMS_URL: "https://smartthings.growful.click/terms",
  SMARTTHINGS_APP_ID: "smartthings-app-id",
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
}

describe("loadConfig", () => {
  it("parses runtime configuration without shared Gateway tokens", () => {
    // Given
    const environment = { ...requiredEnvironment }

    // When
    const config = loadConfig(environment)

    // Then
    expect(config).toMatchObject({
      apiBaseUrl: new URL("https://api.smartthings.com"),
      apiTimeoutMs: 15_000,
      databaseUrl: environment.DATABASE_URL,
      host: "0.0.0.0",
      port: 8_100,
      refreshBeforeExpiryMs: 3_600_000,
      refreshCheckIntervalMs: 300_000,
      refreshLeaseMs: 120_000,
      serviceAccess: {
        invites: [
          {
            passwordHash: "e214b18e99c1bca9e25c4b75ddb7f79467c142126692b2faf713376b492b297f",
            username: "beta-user",
          },
        ],
        mode: "private_beta",
        operatorName: "Growful",
        policyVersion: expect.any(String),
        privacyPolicyUrl: new URL("https://smartthings.growful.click/privacy"),
        supportEmail: "support@growful.click",
        termsUrl: new URL("https://smartthings.growful.click/terms"),
      },
      smartThingsAppId: environment.SMARTTHINGS_APP_ID,
    })
    expect(config).not.toHaveProperty("adminToken")
    expect(config).not.toHaveProperty("gatewayApiToken")
  })

  it("rejects a refresh lease shorter than the bounded refresh operation", () => {
    expect(() => loadConfig({ ...requiredEnvironment, REFRESH_LEASE_SECONDS: "60" })).toThrow()
  })

  it("caps the maintenance interval so expired OAuth state retention is bounded", () => {
    expect(() =>
      loadConfig({ ...requiredEnvironment, REFRESH_CHECK_INTERVAL_SECONDS: "301" }),
    ).toThrow()
  })

  it("pins runtime SmartThings credential destinations", () => {
    expect(() =>
      loadConfig({ ...requiredEnvironment, SMARTTHINGS_API_URL: "https://attacker.example" }),
    ).toThrow()
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        SMARTTHINGS_AUTHORIZE_URL: "https://attacker.example/oauth/authorize",
      }),
    ).toThrow()
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        SMARTTHINGS_TOKEN_URL: "https://attacker.example/oauth/token",
      }),
    ).toThrow()
  })

  it("changes policy identity with service mode and approval facts", () => {
    const privatePolicyVersion = loadConfig(requiredEnvironment).serviceAccess.policyVersion
    const publicPolicyVersion = loadConfig({
      ...requiredEnvironment,
      PRIVATE_BETA_INVITES_JSON: undefined,
      SERVICE_ACCESS_MODE: "public",
      SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE: "smartthings-case-123",
      SMARTTHINGS_PUBLIC_USE_APPROVED_AT: "2026-07-22",
    }).serviceAccess.policyVersion

    expect(publicPolicyVersion).not.toBe(privatePolicyVersion)
  })

  it("rejects private beta mode without an invitation list", () => {
    expect(() =>
      loadConfig({ ...requiredEnvironment, PRIVATE_BETA_INVITES_JSON: undefined }),
    ).toThrow()
  })

  it("rejects private beta mode without operator and policy disclosures", () => {
    expect(() => loadConfig({ ...requiredEnvironment, PUBLIC_OPERATOR_NAME: undefined })).toThrow()
    expect(() =>
      loadConfig({ ...requiredEnvironment, PUBLIC_PRIVACY_POLICY_URL: undefined }),
    ).toThrow()
  })

  it("rejects duplicate private beta usernames", () => {
    const duplicateInvites = JSON.stringify([
      {
        passwordHash: "e214b18e99c1bca9e25c4b75ddb7f79467c142126692b2faf713376b492b297f",
        username: "beta-user",
      },
      {
        passwordHash: "5b7865cd940ba26f00ee2d535bf8d96aba6308d98c1e290e2d095986e5967f55",
        username: "beta-user",
      },
    ])

    expect(() =>
      loadConfig({ ...requiredEnvironment, PRIVATE_BETA_INVITES_JSON: duplicateInvites }),
    ).toThrow()
  })

  it("rejects malformed private beta invitation JSON", () => {
    expect(() =>
      loadConfig({ ...requiredEnvironment, PRIVATE_BETA_INVITES_JSON: "not-json" }),
    ).toThrow()
  })

  it("parses public mode only with operator, policy, and SmartThings approval facts", () => {
    const config = loadConfig({
      ...requiredEnvironment,
      PRIVATE_BETA_INVITES_JSON: undefined,
      PUBLIC_OPERATOR_NAME: "Growful",
      PUBLIC_PRIVACY_POLICY_URL: "https://smartthings.growful.click/privacy",
      PUBLIC_SUPPORT_EMAIL: "support@growful.click",
      PUBLIC_TERMS_URL: "https://smartthings.growful.click/terms",
      SERVICE_ACCESS_MODE: "public",
      SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE: "smartthings-case-123",
      SMARTTHINGS_PUBLIC_USE_APPROVED_AT: "2026-07-22",
    })

    expect(config.serviceAccess).toEqual({
      mode: "public",
      operatorName: "Growful",
      policyVersion: expect.any(String),
      privacyPolicyUrl: new URL("https://smartthings.growful.click/privacy"),
      smartThingsApprovalReference: "smartthings-case-123",
      smartThingsApprovedAt: "2026-07-22",
      supportEmail: "support@growful.click",
      termsUrl: new URL("https://smartthings.growful.click/terms"),
    })
  })

  it("rejects public mode when approval or HTTPS policy facts are missing", () => {
    const publicEnvironment = {
      ...requiredEnvironment,
      PUBLIC_OPERATOR_NAME: "Growful",
      PUBLIC_PRIVACY_POLICY_URL: "https://smartthings.growful.click/privacy",
      PUBLIC_SUPPORT_EMAIL: "support@growful.click",
      PUBLIC_TERMS_URL: "https://smartthings.growful.click/terms",
      SERVICE_ACCESS_MODE: "public",
      SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE: "smartthings-case-123",
      SMARTTHINGS_PUBLIC_USE_APPROVED_AT: "2026-07-22",
    }
    expect(() =>
      loadConfig({ ...publicEnvironment, SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE: undefined }),
    ).toThrow()
    expect(() =>
      loadConfig({
        ...publicEnvironment,
        PUBLIC_PRIVACY_POLICY_URL: "http://example.test/privacy",
      }),
    ).toThrow()
  })
})
