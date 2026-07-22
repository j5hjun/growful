import { areScopesWithin } from "./smartthings-scope.js"

export class OAuthScopeMismatchError extends Error {
  override readonly name = "OAuthScopeMismatchError"

  constructor() {
    super("SmartThings returned scopes outside the authorized boundary")
  }
}

export function ensureOAuthScopesWithin(
  scopes: readonly string[],
  allowedScopes: readonly string[],
): void {
  if (!areScopesWithin(scopes, allowedScopes)) {
    throw new OAuthScopeMismatchError()
  }
}
