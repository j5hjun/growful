import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  AuditActionSchema,
  AuditActorTypeSchema,
  AuditEventHashSchema,
  AuditEventIdSchema,
  AuditOperatorIdSchema,
  AuditTicketIdSchema,
  createAuditEvent,
  hashAuditOperatorIdentity,
  hashAuditSubject,
  hashAuditTicketIdentity,
  verifyAuditChain,
} from "../src/audit/audit-event.js"
import { InstalledAppIdSchema } from "../src/oauth/contracts.js"

const firstDraft = {
  action: "connection.authorize",
  actorIdHash: null,
  actorType: "gateway_service",
  affectedCount: 1,
  occurredAt: new Date("2026-07-22T00:00:00.000Z"),
  outcome: "succeeded",
  subjectHash: AuditEventHashSchema.parse("b".repeat(64)),
  ticketHash: null,
} as const
const firstEvent = createAuditEvent(
  firstDraft,
  AuditEventIdSchema.parse("00000000-0000-4000-8000-000000000001"),
  null,
)
const secondEvent = createAuditEvent(
  { ...firstDraft, action: "token.read", occurredAt: new Date("2026-07-22T00:00:01.000Z") },
  AuditEventIdSchema.parse("00000000-0000-4000-8000-000000000002"),
  firstEvent.eventHash,
)
const validRows = [
  { ...firstEvent, sequence: "1" },
  { ...secondEvent, sequence: "2" },
] as const

describe("audit events", () => {
  it("parses and verifies private beta invite lifecycle events", () => {
    // Given
    const issueDraft = {
      action: AuditActionSchema.parse("invite.issue"),
      actorIdHash: AuditEventHashSchema.parse("c".repeat(64)),
      actorType: "operator",
      affectedCount: 1,
      occurredAt: new Date("2026-07-22T00:00:00.000Z"),
      outcome: "succeeded",
      subjectHash: AuditEventHashSchema.parse("b".repeat(64)),
      ticketHash: AuditEventHashSchema.parse("d".repeat(64)),
    } as const
    const issue = createAuditEvent(
      issueDraft,
      AuditEventIdSchema.parse("00000000-0000-4000-8000-000000000010"),
      null,
    )
    const revoke = createAuditEvent(
      {
        ...issueDraft,
        action: AuditActionSchema.parse("invite.revoke"),
        occurredAt: new Date("2026-07-22T00:00:01.000Z"),
      },
      AuditEventIdSchema.parse("00000000-0000-4000-8000-000000000011"),
      issue.eventHash,
    )

    // When
    const result = verifyAuditChain([
      { ...issue, sequence: "1" },
      { ...revoke, sequence: "2" },
    ])

    // Then
    expect(result).toEqual({
      eventCount: 2,
      lastEventHash: revoke.eventHash,
      status: "valid",
    })
  })

  it("recognizes operator block lifecycle events", () => {
    // Given
    const actorType = "operator"
    const actions = ["connection.block", "connection.unblock"]

    // When
    const parsedActor = AuditActorTypeSchema.safeParse(actorType)
    const parsedActions = actions.map((action) => AuditActionSchema.safeParse(action))

    // Then
    expect(parsedActor.success).toBe(true)
    expect(parsedActions.every((action) => action.success)).toBe(true)
  })

  it("pseudonymizes a connection without retaining its raw identifier", () => {
    // Given
    const installedAppId = InstalledAppIdSchema.parse("private-installed-app-id")

    // When
    const subjectHash = hashAuditSubject({ installedAppId })

    // Then
    expect(subjectHash).toMatch(/^[a-f0-9]{64}$/)
    expect(subjectHash).not.toContain(installedAppId)
  })

  it("rejects secret-shaped values at the audit identity hashing boundary", () => {
    // Given
    const operatorId = AuditOperatorIdSchema.parse(randomUUID())
    const ticketId = AuditTicketIdSchema.parse(randomUUID())
    const secretShapedInput = { password: randomUUID() }

    // When
    const actorIdHash = hashAuditOperatorIdentity({ operatorId })
    const ticketHash = hashAuditTicketIdentity({ ticketId })
    const hashSecret = () => hashAuditOperatorIdentity(secretShapedInput as never)

    // Then
    expect(actorIdHash).toMatch(/^[a-f0-9]{64}$/)
    expect(ticketHash).toMatch(/^[a-f0-9]{64}$/)
    expect(hashSecret).toThrow()
  })

  it("binds every audit field and the previous hash into the event hash", () => {
    // Given
    const previousHash = AuditEventHashSchema.parse("a".repeat(64))
    const draft = {
      action: "connection.authorize",
      actorIdHash: null,
      actorType: "gateway_service",
      affectedCount: 1,
      occurredAt: new Date("2026-07-22T00:00:00.000Z"),
      outcome: "succeeded",
      subjectHash: AuditEventHashSchema.parse("b".repeat(64)),
      ticketHash: null,
    } as const

    // When
    const event = createAuditEvent(
      draft,
      AuditEventIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      previousHash,
    )

    // Then
    expect(event).toEqual({
      ...draft,
      eventHash: AuditEventHashSchema.parse(
        "0c2034eecd1dc56244526cc38974a770aa070ea13666050ffc75ea8e02b66528",
      ),
      eventId: "00000000-0000-4000-8000-000000000001",
      previousHash,
    })
  })

  it("binds operator and ticket identities into an operator event hash", () => {
    // Given
    const eventId = AuditEventIdSchema.parse("00000000-0000-4000-8000-000000000009")
    const draft = {
      action: "connection.block",
      actorIdHash: AuditEventHashSchema.parse("c".repeat(64)),
      actorType: "operator",
      affectedCount: 1,
      occurredAt: new Date("2026-07-22T00:00:00.000Z"),
      outcome: "succeeded",
      subjectHash: AuditEventHashSchema.parse("b".repeat(64)),
      ticketHash: AuditEventHashSchema.parse("d".repeat(64)),
    } as const

    // When
    const first = createAuditEvent(draft, eventId, null)
    const otherDraft = {
      ...draft,
      actorIdHash: AuditEventHashSchema.parse("e".repeat(64)),
    } as const
    const second = createAuditEvent(otherDraft, eventId, null)

    // Then
    expect(first.eventHash).not.toBe(second.eventHash)
  })

  it("verifies an ordered audit hash chain", () => {
    // Given
    const rows = validRows

    // When
    const result = verifyAuditChain(rows)

    // Then
    expect(result).toEqual({
      eventCount: 2,
      lastEventHash: secondEvent.eventHash,
      status: "valid",
    })
  })

  it("identifies an event hash mismatch", () => {
    // Given
    const rows = [{ ...firstEvent, eventHash: "c".repeat(64), sequence: "1" }]

    // When
    const result = verifyAuditChain(rows)

    // Then
    expect(result).toEqual({
      reason: "event_hash_mismatch",
      sequence: "1",
      status: "invalid",
    })
  })

  it("identifies a previous hash mismatch", () => {
    // Given
    const rows = [
      validRows[0],
      { ...validRows[1], previousHash: AuditEventHashSchema.parse("d".repeat(64)) },
    ]

    // When
    const result = verifyAuditChain(rows)

    // Then
    expect(result).toEqual({
      reason: "previous_hash_mismatch",
      sequence: "2",
      status: "invalid",
    })
  })

  it("rejects an invalid stored event shape", () => {
    // Given
    const rows = [{ ...validRows[0], actorType: "unknown_actor" }]

    // When
    const result = verifyAuditChain(rows)

    // Then
    expect(result).toEqual({
      reason: "invalid_event",
      sequence: null,
      status: "invalid",
    })
  })

  it("rejects a non-increasing sequence", () => {
    // Given
    const rows = [validRows[0], { ...validRows[1], sequence: "1" }]

    // When
    const result = verifyAuditChain(rows)

    // Then
    expect(result).toEqual({
      reason: "sequence_order_mismatch",
      sequence: "1",
      status: "invalid",
    })
  })
})
