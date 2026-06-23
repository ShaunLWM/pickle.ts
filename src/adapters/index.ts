import {
  type ConnectionProfileInput,
  resolveConnectionProfile,
} from "../connection-profile.js";
import type { BaseAdapter } from "./base-adapter.js";
import { CpjourneyAdapter } from "./cpjourney-adapter.js";
import { CplegacyAdapter } from "./cplegacy-adapter.js";
import { CpzeroAdapter } from "./cpzero-adapter.js";
import { NewcpAdapter } from "./newcp-adapter.js";
import { PenguinoriginsAdapter } from "./penguinorigins-adapter.js";

const ADAPTERS = {
  CPJourney: CpjourneyAdapter,
  CPLegacy: CplegacyAdapter,
  CPZero: CpzeroAdapter,
  NewCP: NewcpAdapter,
  PenguinOrigins: PenguinoriginsAdapter,
} as const;

export type AdapterName = keyof typeof ADAPTERS;

export function createAdapter(
  name: AdapterName,
  connectionProfile?: ConnectionProfileInput,
): BaseAdapter {
  return new ADAPTERS[name](resolveConnectionProfile(connectionProfile));
}
