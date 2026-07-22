import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import { hashAuditValue } from "../src/audit/audit-event.js"
import { createApp } from "../src/http/app.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"
import { OAuthService } from "../src/oauth/oauth-service.js"
import { PostgresPrivateBetaInviteAccess } from "../src/private-beta/invite-access.js"
import { GrowfulTokenSchema } from "../src/security/growful-token.js"
import { emptyServiceStatusSource } from "../src/status/service-status.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"
import { allowAllGrowfulAbuseControl } from "./fixtures/abuse-control.js"
import { FakeSmartThingsClient } from "./fixtures/fake-smartthings-client.js"
import { testDisclosures } from "./fixtures/oauth-access.js"
import { readyProbe } from "./fixtures/readiness.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const issueOutputSchema = z.object({
  action: z.literal("issue"),
  changed: z.literal(true),
  credentialSecret: z.string().min(43),
  username: z.string(),
})
const revokeOutputSchema = z.object({
  action: z.literal("revoke"),
  changed: z.literal(true),
  revokedConnections: z.literal(1),
  revokedStates: z.literal(0),
  username: z.string(),
})
const listOutputSchema = z.object({
  reviews: z.array(
    z.object({
      revokedAt: z.iso.datetime().nullable(),
      status: z.enum(["active", "revoked"]),
      username: z.string(),
    }),
  ),
})
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const execFileAsync = promisify(execFile)
const scenarioId = randomUUID()
const username = `dynamic-flow-${scenarioId}`
const installedAppId = InstalledAppIdSchema.parse(`dynamic-private-beta-${scenarioId}`)
const operatorId = "operator@example.test"

async function runCli(arguments_: readonly string[]) {
  return execFileAsync("pnpm", ["exec", "tsx", "src/manage-invites.ts", ...arguments_], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  })
}

beforeAll(async () => {
  await runMigrations(database)
  await database.deleteFrom("oauthStates").where("privateBetaUsername", "=", username).execute()
  await database
    .deleteFrom("smartThingsConnections")
    .where("privateBetaUsername", "=", username)
    .execute()
  await database.deleteFrom("privateBetaInvites").where("username", "=", username).execute()
})

afterAll(async () => {
  await database.deleteFrom("oauthStates").where("privateBetaUsername", "=", username).execute()
  await database
    .deleteFrom("smartThingsConnections")
    .where("privateBetaUsername", "=", username)
    .execute()
  await database.deleteFrom("privateBetaInvites").where("username", "=", username).execute()
  await database.destroy()
})

describe("dynamic private beta invitation lifecycle", () => {
  it("rejects both Basic credentials and the issued Growful token immediately after revocation", async () => {
    // Given
    const issue = issueOutputSchema.parse(
      JSON.parse((await runCli(["issue", username, operatorId, "BETA-3001"])).stdout),
    )
    const inviteAccess = new PostgresPrivateBetaInviteAccess({ configuredInvites: [], database })
    const client = new FakeSmartThingsClient()
    client.exchangeGrant = {
      ...client.exchangeGrant,
      installedAppId,
      scopes: ["r:devices:*"],
    }
    const store = new PostgresOAuthStore({
      database,
      encryptionKeyBase64: Buffer.alloc(32, 7).toString("base64"),
    })
    const service = new OAuthService({
      accessPolicy: {
        policyVersion: testDisclosures.policyVersion,
        privateBetaAccess: inviteAccess,
      },
      client,
      refreshBeforeExpiryMs: 3_600_000,
      refreshLeaseMs: 120_000,
      stateGenerator: () => "dynamic-private-beta-oauth-state",
      store,
    })
    const app = createApp({
      abuseControl: allowAllGrowfulAbuseControl,
      authorizationOrigin: "https://api.smartthings.test",
      oauthAccess: { ...testDisclosures, inviteAccess, mode: "private_beta" },
      readinessProbe: readyProbe,
      redirectOrigin: "https://smartthings.growful.click",
      serviceStatusSource: emptyServiceStatusSource,
      service,
      smartThingsAppId: "growful-app",
    })
    const basicAuthorization = `Basic ${Buffer.from(`${username}:${issue.credentialSecret}`).toString("base64")}`
    const authenticatedStart = await app.inject({
      headers: { authorization: basicAuthorization },
      method: "GET",
      url: "/oauth/start",
    })
    const redirect = await app.inject({
      headers: {
        authorization: basicAuthorization,
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://smartthings.growful.click",
      },
      method: "POST",
      payload: "deviceRange=all&devicePermissions=read&policyConsent=accepted",
      url: "/oauth/start",
    })
    const authorizationUrl = new URL(redirect.headers.location ?? "")
    const callback = await app.inject({
      method: "GET",
      url: `/oauth/callback?code=dynamic-code&state=${authorizationUrl.searchParams.get("state") ?? ""}`,
    })
    const tokenMatch = /<output data-growful-token>([^<]+)<\/output>/.exec(callback.body)
    const growfulToken = GrowfulTokenSchema.parse(tokenMatch?.[1])
    const connected = await app.inject({
      headers: { authorization: `Bearer ${growfulToken}` },
      method: "GET",
      url: "/connection",
    })
    expect(authenticatedStart.statusCode).toBe(200)
    expect(redirect.statusCode).toBe(302)
    expect(callback.statusCode).toBe(200)
    expect(connected.statusCode).toBe(200)

    // When
    const revoke = revokeOutputSchema.parse(
      JSON.parse((await runCli(["revoke", username, operatorId, "BETA-3002"])).stdout),
    )

    // Then
    const rejectedBasic = await app.inject({
      headers: { authorization: basicAuthorization },
      method: "GET",
      url: "/oauth/start",
    })
    const rejectedToken = await app.inject({
      headers: { authorization: `Bearer ${growfulToken}` },
      method: "GET",
      url: "/connection",
    })
    const list = listOutputSchema.parse(JSON.parse((await runCli(["list"])).stdout))
    const auditEvents = await database
      .selectFrom("auditEvents")
      .select(["action", "actorIdHash", "subjectHash", "ticketHash"])
      .where("subjectHash", "=", hashAuditValue(username))
      .orderBy("sequence")
      .execute()
    await app.close()
    expect(revoke.username).toBe(username)
    expect(rejectedBasic.statusCode).toBe(401)
    expect(rejectedToken.statusCode).toBe(401)
    expect(list.reviews).toContainEqual({
      revokedAt: expect.any(String),
      status: "revoked",
      username,
    })
    expect(auditEvents).toEqual([
      {
        action: "invite.issue",
        actorIdHash: hashAuditValue(operatorId),
        subjectHash: hashAuditValue(username),
        ticketHash: hashAuditValue("BETA-3001"),
      },
      {
        action: "invite.revoke",
        actorIdHash: hashAuditValue(operatorId),
        subjectHash: hashAuditValue(username),
        ticketHash: hashAuditValue("BETA-3002"),
      },
    ])
    expect(JSON.stringify(auditEvents)).not.toContain(issue.credentialSecret)
    expect(JSON.stringify(auditEvents)).not.toContain(operatorId)
  })
})
