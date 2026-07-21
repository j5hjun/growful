import type { ServiceDisclosures } from "../../src/config.js"
import type { OAuthAccessPolicy } from "../../src/http/oauth-routes.js"
import type { OAuthAuthorization } from "../../src/oauth/contracts.js"
import type { SmartThingsScope } from "../../src/oauth/smartthings-scope.js"
import type { PrivateBetaInvite } from "../../src/private-beta/invite.js"

export const testDisclosures = {
  operatorName: "Growful Test",
  policyVersion: "test-policy",
  privacyPolicyUrl: new URL("https://smartthings.growful.click/privacy"),
  supportEmail: "support@growful.click",
  termsUrl: new URL("https://smartthings.growful.click/terms"),
} satisfies ServiceDisclosures

export const publicOAuthAccess = {
  ...testDisclosures,
  mode: "public",
} satisfies OAuthAccessPolicy

export function privateBetaOAuthAccess(invites: readonly PrivateBetaInvite[]): OAuthAccessPolicy {
  return { ...testDisclosures, invites, mode: "private_beta" }
}

export function oauthAuthorization(
  requestedScopes: readonly SmartThingsScope[],
  privateBetaUsername: string | null = null,
): OAuthAuthorization {
  return {
    consentedAt: new Date("2026-07-19T00:00:00.000Z"),
    policyVersion: testDisclosures.policyVersion,
    privateBetaUsername,
    requestedScopes,
  }
}
