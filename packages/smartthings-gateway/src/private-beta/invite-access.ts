import { createHash } from "node:crypto"
import type { Kysely } from "kysely"
import type { PrivateBetaInviteIdentity } from "../oauth/contracts.js"
import type { GatewayDatabase } from "../storage/database.js"
import {
  getPrivateBetaInviteUsername,
  matchesPrivateBetaCredentialDigest,
  type PrivateBetaInvite,
  parsePrivateBetaCredentialAttempt,
} from "./invite.js"

export interface PrivateBetaInviteAccess {
  authenticate(authorization: string | undefined): Promise<AuthenticatedPrivateBetaInvite | null>
  isUsernameActive(username: string): Promise<boolean>
  listActiveInvites(): Promise<readonly PrivateBetaInviteIdentity[]>
  resolveActiveInvite(username: string): Promise<ActivePrivateBetaInvite | null>
}

export type ActivePrivateBetaInvite = { readonly generation: string }
export type AuthenticatedPrivateBetaInvite = ActivePrivateBetaInvite & {
  readonly username: string
}

export function getConfiguredPrivateBetaInviteGeneration(invite: PrivateBetaInvite): string {
  return createHash("sha256")
    .update(`configured\0${invite.username}\0${invite.passwordHash}`, "utf8")
    .digest("hex")
}

export class ConfiguredPrivateBetaInviteAccess implements PrivateBetaInviteAccess {
  constructor(private readonly invites: readonly PrivateBetaInvite[]) {}

  async authenticate(
    authorization: string | undefined,
  ): Promise<AuthenticatedPrivateBetaInvite | null> {
    const username = getPrivateBetaInviteUsername(authorization, this.invites)
    if (username === null) return null
    const invite = await this.resolveActiveInvite(username)
    return invite === null ? null : { ...invite, username }
  }

  async isUsernameActive(username: string): Promise<boolean> {
    return (await this.resolveActiveInvite(username)) !== null
  }

  async listActiveInvites(): Promise<readonly PrivateBetaInviteIdentity[]> {
    return this.invites.map((invite) => ({
      generation: getConfiguredPrivateBetaInviteGeneration(invite),
      username: invite.username,
    }))
  }

  async resolveActiveInvite(username: string): Promise<ActivePrivateBetaInvite | null> {
    const invite = this.invites.find((candidate) => candidate.username === username)
    return invite === undefined
      ? null
      : { generation: getConfiguredPrivateBetaInviteGeneration(invite) }
  }
}

export type PostgresPrivateBetaInviteAccessOptions = {
  readonly configuredInvites: readonly PrivateBetaInvite[]
  readonly database: Kysely<GatewayDatabase>
}

export class PostgresPrivateBetaInviteAccess implements PrivateBetaInviteAccess {
  private readonly configuredInvites: readonly PrivateBetaInvite[]
  private readonly database: Kysely<GatewayDatabase>

  constructor(options: PostgresPrivateBetaInviteAccessOptions) {
    this.configuredInvites = options.configuredInvites
    this.database = options.database
  }

  async authenticate(
    authorization: string | undefined,
  ): Promise<AuthenticatedPrivateBetaInvite | null> {
    const attempt = parsePrivateBetaCredentialAttempt(authorization)
    if (attempt === null) {
      return null
    }
    const storedInvite = await this.database
      .selectFrom("privateBetaInvites")
      .select(["generationId", "passwordHash", "revokedAt"])
      .where("username", "=", attempt.username)
      .executeTakeFirst()
    const configuredInvite = this.configuredInvites.find(
      (invite) => invite.username === attempt.username,
    )
    const activeInvite =
      storedInvite === undefined
        ? configuredInvite === undefined
          ? null
          : {
              generation: getConfiguredPrivateBetaInviteGeneration(configuredInvite),
              passwordHash: configuredInvite.passwordHash,
            }
        : storedInvite.revokedAt === null
          ? { generation: storedInvite.generationId, passwordHash: storedInvite.passwordHash }
          : null
    return activeInvite !== null &&
      matchesPrivateBetaCredentialDigest(attempt.credentialDigest, activeInvite.passwordHash)
      ? { generation: activeInvite.generation, username: attempt.username }
      : null
  }

  async isUsernameActive(username: string): Promise<boolean> {
    return (await this.resolveActiveInvite(username)) !== null
  }

  async resolveActiveInvite(username: string): Promise<ActivePrivateBetaInvite | null> {
    const storedInvite = await this.database
      .selectFrom("privateBetaInvites")
      .select(["generationId", "revokedAt"])
      .where("username", "=", username)
      .executeTakeFirst()
    if (storedInvite !== undefined) {
      return storedInvite.revokedAt === null ? { generation: storedInvite.generationId } : null
    }
    const configuredInvite = this.configuredInvites.find((invite) => invite.username === username)
    return configuredInvite === undefined
      ? null
      : { generation: getConfiguredPrivateBetaInviteGeneration(configuredInvite) }
  }

  async listActiveInvites(): Promise<readonly PrivateBetaInviteIdentity[]> {
    const storedInvites = await this.database
      .selectFrom("privateBetaInvites")
      .select(["generationId", "revokedAt", "username"])
      .execute()
    const activeInvites = new Map(
      this.configuredInvites.map((invite) => [
        invite.username,
        getConfiguredPrivateBetaInviteGeneration(invite),
      ]),
    )
    for (const invite of storedInvites) {
      if (invite.revokedAt === null) {
        activeInvites.set(invite.username, invite.generationId)
      } else {
        activeInvites.delete(invite.username)
      }
    }
    return [...activeInvites]
      .map(([username, generation]) => ({ generation, username }))
      .sort((left, right) => left.username.localeCompare(right.username))
  }
}
