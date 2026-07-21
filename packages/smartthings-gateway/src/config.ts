import { createHash } from "node:crypto"
import { z } from "zod"
import { type PrivateBetaInvite, parsePrivateBetaInvites } from "./private-beta/invite.js"

const configuredSecret = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("replace-with-"), "replace placeholder secrets")

const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "use HTTPS")

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  OAUTH_CLIENT_ID: configuredSecret,
  OAUTH_CLIENT_SECRET: configuredSecret,
  OAUTH_REDIRECT_URI: z.url(),
  PRIVATE_BETA_INVITES_JSON: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8_100),
  PUBLIC_OPERATOR_NAME: z.string().optional(),
  PUBLIC_PRIVACY_POLICY_URL: z.string().optional(),
  PUBLIC_SUPPORT_EMAIL: z.string().optional(),
  PUBLIC_TERMS_URL: z.string().optional(),
  REFRESH_BEFORE_EXPIRY_SECONDS: z.coerce.number().int().positive().default(3_600),
  REFRESH_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(300).default(300),
  REFRESH_LEASE_SECONDS: z.coerce.number().int().min(120).default(120),
  SMARTTHINGS_API_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(15),
  SMARTTHINGS_API_URL: z.url().default("https://api.smartthings.com"),
  SMARTTHINGS_APP_ID: configuredSecret,
  SMARTTHINGS_AUTHORIZE_URL: z.url().default("https://api.smartthings.com/oauth/authorize"),
  SMARTTHINGS_TOKEN_URL: z.url().default("https://api.smartthings.com/oauth/token"),
  SERVICE_ACCESS_MODE: z.enum(["private_beta", "public"]).default("private_beta"),
  SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE: z.string().optional(),
  SMARTTHINGS_PUBLIC_USE_APPROVED_AT: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: configuredSecret,
})

const privateBetaAccessSchema = z.object({
  PRIVATE_BETA_INVITES_JSON: z.string().min(1),
})

const disclosureSchema = z.object({
  PUBLIC_OPERATOR_NAME: z.string().trim().min(1).max(200),
  PUBLIC_PRIVACY_POLICY_URL: httpsUrl,
  PUBLIC_SUPPORT_EMAIL: z.email(),
  PUBLIC_TERMS_URL: httpsUrl,
})

const publicAccessSchema = z.object({
  SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE: z.string().trim().min(1).max(500),
  SMARTTHINGS_PUBLIC_USE_APPROVED_AT: z.iso.date(),
})

export type ServiceDisclosures = {
  readonly operatorName: string
  readonly policyVersion: string
  readonly privacyPolicyUrl: URL
  readonly supportEmail: string
  readonly termsUrl: URL
}

export type ServiceAccess = ServiceDisclosures &
  (
    | {
        readonly mode: "private_beta"
        readonly invites: readonly PrivateBetaInvite[]
      }
    | {
        readonly mode: "public"
        readonly smartThingsApprovalReference: string
        readonly smartThingsApprovedAt: string
      }
  )

export type AppConfig = {
  readonly apiBaseUrl: URL
  readonly apiTimeoutMs: number
  readonly authorizationUrl: URL
  readonly clientId: string
  readonly clientSecret: string
  readonly databaseUrl: string
  readonly encryptionKeyBase64: string
  readonly host: string
  readonly logLevel: string
  readonly port: number
  readonly redirectUri: URL
  readonly refreshBeforeExpiryMs: number
  readonly refreshCheckIntervalMs: number
  readonly refreshLeaseMs: number
  readonly serviceAccess: ServiceAccess
  readonly smartThingsAppId: string
  readonly tokenUrl: URL
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.parse(environment)
  const disclosure = disclosureSchema.parse(parsed)
  const disclosures: ServiceDisclosures = {
    operatorName: disclosure.PUBLIC_OPERATOR_NAME,
    policyVersion: createHash("sha256")
      .update(
        JSON.stringify({
          operatorName: disclosure.PUBLIC_OPERATOR_NAME,
          privacyPolicyUrl: disclosure.PUBLIC_PRIVACY_POLICY_URL,
          supportEmail: disclosure.PUBLIC_SUPPORT_EMAIL,
          termsUrl: disclosure.PUBLIC_TERMS_URL,
        }),
        "utf8",
      )
      .digest("hex"),
    privacyPolicyUrl: new URL(disclosure.PUBLIC_PRIVACY_POLICY_URL),
    supportEmail: disclosure.PUBLIC_SUPPORT_EMAIL,
    termsUrl: new URL(disclosure.PUBLIC_TERMS_URL),
  }
  const serviceAccess: ServiceAccess =
    parsed.SERVICE_ACCESS_MODE === "private_beta"
      ? (() => {
          const access = privateBetaAccessSchema.parse(parsed)
          return {
            ...disclosures,
            invites: parsePrivateBetaInvites(access.PRIVATE_BETA_INVITES_JSON),
            mode: "private_beta",
          }
        })()
      : (() => {
          const access = publicAccessSchema.parse(parsed)
          return {
            ...disclosures,
            mode: "public",
            smartThingsApprovalReference: access.SMARTTHINGS_PUBLIC_USE_APPROVAL_REFERENCE,
            smartThingsApprovedAt: access.SMARTTHINGS_PUBLIC_USE_APPROVED_AT,
          }
        })()
  return {
    apiBaseUrl: new URL(parsed.SMARTTHINGS_API_URL),
    apiTimeoutMs: parsed.SMARTTHINGS_API_TIMEOUT_SECONDS * 1_000,
    authorizationUrl: new URL(parsed.SMARTTHINGS_AUTHORIZE_URL),
    clientId: parsed.OAUTH_CLIENT_ID,
    clientSecret: parsed.OAUTH_CLIENT_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    encryptionKeyBase64: parsed.TOKEN_ENCRYPTION_KEY,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.PORT,
    redirectUri: new URL(parsed.OAUTH_REDIRECT_URI),
    refreshBeforeExpiryMs: parsed.REFRESH_BEFORE_EXPIRY_SECONDS * 1_000,
    refreshCheckIntervalMs: parsed.REFRESH_CHECK_INTERVAL_SECONDS * 1_000,
    refreshLeaseMs: parsed.REFRESH_LEASE_SECONDS * 1_000,
    serviceAccess,
    smartThingsAppId: parsed.SMARTTHINGS_APP_ID,
    tokenUrl: new URL(parsed.SMARTTHINGS_TOKEN_URL),
  }
}
