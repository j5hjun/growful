import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { hashAuditSubject } from "../src/audit/audit-event.js"
import { AuditedOAuthStore } from "../src/audit/audited-oauth-store.js"
import { PostgresAuditSink } from "../src/audit/postgres-audit-sink.js"
import { createApp } from "../src/http/app.js"
import {
  GrowfulRequestQuota,
  PostgresGrowfulRequestQuotaStore,
} from "../src/http/growful-request-quota.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { generateGrowfulToken, hashGrowfulToken } from "../src/security/growful-token.js"
import { emptyServiceStatusSource } from "../src/status/service-status.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"
import { allowAllGrowfulAbuseControl } from "./fixtures/abuse-control.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { oauthAuthorization, publicOAuthAccess } from "./fixtures/oauth-access.js"
import { readyProbe } from "./fixtures/readiness.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)

beforeAll(async () => {
  await runMigrations(database)
})

afterAll(async () => {
  await database.destroy()
})

describe("audited HTTP access", () => {
  it("returns connection status while recording pseudonymous credential and token access", async () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse(`audit-http-${randomUUID()}`)
    const growfulToken = generateGrowfulToken()
    const rawStore = new PostgresOAuthStore({
      database,
      encryptionKeyBase64: Buffer.alloc(32, 7).toString("base64"),
    })
    await rawStore.saveTokens({
      authorization: oauthAuthorization(["r:devices:*"]),
      grant: {
        accessToken: "http-audit-access-token",
        expiresInSeconds: 3_600,
        installedAppId,
        refreshToken: "http-audit-refresh-token",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: new Date("2026-07-22T06:00:00.000Z"),
      growfulTokenHash: hashGrowfulToken(growfulToken),
      issuedAt: new Date("2026-07-22T06:00:00.000Z"),
      source: "authorization",
    })
    const store = new AuditedOAuthStore({
      auditSink: new PostgresAuditSink({ database }),
      now: () => new Date("2026-07-22T06:01:00.000Z"),
      store: rawStore,
    })
    const app = createApp({
      abuseControl: allowAllGrowfulAbuseControl,
      authorizationOrigin: "https://api.smartthings.test",
      oauthAccess: publicOAuthAccess,
      readinessProbe: readyProbe,
      redirectOrigin: "https://smartthings.growful.click",
      requestQuota: new GrowfulRequestQuota({
        limit: 1,
        store: new PostgresGrowfulRequestQuotaStore({ database }),
      }),
      serviceStatusSource: emptyServiceStatusSource,
      service: new OAuthService({
        client: new FakeSmartThingsClient(),
        refreshBeforeExpiryMs: 3_600_000,
        refreshLeaseMs: 60_000,
        store,
      }),
      smartThingsAppId: "growful-app",
    })

    // When
    const response = await app.inject({
      headers: { authorization: `Bearer ${growfulToken}` },
      method: "GET",
      url: "/connection",
    })
    const rejectedResponse = await app.inject({
      headers: { authorization: `Bearer ${growfulToken}` },
      method: "GET",
      url: "/connection",
    })
    const subjectHash = hashAuditSubject(installedAppId)
    const events = await database
      .selectFrom("auditEvents")
      .select(["action", "subjectHash"])
      .where("subjectHash", "=", subjectHash)
      .orderBy("sequence")
      .execute()
    await app.close()

    // Then
    expect(response.statusCode).toBe(200)
    expect(rejectedResponse.statusCode).toBe(429)
    expect(rejectedResponse.json()).toEqual({ error: "growful_rate_limited" })
    expect(events).toEqual([
      { action: "connection.authorize", subjectHash },
      { action: "connection.access", subjectHash },
      { action: "token.read", subjectHash },
    ])
    expect(JSON.stringify(events)).not.toContain(installedAppId)
    expect(JSON.stringify(events)).not.toContain(growfulToken)
  })
})
