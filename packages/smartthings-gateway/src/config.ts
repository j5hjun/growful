import { z } from "zod"

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  HOST: z.string().min(1).default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  OAUTH_ADMIN_TOKEN: z.string().min(32),
  OAUTH_CLIENT_ID: z.string().min(1),
  OAUTH_CLIENT_SECRET: z.string().min(1),
  OAUTH_REDIRECT_URI: z.url(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8_100),
  REFRESH_BEFORE_EXPIRY_SECONDS: z.coerce.number().int().positive().default(3_600),
  REFRESH_CHECK_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
  REFRESH_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  SMARTTHINGS_AUTHORIZE_URL: z.url().default("https://api.smartthings.com/oauth/authorize"),
  SMARTTHINGS_SCOPES: z.string().min(1),
  SMARTTHINGS_TOKEN_URL: z.url().default("https://api.smartthings.com/oauth/token"),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
})

export type AppConfig = {
  readonly adminToken: string
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
  readonly scopes: readonly string[]
  readonly tokenUrl: URL
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.parse(environment)
  return {
    adminToken: parsed.OAUTH_ADMIN_TOKEN,
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
    scopes: parsed.SMARTTHINGS_SCOPES.split(/\s+/).filter((scope) => scope.length > 0),
    tokenUrl: new URL(parsed.SMARTTHINGS_TOKEN_URL),
  }
}
