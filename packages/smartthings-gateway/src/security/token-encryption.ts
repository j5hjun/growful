import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { z } from "zod"

const encryptedValueSchema = z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)])

export class InvalidEncryptedValueError extends Error {
  override readonly name = "InvalidEncryptedValueError"

  constructor() {
    super("Stored token ciphertext is malformed")
  }
}

export class InvalidEncryptionKeyError extends Error {
  override readonly name = "InvalidEncryptionKeyError"

  constructor() {
    super("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key")
  }
}

export function decodeEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, "base64")
  if (key.byteLength !== 32 || key.toString("base64") !== value) {
    throw new InvalidEncryptionKeyError()
  }
  return key
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const initializationVector = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authenticationTag = cipher.getAuthTag()
  return [initializationVector, authenticationTag, ciphertext]
    .map((value) => value.toString("base64url"))
    .join(".")
}

export function decryptSecret(encryptedValue: string, key: Buffer): string {
  const parts = encryptedValueSchema.parse(encryptedValue.split("."))
  const initializationVector = Buffer.from(parts[0], "base64url")
  const authenticationTag = Buffer.from(parts[1], "base64url")
  const ciphertext = Buffer.from(parts[2], "base64url")
  if (
    initializationVector.byteLength !== 12 ||
    authenticationTag.byteLength !== 16 ||
    initializationVector.toString("base64url") !== parts[0] ||
    authenticationTag.toString("base64url") !== parts[1] ||
    ciphertext.toString("base64url") !== parts[2]
  ) {
    throw new InvalidEncryptedValueError()
  }
  const decipher = createDecipheriv("aes-256-gcm", key, initializationVector, {
    authTagLength: 16,
  })
  decipher.setAuthTag(authenticationTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}
