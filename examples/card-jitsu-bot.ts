import { Client } from "../src/index.js";

const USERNAME = process.env.CPJ_USERNAME ?? "";
const PASSWORD = process.env.CPJ_PASSWORD ?? "";

if (!USERNAME || !PASSWORD) {
  console.error("Set CPJ_USERNAME and CPJ_PASSWORD env vars");
  process.exit(1);
}

const DOJO = 320;

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const client = new Client("CPJourney", { debug: true });

await client.login({ username: USERNAME, password: PASSWORD });
console.log("Connecting to Zipline...");
await client.connect("Zipline");
console.log(
  `Logged in as ${client.player?.username} (id: ${client.player?.id})`,
);

// --- Go to Dojo ---

await client.sleep(1000);
client.joinRoom(DOJO);
await new Promise<void>((resolve) => {
  client.once("join_room", () => resolve());
});
console.log(`Arrived at Dojo (room ${client.room})`);

// --- Fetch waddle state ---

client.cardJitsu.getMats();

let waddles: Record<string, (string | null)[]> = {};
await new Promise<void>((resolve) => {
  client.once("get_waddles", (data) => {
    waddles = data.waddles;
    console.log("Waddle state:", waddles);
    resolve();
  });
});

// --- Wait for "join" then track their mat ---

let pendingPlayer: string | null = null;
let joining = false;

console.log('Waiting for someone to say "join"...');

client.on("send_message", ({ id, message }) => {
  const user = client.users.get(id);
  const username = user?.username ?? String(id);
  console.log(`[CHAT] ${username}: ${message}`);

  if (message.trim().toLowerCase() !== "join") return;
  if (id === client.player?.id) return;
  if (joining) return;

  // Check if they're already sitting on a mat
  for (const waddleId of Object.keys(waddles)) {
    const seats = waddles[waddleId];
    if (seats?.includes(username)) {
      console.log(`[BOT] ${username} said join and is on mat ${waddleId}`);
      joinMat(Number(waddleId));
      return;
    }
  }

  // Not on a mat yet -- remember them and wait for update_waddle
  pendingPlayer = username;
  console.log(
    `[BOT] ${username} said join -- waiting for them to sit on a mat`,
  );
});

// --- Track waddle updates ---

client.on("update_waddle", ({ waddle, seat, username }) => {
  const key = String(waddle);
  if (!waddles[key]) waddles[key] = [];
  if (seat >= waddles[key].length) waddles[key].length = seat + 1;
  waddles[key][seat] = username;
  console.log(`[WADDLE] Mat ${waddle} seat ${seat}: ${username ?? "empty"}`);

  // If the pending player just sat down, join their mat
  if (pendingPlayer && username === pendingPlayer) {
    console.log(`[BOT] ${username} sat on mat ${waddle} -- joining`);
    pendingPlayer = null;
    joinMat(waddle);
  }
});

function joinMat(waddleId: number): void {
  if (joining) return;
  joining = true;
  console.log(`[BOT] Walking to waddle ${waddleId}...`);
  client.walk(380, 750);
  client.sleep(2000).then(() => {
    console.log(`[BOT] Joining waddle ${waddleId}`);
    client.cardJitsu.joinMat(waddleId);
  });
}

// --- Card-Jitsu game flow ---

let hand: { slot: number; card: number; uuid: string }[] = [];

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

  // Return to Dojo after a delay
  setTimeout(() => {
    console.log("[BOT] Returning to Dojo...");
    client.joinRoom(DOJO);
    client.once("join_room", () => {
      console.log('[BOT] Back in Dojo. Waiting for "join"...');
      client.cardJitsu.getMats();
      client.once("get_waddles", (data) => {
        waddles = data.waddles;
      });
    });
  }, 3000);
});

client.on("disconnect", () => {
  console.log("[BOT] Disconnected");
  process.exit(0);
});
