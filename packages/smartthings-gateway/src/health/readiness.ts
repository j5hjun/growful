export type ReadinessStatus = "ready" | "unavailable"

export type ReadinessProbe = {
  readonly check: () => Promise<ReadinessStatus>
}
