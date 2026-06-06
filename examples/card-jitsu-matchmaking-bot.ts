import { Client } from "../src/index.js";

const USERNAME = process.env.CPJ_USERNAME ?? "";
const PASSWORD = process.env.CPJ_PASSWORD ?? "";

if (!USERNAME || !PASSWORD) {
  console.error("Set CPJ_USERNAME and CPJ_PASSWORD env vars");
  process.exit(1);
}

const DOJO = 320;
const JOIN_DELAY = 10_000;

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const client = new Client("CPJourney", { debug: true });

await client.login({ username: USERNAME, password: PASSWORD });
console.log("Connecting to Zipline...");
await client.connect("Zipline");
console.log(
  `Logged in as ${client.player?.username} (id: ${client.player?.id})`,
);

// --- State ---

let hand: { slot: number; card: number; uuid: string }[] = [];
let mats: Record<string, (string | null)[]> = {};
let joining = false;
let waitTimer: ReturnType<typeof setTimeout> | null = null;

// --- Mat watching ---

function checkMats(): void {
  if (joining) return;

  for (const [matId, seats] of Object.entries(mats)) {
    const occupied = seats.filter((s) => s !== null);
    // Someone is sitting alone -- start countdown
    if (occupied.length === 1 && occupied[0] !== client.player?.username) {
      if (waitTimer) return; // already waiting
      console.log(
        `[BOT] ${occupied[0]} is waiting on mat ${matId}. Joining in ${JOIN_DELAY / 1000}s if no one else does...`,
      );
      waitTimer = setTimeout(() => {
        waitTimer = null;
        // Re-check: still alone?
        const current = mats[matId];
        const stillAlone =
          current?.filter((s) => s !== null).length === 1 &&
          current.some((s) => s === occupied[0]);
        if (stillAlone && !joining) {
          joinMat(Number(matId));
        }
      }, JOIN_DELAY);
      return;
    }
  }
}

function cancelWaitTimer(): void {
  if (waitTimer) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
}

client.on("update_waddle", ({ waddle, seat, username }) => {
  const key = String(waddle);
  if (!mats[key]) mats[key] = [];
  if (seat >= mats[key].length) mats[key].length = seat + 1;
  mats[key][seat] = username;
  console.log(`[MAT] Mat ${waddle} seat ${seat}: ${username ?? "empty"}`);

  // If both seats filled (someone else joined), cancel our timer
  const occupied = mats[key].filter((s) => s !== null);
  if (occupied.length >= 2) {
    cancelWaitTimer();
  } else {
    checkMats();
  }
});

function joinMat(matId: number): void {
  if (joining) return;
  joining = true;
  console.log(`[BOT] Walking to mat ${matId}...`);
  client.walk(380, 750);
  client.sleep(2000).then(() => {
    console.log(`[BOT] Joining mat ${matId}`);
    client.cardJitsu.joinMat(matId);
  });
}

// --- Card-Jitsu game flow ---

client.on("join_game_room", ({ game }) => {
  console.log(`[GAME] Entered game room ${game}`);
  client.cardJitsu.startGame();
});

client.on("start_game", ({ users }) => {
  console.log("[GAME] Match started!");
  for (const u of users) {
    console.log(`  Seat ${u.seat}: ${u.name} (belt: ${u.belt})`);
  }
});

client.on("set_cards", ({ cards }) => {
  for (const card of cards) {
    const existing = hand.findIndex((c) => c.slot === card.slot);
    if (existing !== -1) {
      hand[existing] = card;
    } else {
      hand.push(card);
    }
  }
  console.log(
    `[HAND] ${hand.map((c) => `slot${c.slot}=card${c.card}`).join(", ")}`,
  );
});

client.on("remove_card", ({ slot }) => {
  hand = hand.filter((c) => c.slot !== slot);
});

client.on("enable_cards", () => {
  if (hand.length === 0) return;
  const delay = rand(2000, 5000);
  console.log(`[BOT] Thinking for ${delay}ms...`);
  client.sleep(delay).then(() => {
    const pick = hand[rand(0, hand.length - 1)];
    console.log(`[BOT] Playing card ${pick.card} at slot ${pick.slot}`);
    client.cardJitsu.selectCard(pick.slot);
  });
});

client.on("round_over", ({ seat0card, seat1card, winner }) => {
  console.log(
    `[ROUND] Seat 0: ${seat0card.element}${seat0card.value} vs Seat 1: ${seat1card.element}${seat1card.value} -> Winner: seat ${winner}`,
  );
});

client.on("game_won", ({ winner, message }) => {
  console.log(`[GAME] ${message} (winner seat: ${winner})`);
  hand = [];
  joining = false;
  cancelWaitTimer();

  // Return to Dojo and resume watching
  client.sleep(3000).then(async () => {
    console.log("[BOT] Returning to Dojo...");
    await client.joinRoom(DOJO);
    console.log("[BOT] Back in Dojo. Watching mats...");
    const data = await client.cardJitsu.getMats();
    mats = data.waddles;
    checkMats();
  });
});

client.on("disconnect", () => {
  console.log("[BOT] Disconnected");
  process.exit(0);
});

// --- Start: go to Dojo and watch ---

await client.sleep(1000);
await client.joinRoom(DOJO);
console.log(`[BOT] Arrived at Dojo. Watching mats...`);

const { waddles: initialMats } = await client.cardJitsu.getMats();
mats = initialMats;
console.log("[BOT] Mat state:", mats);
checkMats();
