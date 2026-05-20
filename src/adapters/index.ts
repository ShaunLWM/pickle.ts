import type { BaseAdapter } from "./base-adapter.js"
import { CpjourneyAdapter } from "./cpjourney-adapter.js"

const ADAPTERS = {
  CPJourney: CpjourneyAdapter,
} as const

export type AdapterName = keyof typeof ADAPTERS

export function createAdapter(name: AdapterName): BaseAdapter {
  return new ADAPTERS[name]()
}
