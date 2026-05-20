import type { BaseAdapter } from "./base-adapter.js";
import { CpjourneyAdapter } from "./cpjourney-adapter.js";
declare const ADAPTERS: {
    readonly CPJourney: typeof CpjourneyAdapter;
};
export type AdapterName = keyof typeof ADAPTERS;
export declare function createAdapter(name: AdapterName): BaseAdapter;
export {};
//# sourceMappingURL=index.d.ts.map