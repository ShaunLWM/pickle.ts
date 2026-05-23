import { Client } from "../src/index.js";

const USERNAME = process.env.NCP_USERNAME ?? "";
const PASSWORD = process.env.NCP_PASSWORD ?? "";

if (!USERNAME || !PASSWORD) {
  console.error("Set NCP_USERNAME and NCP_PASSWORD env vars");
  process.exit(1);
}

const TOWN = 100;

const client = new Client("NewCP", { debug: true });

const servers = await client.login({ username: USERNAME, password: PASSWORD });
console.log(
  "Servers:",
  servers.map((s) => `${s.name} (${s.population})`).join(", "),
);

const serverName = process.env.NCP_SERVER ?? servers[0].name;
console.log(`Connecting to ${serverName}...`);
await client.connect(serverName);

console.log(
  `\nLogged in as: ${client.player?.username} (id: ${client.player?.id})`,
);
console.log(`Coins: ${client.player?.coins} | Rank: ${client.player?.rank}`);
console.log(
  `Spawned in room ${client.room} with ${client.users.size} penguins\n`,
);

// Go to Town
console.log("Heading to Town...");
await client.sleep(1000);
client.joinRoom(TOWN);

await new Promise<void>((resolve) => {
  client.once("join_room", () => resolve());
});

console.log(`\n=== TOWN (Room ${client.room}) ===`);
console.log(`Penguins: ${client.users.size}\n`);
for (const [, user] of client.users) {
  console.log(JSON.stringify(user, null, 2));
}

console.log("\nDone! Disconnecting...");
client.disconnect();
