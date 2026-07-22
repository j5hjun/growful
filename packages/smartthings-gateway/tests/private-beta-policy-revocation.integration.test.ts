import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  type ConnectionAccessPolicy,
  InstalledAppIdSchema,
  RefreshClaimIdSchema,
} from "../src/oauth/contracts.js"
import { generateGrowfulToken, hashGrowfulToken } from "../src/security/growful-token.js"
import { createDatabase, runMigrations } from "../src/storage/database.js"
import { PostgresOAuthStore } from "../src/storage/postgres-oauth-store.js"
import { oauthAuthorization } from "./fixtures/oauth-access.js"

const testEnvironmentSchema = z.object({ TEST_DATABASE_URL: z.url() })
const { TEST_DATABASE_URL } = testEnvironmentSchema.parse(process.env)
const database = createDatabase(TEST_DATABASE_URL)
const store = new PostgresOAuthStore({
  database,
  encryptionKeyBase64: Buffer.alloc(32, 7).toString("base64"),
})
const issuedAt = new Date("2026-07-22T00:00:00.000Z")

async function seedConnection(installedAppIdValue: string, privateBetaUsername = "private-user") {
  const growfulToken = generateGrowfulToken()
  const installedAppId = InstalledAppIdSchema.parse(installedAppIdValue)
  const accessToken = `${installedAppIdValue}-access`
  await store.saveTokens({
    authorization: oauthAuthorization(["r:devices:*"], privateBetaUsername),
    grant: {
      accessToken,
      expiresInSeconds: 3_600,
      installedAppId,
      refreshToken: `${installedAppIdValue}-refresh`,
      scopes: ["r:devices:*"],
      tokenType: "bearer",
    },
    growfulTokenCreatedAt: issuedAt,
    growfulTokenHash: hashGrowfulToken(growfulToken),
    issuedAt,
    source: "authorization",
  })
  return { accessToken, growfulToken, installedAppId }
}

async function quarantineLegacyConnection(
  installedAppId: ReturnType<typeof InstalledAppIdSchema.parse>,
) {
  await database
    .updateTable("smartThingsConnections")
    .set({
      consentedAt: null,
      policyVersion: null,
      privateBetaInviteGeneration: null,
      privateBetaUsername: null,
    })
    .where("installedAppId", "=", installedAppId)
    .execute()
}

beforeAll(async () => {
  await runMigrations(database)
})

beforeEach(async () => {
  await database.deleteFrom("smartThingsConnections").execute()
})

afterAll(async () => {
  await database.deleteFrom("smartThingsConnections").execute()
  await database.destroy()
})

describe("private beta connection policy revocation", () => {
  it("preserves only a fully null legacy connection in quarantine", async () => {
    // Given
    const { growfulToken, installedAppId } = await seedConnection("legacy-policy-installed-app")
    await quarantineLegacyConnection(installedAppId)

    // When
    const publicPolicy = {
      policyVersion: "test-policy",
      privateBetaUsernames: null,
    } satisfies ConnectionAccessPolicy
    const emptyPrivatePolicy = {
      policyVersion: "test-policy",
      privateBetaUsernames: [],
    } satisfies ConnectionAccessPolicy
    const activePrivatePolicy = {
      policyVersion: "test-policy",
      privateBetaUsernames: ["private-user"],
    } satisfies ConnectionAccessPolicy

    // Then
    await expect(store.revokeUnauthorizedConnections(publicPolicy)).resolves.toBe(0)
    await expect(store.revokeUnauthorizedConnections(emptyPrivatePolicy)).resolves.toBe(0)
    await expect(store.revokeUnauthorizedConnections(activePrivatePolicy)).resolves.toBe(0)
    await expect(store.getTokens(installedAppId)).resolves.not.toBeNull()
    await expect(store.authenticate(hashGrowfulToken(growfulToken))).resolves.toBeNull()
  })

  it("excludes a quarantined legacy connection from due and forced refresh", async () => {
    // Given
    const { accessToken, installedAppId } = await seedConnection("legacy-refresh-installed-app")
    await quarantineLegacyConnection(installedAppId)

    // When / Then
    await expect(
      store.claimTokensForRefresh({
        claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000901"),
        kind: "due",
        leaseMs: 60_000,
        now: issuedAt,
        refreshBeforeExpiryMs: 7_200_000,
      }),
    ).resolves.toBeNull()
    await expect(
      store.claimTokensForRefresh({
        claimId: RefreshClaimIdSchema.parse("00000000-0000-4000-8000-000000000902"),
        expectedAccessToken: accessToken,
        installedAppId,
        kind: "forced",
        leaseMs: 60_000,
        now: issuedAt,
      }),
    ).resolves.toBeNull()
  })

  it("replaces a quarantined legacy row when the installation is reauthorized", async () => {
    // Given
    const legacy = await seedConnection("legacy-reauthorized-installed-app")
    await quarantineLegacyConnection(legacy.installedAppId)
    const replacementGrowfulToken = generateGrowfulToken()

    // When
    await store.saveTokens({
      authorization: oauthAuthorization(
        ["r:devices:*"],
        "replacement-user",
        "replacement-generation",
      ),
      grant: {
        accessToken: "replacement-access",
        expiresInSeconds: 3_600,
        installedAppId: legacy.installedAppId,
        refreshToken: "replacement-refresh",
        scopes: ["r:devices:*"],
        tokenType: "bearer",
      },
      growfulTokenCreatedAt: issuedAt,
      growfulTokenHash: hashGrowfulToken(replacementGrowfulToken),
      issuedAt,
      source: "authorization",
    })

    // Then
    await expect(store.authenticate(hashGrowfulToken(legacy.growfulToken))).resolves.toBeNull()
    await expect(store.authenticate(hashGrowfulToken(replacementGrowfulToken))).resolves.toEqual({
      installedAppId: legacy.installedAppId,
      policyVersion: "test-policy",
      privateBetaInviteGeneration: "replacement-generation",
      privateBetaUsername: "replacement-user",
    })
    await expect(store.getTokens(legacy.installedAppId)).resolves.toMatchObject({
      accessToken: "replacement-access",
      refreshToken: "replacement-refresh",
    })
  })

  it("revokes every current connection when no invitations remain active", async () => {
    // Given
    const { growfulToken } = await seedConnection("private-policy-installed-app")

    // When
    const revokedCount = await store.revokeUnauthorizedConnections({
      policyVersion: "test-policy",
      privateBetaUsernames: [],
    })

    // Then
    expect(revokedCount).toBe(1)
    await expect(store.authenticate(hashGrowfulToken(growfulToken))).resolves.toBeNull()
  })

  it.each([
    { name: "empty invite list", privateBetaUsernames: [] },
    { name: "different active invite", privateBetaUsernames: ["different-user"] },
  ] satisfies readonly {
    readonly name: string
    readonly privateBetaUsernames: readonly string[]
  }[])(
    "revokes a partially populated legacy tuple with $name",
    async ({ privateBetaUsernames }) => {
      // Given
      const { installedAppId } = await seedConnection(
        `partial-legacy-${privateBetaUsernames.length}-installed-app`,
        "inactive-private-user",
      )
      await database
        .updateTable("smartThingsConnections")
        .set({ consentedAt: null, policyVersion: null })
        .where("installedAppId", "=", installedAppId)
        .execute()

      // When
      const revokedCount = await store.revokeUnauthorizedConnections({
        policyVersion: "test-policy",
        privateBetaUsernames,
      })

      // Then
      expect(revokedCount).toBe(1)
      await expect(store.getTokens(installedAppId)).resolves.toBeNull()
    },
  )
})
