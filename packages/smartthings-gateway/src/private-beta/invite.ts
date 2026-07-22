import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const basicAuthorizationSchema = z.string().regex(/^Basic [A-Za-z0-9+/]+={0,2}$/)
const unavailableInvitePasswordHash = Buffer.alloc(32)

export const PrivateBetaPasswordHashSchema = z.string().regex(/^[0-9a-f]{64}$/)
export const PrivateBetaUsernameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)

const privateBetaInviteSchema = z.object({
  passwordHash: PrivateBetaPasswordHashSchema,
  username: PrivateBetaUsernameSchema,
})

const privateBetaInviteListSchema = z
  .array(privateBetaInviteSchema)
  .min(1)
  .max(100)
  .superRefine((invites, context) => {
    const usernames = new Set<string>()
    for (const invite of invites) {
      if (usernames.has(invite.username)) {
        context.addIssue({
          code: "custom",
          message: "private beta invite usernames must be unique",
          path: [invite.username],
        })
      }
      usernames.add(invite.username)
    }
  })

export type PrivateBetaInvite = Readonly<z.infer<typeof privateBetaInviteSchema>>
export type PrivateBetaCredentialAttempt = {
  readonly passwordHash: string
  readonly username: string
}
export type GeneratedPrivateBetaInviteCredential = {
  readonly password: string
  readonly passwordHash: string
}

export function hashPrivateBetaPassword(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("hex")
}

export function generatePrivateBetaInviteCredential(): GeneratedPrivateBetaInviteCredential {
  const password = randomBytes(32).toString("base64url")
  return { password, passwordHash: hashPrivateBetaPassword(password) }
}

export function matchesPrivateBetaInvite(
  authorization: string | undefined,
  invites: readonly PrivateBetaInvite[],
): boolean {
  return getPrivateBetaInviteUsername(authorization, invites) !== null
}

export function getPrivateBetaInviteUsername(
  authorization: string | undefined,
  invites: readonly PrivateBetaInvite[],
): string | null {
  const attempt = parsePrivateBetaCredentialAttempt(authorization)
  if (attempt === null) {
    return null
  }
  const invite = invites.find((candidate) => candidate.username === attempt.username)
  return matchesPrivateBetaPasswordHash(attempt.passwordHash, invite?.passwordHash) &&
    invite !== undefined
    ? invite.username
    : null
}

export function parsePrivateBetaCredentialAttempt(
  authorization: string | undefined,
): PrivateBetaCredentialAttempt | null {
  const parsedAuthorization = basicAuthorizationSchema.safeParse(authorization)
  if (!parsedAuthorization.success) {
    return null
  }
  const encodedCredentials = parsedAuthorization.data.slice("Basic ".length)
  const decodedCredentials = Buffer.from(encodedCredentials, "base64")
  const canonicalEncoding = decodedCredentials.toString("base64").replace(/=+$/, "")
  if (canonicalEncoding !== encodedCredentials.replace(/=+$/, "")) {
    return null
  }
  const credentials = decodedCredentials.toString("utf8")
  const separatorIndex = credentials.indexOf(":")
  if (separatorIndex < 1) {
    return null
  }
  return {
    passwordHash: hashPrivateBetaPassword(credentials.slice(separatorIndex + 1)),
    username: credentials.slice(0, separatorIndex),
  }
}

export function matchesPrivateBetaPasswordHash(
  passwordHash: string,
  storedPasswordHash: string | undefined,
): boolean {
  const expectedPasswordHash =
    storedPasswordHash === undefined
      ? unavailableInvitePasswordHash
      : Buffer.from(storedPasswordHash, "hex")
  return timingSafeEqual(Buffer.from(passwordHash, "hex"), expectedPasswordHash)
}

export function parsePrivateBetaInvites(serializedInvites: string): readonly PrivateBetaInvite[] {
  let parsedInvites: unknown
  try {
    parsedInvites = JSON.parse(serializedInvites)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new z.ZodError([
        {
          code: "custom",
          message: "private beta invites must be valid JSON",
          path: [],
        },
      ])
    }
    throw error
  }
  return privateBetaInviteListSchema.parse(parsedInvites)
}
