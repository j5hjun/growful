import { z } from "zod"

export const smartThingsScopes = [
  "r:devices:$",
  "r:devices:*",
  "x:devices:$",
  "x:devices:*",
  "w:devices:$",
  "w:devices:*",
  "r:hubs:*",
  "r:locations:*",
  "w:locations:*",
  "x:locations:*",
  "r:scenes:*",
  "x:scenes:*",
  "r:rules:*",
  "w:rules:*",
] as const

export const SmartThingsScopeSchema = z.enum(smartThingsScopes)

export const SmartThingsScopesSchema = z
  .array(SmartThingsScopeSchema)
  .min(1)
  .refine((scopes) => new Set(scopes).size === scopes.length)

const OAuthScopeTokenSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/)

export const SmartThingsGrantedScopesSchema = z
  .array(OAuthScopeTokenSchema)
  .min(1)
  .refine((scopes) => new Set(scopes).size === scopes.length)

export const SmartThingsGrantedScopeStringSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(/\s+/))
  .pipe(SmartThingsGrantedScopesSchema)

export const SmartThingsScopeStringSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(/\s+/))
  .pipe(SmartThingsScopesSchema)

export type SmartThingsScope = z.infer<typeof SmartThingsScopeSchema>

const allDeviceScopeBySelectedDeviceScope: Partial<Record<SmartThingsScope, SmartThingsScope>> = {
  "r:devices:$": "r:devices:*",
  "w:devices:$": "w:devices:*",
  "x:devices:$": "x:devices:*",
}

export function serializeSmartThingsScopes(scopes: readonly string[]): string {
  return scopes.join(" ")
}

export function areScopesWithin(
  scopes: readonly string[],
  allowedScopes: readonly string[],
): boolean {
  const allowed = new Set(allowedScopes)
  return scopes.every((scope) => {
    const selectableScope = SmartThingsScopeSchema.safeParse(scope)
    const allDeviceScope = selectableScope.success
      ? allDeviceScopeBySelectedDeviceScope[selectableScope.data]
      : undefined
    return allowed.has(scope) || (allDeviceScope !== undefined && allowed.has(allDeviceScope))
  })
}
