import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"

const tokenPrefix = "grw_st_"

export const GrowfulTokenSchema = z
  .string()
  .regex(/^grw_st_[A-Za-z0-9_-]{43}$/)
  .brand("GrowfulToken")
export const GrowfulTokenHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .brand("GrowfulTokenHash")

export type GrowfulToken = z.infer<typeof GrowfulTokenSchema>
export type GrowfulTokenHash = z.infer<typeof GrowfulTokenHashSchema>

type RandomBytes = (size: number) => Buffer

export function generateGrowfulToken(random: RandomBytes = randomBytes): GrowfulToken {
  return GrowfulTokenSchema.parse(`${tokenPrefix}${random(32).toString("base64url")}`)
}

export function hashGrowfulToken(token: GrowfulToken): GrowfulTokenHash {
  return GrowfulTokenHashSchema.parse(createHash("sha256").update(token, "utf8").digest("hex"))
}
