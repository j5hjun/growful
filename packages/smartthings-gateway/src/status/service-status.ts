import { z } from "zod"

export const ServiceIncidentIdSchema = z.uuid().brand("ServiceIncidentId")
export const ServiceIncidentImpactSchema = z.enum(["degraded", "outage"])
export const ServiceIncidentStatusSchema = z.enum(["investigating", "monitoring", "resolved"])
export const ServiceIncidentTitleSchema = z.string().trim().min(1).max(120)
export const ServiceIncidentMessageSchema = z.string().trim().min(1).max(2_000)

export type ServiceIncidentId = z.infer<typeof ServiceIncidentIdSchema>
export type ServiceIncidentImpact = z.infer<typeof ServiceIncidentImpactSchema>
export type ServiceIncidentStatus = z.infer<typeof ServiceIncidentStatusSchema>

export type PublicServiceIncident = {
  readonly id: ServiceIncidentId
  readonly impact: ServiceIncidentImpact
  readonly message: string
  readonly resolvedAt: Date | null
  readonly startedAt: Date
  readonly status: ServiceIncidentStatus
  readonly title: string
  readonly updatedAt: Date
}

export interface ServiceStatusSource {
  listPublicIncidents(): Promise<readonly PublicServiceIncident[]>
}

export const emptyServiceStatusSource: ServiceStatusSource = {
  listPublicIncidents: async () => [],
}
