import { Client } from "../src/index.js";

const USERNAME = process.env.CPJ_USERNAME ?? "";
const PASSWORD = process.env.CPJ_PASSWORD ?? "";

if (!USERNAME || !PASSWORD) {
  console.error("Set CPJ_USERNAME and CPJ_PASSWORD env vars");
  process.exit(1);
}

const ICE_RINK = 802;
const GREETINGS = [
  "hello!",
  "hey there!",
  "waddle on!",
  "hi!",
  "sup!",
  "yo!",
  "howdy!",
];
const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const client = new Client("CPJourney");

const servers = await client.login({ username: USERNAME, password: PASSWORD });
console.log(
  "Servers:",
  servers.map((s) => `${s.name} (${s.population})`).join(", "),
);

const server = servers[1];
console.log(`Connecting to ${server.name}...`);
await client.connect(server.name);

console.log(
  `\nLogged in as: ${client.player?.username} (id: ${client.player?.id})`,
);
console.log(`Coins: ${client.player?.coins} | Rank: ${client.player?.rank}`);
console.log(
  `Spawned in room ${client.room} with ${client.users.size} penguins\n`,
);

// --- Event listeners ---

client.on("send_message", ({ id, message }) => {
  const user = client.users.get(id);
  console.log(`[CHAT] ${user?.username ?? id}: ${message}`);
});

client.on("send_position", ({ id, x, y }) => {
  const user = client.users.get(id);
  if (user && user.id !== client.player?.id) {
    console.log(`[MOVE] ${user.username} walked to (${x}, ${y})`);
  }
});

client.on("update_player", ({ id, item, slot }) => {
  const user = client.users.get(id);
  const action = item === 0 ? "removed" : `equipped ${item} on`;
  console.log(`[WEAR] ${user?.username ?? id} ${action} ${slot}`);
});

client.on("add_player", ({ user }) => {
  console.log(
    `[JOIN] ${user.username} entered the room (${client.users.size} total)`,
  );
});

client.on("remove_player", ({ user }) => {
  console.log(
    `[LEFT] Player ${user} left the room (${client.users.size} total)`,
  );
});

client.on("send_emote", ({ id, emote }) => {
  const user = client.users.get(id);
  console.log(`[EMOTE] ${user?.username ?? id} emote #${emote}`);
});

client.on("send_frame", ({ id, frame }) => {
  const user = client.users.get(id);
  if (user && user.id !== client.player?.id) {
    console.log(`[FRAME] ${user.username} frame ${frame}`);
  }
});

// --- Join Ice Rink ---

console.log("Heading to Ice Rink...");
await client.sleep(1500);
client.joinRoom(ICE_RINK);

// Wait for join_room response
await new Promise<void>((resolve) => {
  client.once("join_room", () => resolve());
});

console.log(`\nArrived at room ${client.room}!`);
console.log(`Penguins here (${client.users.size}):`);
for (const [, user] of client.users) {
  console.log(
    `  ${user.username} at (${user.x}, ${user.y}) color=${user.color} hat=${user.hat} head=${user.head} face=${user.face} neck=${user.neck} body=${user.body} hand=${user.hand} feet=${user.feet}`,
  );
}
console.log();

// --- Wander around and say hi ---

const wanderAndChat = async () => {
  for (let i = 0; i < 10; i++) {
    // Walk to a random spot
    const x = rand(200, 1200);
    const y = rand(300, 700);
    console.log(`[BOT] Walking to (${x}, ${y})`);
    client.walk(x, y);

    await client.sleep(rand(3000, 6000));

    // Say a random greeting
    const msg = GREETINGS[rand(0, GREETINGS.length - 1)];
    console.log(`[BOT] Saying: ${msg}`);
    client.sendMessage(msg);

    await client.sleep(rand(2000, 5000));

    // Throw a snowball occasionally
    if (Math.random() > 0.6) {
      const sx = rand(300, 1100);
      const sy = rand(300, 600);
      console.log(`[BOT] Throwing snowball at (${sx}, ${sy})`);
      client.snowball(sx, sy);
      await client.sleep(rand(1000, 2000));
    }

    // Wave emote occasionally
    if (Math.random() > 0.7) {
      console.log("[BOT] Waving!");
      client.sendEmote(1);
      await client.sleep(rand(1000, 2000));
    }
  }

  console.log("\nDone! Disconnecting...");
  client.disconnect();
};

wanderAndChat();
