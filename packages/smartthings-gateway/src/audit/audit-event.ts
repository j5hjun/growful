import { createHash } from "node:crypto"
import { z } from "zod"
import { type InstalledAppId, InstalledAppIdSchema } from "../oauth/contracts.js"

export const AuditEventHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .brand("AuditEventHash")
export const AuditEventIdSchema = z.uuid().brand("AuditEventId")
export const AuditOperatorIdSchema = z.string().trim().min(1).max(200).brand("AuditOperatorId")
export const AuditTicketIdSchema = z.string().trim().min(1).max(200).brand("AuditTicketId")

export type AuditEventHash = z.infer<typeof AuditEventHashSchema>
export type AuditEventId = z.infer<typeof AuditEventIdSchema>
export type AuditOperatorId = z.infer<typeof AuditOperatorIdSchema>
export type AuditTicketId = z.infer<typeof AuditTicketIdSchema>

const auditOperatorIdentitySchema = z.object({ operatorId: AuditOperatorIdSchema }).strict()
const auditTicketIdentitySchema = z.object({ ticketId: AuditTicketIdSchema }).strict()
const auditSubjectIdentitySchema = z.object({ installedAppId: InstalledAppIdSchema }).strict()
const auditPrivateBetaUsernameIdentitySchema = z
  .object({ username: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/) })
  .strict()
const auditServiceIncidentIdentitySchema = z.object({ incidentId: z.uuid() }).strict()

export const auditActions = [
  "connection.access",
  "connection.authorize",
  "connection.block",
  "connection.disconnect",
  "connection.policy_revoke",
  "connection.token_rotate",
  "connection.unblock",
  "invite.issue",
  "invite.revoke",
  "privacy.delete",
  "status.incident_open",
  "status.incident_resolve",
  "status.incident_update",
  "token.read",
  "token.refresh",
] as const
export const AuditActionSchema = z.enum(auditActions)
export type AuditAction = z.infer<typeof AuditActionSchema>

export const auditActorTypes = ["gateway_service", "operator"] as const
export const AuditActorTypeSchema = z.enum(auditActorTypes)
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>

export const auditOutcomes = ["failed", "succeeded"] as const
export const AuditOutcomeSchema = z.enum(auditOutcomes)
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>

const storedAuditEventFields = {
  action: AuditActionSchema,
  affectedCount: z.number().int().nonnegative().nullable(),
  eventHash: AuditEventHashSchema,
  eventId: AuditEventIdSchema,
  occurredAt: z.date(),
  outcome: AuditOutcomeSchema,
  previousHash: AuditEventHashSchema.nullable(),
  sequence: z.string().regex(/^[1-9][0-9]*$/),
  subjectHash: AuditEventHashSchema.nullable(),
} as const
const storedAuditEventSchema = z.discriminatedUnion("actorType", [
  z.object({
    ...storedAuditEventFields,
    actorIdHash: z.null(),
    actorType: z.literal("gateway_service"),
    ticketHash: z.null(),
  }),
  z.object({
    ...storedAuditEventFields,
    actorIdHash: AuditEventHashSchema,
    actorType: z.literal("operator"),
    ticketHash: AuditEventHashSchema,
  }),
])

type AuditEventDraftFields = {
  readonly action: AuditAction
  readonly affectedCount: number | null
  readonly occurredAt: Date
  readonly outcome: AuditOutcome
  readonly subjectHash: AuditEventHash | null
}
export type AuditEventDraft = AuditEventDraftFields &
  (
    | {
        readonly actorIdHash: null
        readonly actorType: "gateway_service"
        readonly ticketHash: null
      }
    | {
        readonly actorIdHash: AuditEventHash
        readonly actorType: "operator"
        readonly ticketHash: AuditEventHash
      }
  )

export type AuditEvent = AuditEventDraft & {
  readonly eventHash: AuditEventHash
  readonly eventId: AuditEventId
  readonly previousHash: AuditEventHash | null
}

export interface AuditSink {
  append(event: AuditEventDraft): Promise<void>
}

export type AuditChainVerification =
  | {
      readonly eventCount: number
      readonly lastEventHash: AuditEventHash | null
      readonly status: "valid"
    }
  | {
      readonly reason:
        | "event_hash_mismatch"
        | "invalid_event"
        | "previous_hash_mismatch"
        | "sequence_order_mismatch"
      readonly sequence: string | null
      readonly status: "invalid"
    }

export type AuditChainSegmentStart = {
  readonly previousHash: AuditEventHash | null
  readonly previousSequence: string | null
}

export function hashAuditOperatorIdentity(input: {
  readonly operatorId: AuditOperatorId
}): AuditEventHash {
  return hashAuditIdentifier(auditOperatorIdentitySchema.parse(input).operatorId)
}

export function hashAuditTicketIdentity(input: {
  readonly ticketId: AuditTicketId
}): AuditEventHash {
  return hashAuditIdentifier(auditTicketIdentitySchema.parse(input).ticketId)
}

export function hashAuditSubject(input: {
  readonly installedAppId: InstalledAppId
}): AuditEventHash {
  return hashAuditIdentifier(auditSubjectIdentitySchema.parse(input).installedAppId)
}

export function hashAuditPrivateBetaUsername(input: { readonly username: string }): AuditEventHash {
  return hashAuditIdentifier(auditPrivateBetaUsernameIdentitySchema.parse(input).username)
}

export function hashAuditServiceIncident(input: { readonly incidentId: string }): AuditEventHash {
  return hashAuditIdentifier(auditServiceIncidentIdentitySchema.parse(input).incidentId)
}

function hashAuditIdentifier(identifier: string): AuditEventHash {
  return AuditEventHashSchema.parse(createHash("sha256").update(identifier).digest("hex"))
}

export function createAuditEvent(
  draft: AuditEventDraft,
  eventId: AuditEventId,
  previousHash: AuditEventHash | null,
): AuditEvent {
  const canonicalEvent = [
    eventId,
    draft.occurredAt.toISOString(),
    draft.actorType,
    draft.action,
    draft.outcome,
    draft.subjectHash ?? "",
    draft.affectedCount === null ? "" : String(draft.affectedCount),
    previousHash ?? "",
  ]
  if (draft.actorType === "operator") {
    canonicalEvent.push(draft.actorIdHash, draft.ticketHash)
  }
  return {
    ...draft,
    eventHash: AuditEventHashSchema.parse(
      createHash("sha256").update(canonicalEvent.join("|")).digest("hex"),
    ),
    eventId,
    previousHash,
  }
}

export function verifyAuditChain(rows: readonly unknown[]): AuditChainVerification {
  return verifyAuditChainSegment(rows, { previousHash: null, previousSequence: null })
}

export function verifyAuditChainSegment(
  rows: readonly unknown[],
  start: AuditChainSegmentStart,
): AuditChainVerification {
  let previousEvent: z.infer<typeof storedAuditEventSchema> | undefined
  for (const row of rows) {
    const parsed = storedAuditEventSchema.safeParse(row)
    if (!parsed.success) {
      return { reason: "invalid_event", sequence: null, status: "invalid" }
    }
    const event = parsed.data
    const previousSequence = previousEvent?.sequence ?? start.previousSequence
    if (previousSequence !== null && BigInt(event.sequence) <= BigInt(previousSequence)) {
      return {
        reason: "sequence_order_mismatch",
        sequence: event.sequence,
        status: "invalid",
      }
    }
    const expectedPreviousHash = previousEvent?.eventHash ?? start.previousHash
    if (event.previousHash !== expectedPreviousHash) {
      return {
        reason: "previous_hash_mismatch",
        sequence: event.sequence,
        status: "invalid",
      }
    }
    const expectedEvent = createAuditEvent(event, event.eventId, event.previousHash)
    if (event.eventHash !== expectedEvent.eventHash) {
      return {
        reason: "event_hash_mismatch",
        sequence: event.sequence,
        status: "invalid",
      }
    }
    previousEvent = event
  }
  return {
    eventCount: rows.length,
    lastEventHash: previousEvent === undefined ? null : previousEvent.eventHash,
    status: "valid",
  }
}
