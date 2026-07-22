import { describe, expect, it } from "vitest"
import { type AuditEventDraft, type AuditSink, hashAuditSubject } from "../src/audit/audit-event.js"
import { AuditedOAuthStore } from "../src/audit/audited-oauth-store.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"
import { GrowfulTokenSchema, hashGrowfulToken } from "../src/security/growful-token.js"
import { MemoryOAuthStore } from "./fixtures/memory-oauth-store.js"
import { oauthAuthorization } from "./fixtures/oauth-access.js"

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEventDraft[] = []

  async append(event: AuditEventDraft): Promise<void> {
    this.events.push(event)
  }
}

async function createFixture() {
  const auditSink = new MemoryAuditSink()
  const store = new MemoryOAuthStore()
  const installedAppId = InstalledAppIdSchema.parse("audited-installed-app")
  const growfulToken = GrowfulTokenSchema.parse(
    `grw_st_${Buffer.alloc(32, 41).toString("base64url")}`,
  )
  await store.saveTokens({
    authorization: oauthAuthorization(["r:devices:*"]),
    grant: {
      accessToken: "audited-access-token",
      expiresInSeconds: 3_600,
      installedAppId,
      refreshToken: "audited-refresh-token",
      scopes: ["r:devices:*"],
      tokenType: "bearer",
    },
    growfulTokenCreatedAt: new Date("2026-07-22T04:00:00.000Z"),
    growfulTokenHash: hashGrowfulToken(growfulToken),
    issuedAt: new Date("2026-07-22T04:00:00.000Z"),
    source: "authorization",
  })
  return {
    auditSink,
    auditedStore: new AuditedOAuthStore({
      auditSink,
      now: () => new Date("2026-07-22T04:01:00.000Z"),
      store,
    }),
    growfulToken,
    installedAppId,
  }
}

describe("AuditedOAuthStore", () => {
  it("records a successful Growful credential authentication", async () => {
    // Given
    const fixture = await createFixture()

    // When
    await fixture.auditedStore.authenticate(hashGrowfulToken(fixture.growfulToken))

    // Then
    expect(fixture.auditSink.events).toMatchObject([
      {
        action: "connection.access",
        actorType: "gateway_service",
        affectedCount: 1,
        occurredAt: new Date("2026-07-22T04:01:00.000Z"),
        outcome: "succeeded",
        subjectHash: hashAuditSubject(fixture.installedAppId),
      },
    ])
  })

  it("records access to decrypted SmartThings tokens", async () => {
    // Given
    const fixture = await createFixture()

    // When
    await fixture.auditedStore.getTokens(fixture.installedAppId)

    // Then
    expect(fixture.auditSink.events).toMatchObject([
      {
        action: "token.read",
        actorType: "gateway_service",
        affectedCount: 1,
        occurredAt: new Date("2026-07-22T04:01:00.000Z"),
        outcome: "succeeded",
        subjectHash: hashAuditSubject(fixture.installedAppId),
      },
    ])
  })
})
