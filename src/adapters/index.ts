import type { BaseAdapter } from "./base-adapter.js"
import { CpjourneyAdapter } from "./cpjourney-adapter.js"
import { CplegacyAdapter } from "./cplegacy-adapter.js"

const ADAPTERS = {
  CPJourney: CpjourneyAdapter,
  CPLegacy: CplegacyAdapter,
} as const

export type AdapterName = keyof typeof ADAPTERS

export function createAdapter(name: AdapterName): BaseAdapter {
  return new ADAPTERS[name]()
}
