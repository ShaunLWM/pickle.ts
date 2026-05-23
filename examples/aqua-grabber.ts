import { Client } from "../src/index.js";

const USERNAME = process.env.CPJ_USERNAME ?? "";
const PASSWORD = process.env.CPJ_PASSWORD ?? "";

if (!USERNAME || !PASSWORD) {
  console.error("Set CPJ_USERNAME and CPJ_PASSWORD env vars");
  process.exit(1);
}

// Aqua Grabber: room 805 (Iceberg) → room 916 (game)
// Pearl grab can net ~300 coins in ~30s for experienced players
const ICEBERG = 805;
const AQUA_GRABBER = 916;

const COINS_PER_GAME = Number(process.env.COINS ?? "300");
const GAME_DURATION_MS = Number(process.env.GAME_TIME ?? "30") * 1000;
const BETWEEN_GAMES_MS = Number(process.env.PAUSE ?? "10") * 1000;
const ROUNDS = Number(process.env.ROUNDS ?? "5");

function waitFor<K extends string>(
  client: Client,
  event: K,
  timeoutMs = 15_000,
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

// Pick least populated server to avoid queue
const server = servers.reduce((a, b) => (a.population < b.population ? a : b));
console.log(`Connecting to ${server.name} (pop: ${server.population})...`);
await client.connect(server.name);

console.log(
  `Logged in as: ${client.player?.username} (id: ${client.player?.id})`,
);
console.log(
  `Config: ${COINS_PER_GAME} coins, ${GAME_DURATION_MS / 1000}s game, ${BETWEEN_GAMES_MS / 1000}s pause, ${ROUNDS} rounds`,
);

for (let round = 1; round <= ROUNDS; round++) {
  console.log(`\n=== Round ${round}/${ROUNDS} ===`);

  // Navigate to Iceberg
  console.log("Joining Iceberg (805)...");
  client.joinRoom(ICEBERG);
  await waitFor(client, "join_room");
  await client.sleep(1500);

  // Join Aqua Grabber
  console.log("Joining Aqua Grabber (916)...");
  client.joinRoom(AQUA_GRABBER);
  const gameResult = (await waitFor(client, "join_game_room")) as {
    game: number;
  };
  console.log("In game room:", gameResult.game);

  // Simulate playing
  console.log(`Playing for ${GAME_DURATION_MS / 1000}s...`);
  await client.sleep(GAME_DURATION_MS);

  // Send game over
  console.log(`Sending game_over with ${COINS_PER_GAME} coins...`);
  client.gameOver(COINS_PER_GAME);
  const result = (await waitFor(client, "game_over")) as {
    coins: number;
    totalStamps: number;
    collectedStamps: number;
  };

  console.log(
    `Total coins: ${result.coins} (+${COINS_PER_GAME}), stamps: ${result.collectedStamps}/${result.totalStamps}`,
  );

  if (round < ROUNDS) {
    console.log(`Pausing ${BETWEEN_GAMES_MS / 1000}s...`);
    await client.sleep(BETWEEN_GAMES_MS);
  }
}

console.log("\nDone! Disconnecting...");
client.disconnect();
