import { Client } from "../src/index.js";

const USERNAME = process.env.CPJ_USERNAME ?? "";
const PASSWORD = process.env.CPJ_PASSWORD ?? "";

if (!USERNAME || !PASSWORD) {
  console.error("Set CPJ_USERNAME and CPJ_PASSWORD env vars");
  process.exit(1);
}

// Cart Surfer room IDs (navigate: Town → Mine Shack → Mine → Cart Surfer)
const MINE = 808;
const CART_SURFER = 905;

// Client sends its score, server adds it to balance
// From capture: 102 coins in ~36s ≈ 2.83 coins/sec
const COINS_PER_GAME = Number(process.env.COINS ?? "102");
const COINS_PER_SEC = 2.83;
const GAME_DURATION_MS =
  Math.ceil((COINS_PER_GAME / COINS_PER_SEC) * 1000) + 5_000; // proportional + 5s buffer
const BETWEEN_GAMES_MS = 5_000;

const ROUNDS = Number(process.env.ROUNDS ?? "5");

function waitFor<K extends string>(
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

const client = new Client("CPJourney", { debug: true });

const servers = await client.login({ username: USERNAME, password: PASSWORD });
console.log(
  "Servers:",
  servers.map((s) => `${s.name} (${s.population})`).join(", "),
);

const server = servers[0];
console.log(`Connecting to ${server.name}...`);
await client.connect(server.name);

console.log(
  `Logged in as: ${client.player?.username} (id: ${client.player?.id})`,
);

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n=== Round ${round}/${ROUNDS} ===`);

  // Navigate to Mine first
  console.log("Joining Mine (808)...");
  client.joinRoom(MINE);
  await waitFor(client, "join_room");
  await client.sleep(1500);

  // Join Cart Surfer game room
  console.log("Joining Cart Surfer (905)...");
  client.joinRoom(CART_SURFER);
  const gameResult = (await waitFor(client, "join_game_room")) as {
    game: number;
  };
  console.log("In game room:", gameResult.game);

  // Simulate playing the game
  console.log(`Playing for ${GAME_DURATION_MS / 1000}s...`);
  await client.sleep(GAME_DURATION_MS);

  // Send game over with coin score
  console.log(`Sending game_over with ${COINS_PER_GAME} coins...`);
  client.gameOver(COINS_PER_GAME);
  const result = (await waitFor(client, "game_over")) as {
    coins: number;
    hasStamps: boolean;
    totalStamps: number;
    collectedStamps: number;
    stampList: string[];
    room: string;
  };

  console.log(
    `Server response: total coins=${result.coins}, stamps=${result.collectedStamps}/${result.totalStamps}`,
  );

  if (round < ROUNDS) {
    console.log(`Waiting ${BETWEEN_GAMES_MS / 1000}s before next round...`);
    await client.sleep(BETWEEN_GAMES_MS);
  }
}

console.log("\nDone! Disconnecting...");
client.disconnect();
