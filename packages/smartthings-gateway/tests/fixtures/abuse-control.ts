import type { GrowfulAbuseControl } from "../../src/abuse/abuse-control.js"

export const allowAllGrowfulAbuseControl = {
  getBlock: async () => null,
} satisfies GrowfulAbuseControl
