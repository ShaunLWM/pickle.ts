import { CpjourneyAdapter } from "./cpjourney-adapter.js";
const ADAPTERS = {
    CPJourney: CpjourneyAdapter,
};
export function createAdapter(name) {
    return new ADAPTERS[name]();
}
//# sourceMappingURL=index.js.map