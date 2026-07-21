import { createHash, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const basicAuthorizationSchema = z.string().regex(/^Basic [A-Za-z0-9+/]+={0,2}$/)

const privateBetaInviteSchema = z.object({
  passwordHash: z.string().regex(/^[0-9a-f]{64}$/),
  username: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
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

export function matchesPrivateBetaInvite(
  authorization: string | undefined,
  invites: readonly PrivateBetaInvite[],
): boolean {
  const parsedAuthorization = basicAuthorizationSchema.safeParse(authorization)
  if (!parsedAuthorization.success) {
    return false
  }
  const encodedCredentials = parsedAuthorization.data.slice("Basic ".length)
  const decodedCredentials = Buffer.from(encodedCredentials, "base64")
  const canonicalEncoding = decodedCredentials.toString("base64").replace(/=+$/, "")
  if (canonicalEncoding !== encodedCredentials.replace(/=+$/, "")) {
    return false
  }
  const credentials = decodedCredentials.toString("utf8")
  const separatorIndex = credentials.indexOf(":")
  if (separatorIndex < 1) {
    return false
  }
  const username = credentials.slice(0, separatorIndex)
  const passwordHash = createHash("sha256")
    .update(credentials.slice(separatorIndex + 1), "utf8")
    .digest()
  const invite = invites.find((candidate) => candidate.username === username)
  if (invite === undefined) {
    return false
  }
  return timingSafeEqual(passwordHash, Buffer.from(invite.passwordHash, "hex"))
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
