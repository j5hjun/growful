import { z } from "zod"

const configuredSecret = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("replace-with-"), "replace placeholder secrets")

const environmentSchema = z
  .object({
    DATABASE_URL: z.url(),
    GATEWAY_API_TOKEN: configuredSecret.refine(
      (value) => value.length >= 32,
      "minimum 32 characters",
    ),
    HOST: z.string().min(1).default("0.0.0.0"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    OAUTH_ADMIN_TOKEN: configuredSecret.refine(
      (value) => value.length >= 32,
      "minimum 32 characters",
    ),
    OAUTH_CLIENT_ID: configuredSecret,
    OAUTH_CLIENT_SECRET: configuredSecret,
    OAUTH_REDIRECT_URI: z.url(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8_100),
    REFRESH_BEFORE_EXPIRY_SECONDS: z.coerce.number().int().positive().default(3_600),
    REFRESH_CHECK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
    REFRESH_LEASE_SECONDS: z.coerce.number().int().min(120).default(120),
    SMARTTHINGS_API_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(15),
    SMARTTHINGS_API_URL: z.url().default("https://api.smartthings.com"),
    SMARTTHINGS_AUTHORIZE_URL: z.url().default("https://api.smartthings.com/oauth/authorize"),
    SMARTTHINGS_SCOPES: z.string().min(1),
    SMARTTHINGS_TOKEN_URL: z.url().default("https://api.smartthings.com/oauth/token"),
    TOKEN_ENCRYPTION_KEY: configuredSecret,
  })
  .refine((environment) => environment.GATEWAY_API_TOKEN !== environment.OAUTH_ADMIN_TOKEN, {
    message: "must differ from OAUTH_ADMIN_TOKEN",
    path: ["GATEWAY_API_TOKEN"],
  })

export type AppConfig = {
  readonly adminToken: string
  readonly apiBaseUrl: URL
  readonly apiTimeoutMs: number
  readonly authorizationUrl: URL
  readonly clientId: string
  readonly clientSecret: string
  readonly databaseUrl: string
  readonly encryptionKeyBase64: string
  readonly gatewayApiToken: string
  readonly host: string
  readonly logLevel: string
  readonly port: number
  readonly redirectUri: URL
  readonly refreshBeforeExpiryMs: number
  readonly refreshCheckIntervalMs: number
  readonly refreshLeaseMs: number
  readonly scopes: readonly string[]
  readonly tokenUrl: URL
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.parse(environment)
  return {
    adminToken: parsed.OAUTH_ADMIN_TOKEN,
    apiBaseUrl: new URL(parsed.SMARTTHINGS_API_URL),
    apiTimeoutMs: parsed.SMARTTHINGS_API_TIMEOUT_SECONDS * 1_000,
    authorizationUrl: new URL(parsed.SMARTTHINGS_AUTHORIZE_URL),
    clientId: parsed.OAUTH_CLIENT_ID,
    clientSecret: parsed.OAUTH_CLIENT_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    encryptionKeyBase64: parsed.TOKEN_ENCRYPTION_KEY,
    gatewayApiToken: parsed.GATEWAY_API_TOKEN,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.PORT,
    redirectUri: new URL(parsed.OAUTH_REDIRECT_URI),
    refreshBeforeExpiryMs: parsed.REFRESH_BEFORE_EXPIRY_SECONDS * 1_000,
    refreshCheckIntervalMs: parsed.REFRESH_CHECK_INTERVAL_SECONDS * 1_000,
    refreshLeaseMs: parsed.REFRESH_LEASE_SECONDS * 1_000,
    scopes: parsed.SMARTTHINGS_SCOPES.split(/\s+/).filter((scope) => scope.length > 0),
    tokenUrl: new URL(parsed.SMARTTHINGS_TOKEN_URL),
  }
}
