import type { ReadinessProbe } from "../../src/health/readiness.js"

export const readyProbe: ReadinessProbe = {
  check: async () => "ready",
}
