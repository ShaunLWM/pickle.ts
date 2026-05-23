import { Client } from "../src/index.js";

const USERNAME = process.env.CPJ_USERNAME ?? "";
const PASSWORD = process.env.CPJ_PASSWORD ?? "";

if (!USERNAME || !PASSWORD) {
  console.error("Set CPJ_USERNAME and CPJ_PASSWORD env vars");
  process.exit(1);
}

const DELAY_MS = Number(process.env.DELAY ?? "500");
const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_ITEM_COST = Number(process.env.MAX_COST ?? "5000");

// Known unpurchasable item IDs (mascot-exclusive gear, bait traps)
const EXCLUDED_IDS = new Set([
  152,
  161, // Rockhopper's Eyebrows/Beard (mascot-only, cost 65535)
  380367, // Trolling Rookie (cost 999M)
  900000,
  900001,
  900002,
  900064, // Bait items (cost 9.9B)
]);

// Name patterns for items that should never be collected
const EXCLUDED_NAME_PATTERNS = [
  /\bbait\b/i,
  /\bmascot\b/i,
  /\bbot\b$/i, // "StormtrooperBOT", "KananBOT"
  /\bBOT\b/, // exact BOT suffix
  /mascot\s*card/i,
  /mascot\s*player\s*card/i,
  /\bevergreen\b.*\bMASCOT\b/i,
];

type CrumbItem = { name: string; cost: number; type: number };

function isExcluded(id: number, item: CrumbItem): boolean {
  if (EXCLUDED_IDS.has(id)) return true;

  const cost = Number(item.cost) || 0;
  if (cost > MAX_ITEM_COST) return true;

  for (const pattern of EXCLUDED_NAME_PATTERNS) {
    if (pattern.test(item.name)) return true;
  }

  return false;
}

async function fetchCrumbs(): Promise<{
  items: Map<number, CrumbItem>;
  excluded: [number, CrumbItem][];
}> {
  const resp = await fetch(
    "https://cdn.cpjourney.net/assets/media/crumbs/en/crumbs.json",
  );
  const crumbs = (await resp.json()) as Record<
    string,
    Record<string, CrumbItem>
  >;
  const items = new Map<number, CrumbItem>();
  const excluded: [number, CrumbItem][] = [];

  for (const [id, item] of Object.entries(crumbs.items ?? {})) {
    const numId = Number(id);
    if (isExcluded(numId, item)) {
      excluded.push([numId, item]);
    } else {
      items.set(numId, item);
    }
  }

  return { items, excluded };
}

function _waitFor<K extends string>(
  client: Client,
  event: K,
  timeoutMs = 10_000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${event}`)),
      timeoutMs,
    );
    client.once(event as never, (args: unknown) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

// Fetch catalog
console.log("Fetching crumbs catalog...");
const { items: catalog, excluded: excludedItems } = await fetchCrumbs();
console.log(
  `Catalog: ${catalog.size} items | Excluded: ${excludedItems.length} (max cost: ${MAX_ITEM_COST})`,
);
if (excludedItems.length > 0) {
  console.log("Excluded items:");
  for (const [id, item] of excludedItems) {
    console.log(`  ${id}: "${item.name}" (cost: ${item.cost})`);
  }
}

// Login
const client = new Client("CPJourney", { debug: false });
const servers = await client.login({ username: USERNAME, password: PASSWORD });
const server = servers.reduce((a, b) => (a.population < b.population ? a : b));
console.log(`Connecting to ${server.name}...`);
await client.connect(server.name);

const coins = client.player?.coins ?? 0;
const inventory = new Set(client.player?.inventory ?? []);
console.log(
  `Logged in as ${client.player?.username} | Coins: ${coins} | Inventory: ${inventory.size} items`,
);

// Split catalog into free and paid, filter already owned
const free: [number, CrumbItem][] = [];
const paid: [number, CrumbItem][] = [];

for (const [id, item] of catalog) {
  if (inventory.has(id)) continue;
  const cost = Number(item.cost) || 0;
  if (cost === 0) {
    free.push([id, { ...item, cost: 0 }]);
  } else {
    paid.push([id, { ...item, cost }]);
  }
}

// Sort paid by cost ascending (cheapest first)
paid.sort((a, b) => a[1].cost - b[1].cost);

const totalPaidCost = paid.reduce((sum, [, item]) => sum + item.cost, 0);
console.log(`\nFree items to collect: ${free.length}`);
console.log(
  `Paid items to buy: ${paid.length} (total: ${totalPaidCost.toLocaleString()} coins)`,
);

if (DRY_RUN) {
  console.log("\n[DRY RUN] Would collect:");
  console.log(`  ${free.length} free items`);
  console.log(`  Paid items affordable with ${coins} coins:`);
  let budget = coins;
  let count = 0;
  for (const [_id, item] of paid) {
    if (budget < item.cost) break;
    budget -= item.cost;
    count++;
  }
  console.log(
    `  ${count} items, ${(coins - budget).toLocaleString()} coins spent`,
  );
  client.disconnect();
  process.exit(0);
}

// Track results
let collected = 0;
let bought = 0;
let spent = 0;
let currentCoins = coins;
const failed: { id: number; name: string; cost: number; reason: string }[] = [];

async function tryAddItem(id: number, item: CrumbItem): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      failed.push({ id, name: item.name, cost: item.cost, reason: "timeout" });
      resolve(false);
    }, 5_000);

    const onError = (args: { error: number }) => {
      clearTimeout(timeout);
      client.off("add_item" as never, onSuccess);
      failed.push({
        id,
        name: item.name,
        cost: item.cost,
        reason: `error ${args.error}`,
      });
      resolve(false);
    };

    const onSuccess = (args: { item: number; coins: number }) => {
      clearTimeout(timeout);
      client.off("error" as never, onError);
      currentCoins = args.coins;
      resolve(true);
    };

    client.once("add_item" as never, onSuccess);
    client.once("error" as never, onError);
    client.addItem(id);
  });
}

// Phase 1: Collect all free items
if (free.length > 0) {
  console.log(`\n--- Phase 1: Collecting ${free.length} free items ---`);
  for (const [id, item] of free) {
    const ok = await tryAddItem(id, item);
    if (ok) {
      collected++;
      if (collected % 100 === 0) {
        console.log(
          `  [${collected}/${free.length}] last: "${item.name}" (${id})`,
        );
      }
    }
    await client.sleep(DELAY_MS);
  }
  console.log(
    `Free items done: ${collected} collected, ${free.length - collected} failed`,
  );
}

// Phase 2: Buy paid items (cheapest first)
if (paid.length > 0) {
  console.log(`\n--- Phase 2: Buying paid items (cheapest first) ---`);
  console.log(`Starting coins: ${currentCoins}`);

  for (const [id, item] of paid) {
    if (currentCoins < item.cost) {
      console.log(
        `\nOut of coins at ${currentCoins}. Need ${item.cost} for "${item.name}".`,
      );
      break;
    }

    const ok = await tryAddItem(id, item);
    if (ok) {
      bought++;
      spent += item.cost;
      if (bought % 50 === 0) {
        console.log(
          `  [${bought}] "${item.name}" (${item.cost}) | Balance: ${currentCoins}`,
        );
      }
    }
    await client.sleep(DELAY_MS);
  }
  console.log(
    `Paid items done: ${bought} bought, ${spent.toLocaleString()} coins spent, balance: ${currentCoins}`,
  );
}

// Report failures
if (failed.length > 0) {
  console.log(`\n--- Failed items (${failed.length}) ---`);
  for (const f of failed) {
    console.log(`  ${f.id}: "${f.name}" (cost: ${f.cost}) — ${f.reason}`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`Free collected: ${collected}/${free.length}`);
console.log(`Paid bought: ${bought} (${spent.toLocaleString()} coins)`);
console.log(`Failed: ${failed.length}`);
console.log(`Final balance: ${currentCoins}`);

client.disconnect();
