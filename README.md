# pickle.ts

Type-safe client library for Club Penguin Private Servers.

Built with TypeScript, Socket.IO, and msgpack. Supports multiple CPPS backends through an adapter pattern — ships with CPJourney and CPLegacy support.

## Install

```bash
npm install @shaunlwm/pickle.ts
```

## Quick Start

```typescript
import { Client } from "pickle.ts"

const client = new Client("CPJourney")

const servers = await client.login({
  username: "myuser",
  password: "mypass",
})
// => [{ name: "Blizzard", population: 6 }, { name: "Sleet", population: 3 }, ...]

await client.connect(servers[0].name)

console.log(client.player?.username) // your penguin
console.log(client.room)             // current room id
console.log(client.users.size)       // penguins in room

client.walk(400, 300)
client.sendMessage("hello!")
client.joinRoom(100)

client.disconnect()
```

## API

### `new Client(server, options?)`

Creates a new client instance.

| Param | Type | Description |
|---|---|---|
| `server` | `"CPJourney" \| "CPLegacy"` | CPPS server identifier (strongly typed) |
| `options.debug` | `boolean \| LogFn` | Enable debug logging. Pass `true` for console.log, or a custom function |

```typescript
// default console.log
const client = new Client("CPJourney", { debug: true })

// custom logger
const client = new Client("CPJourney", {
  debug: (msg, ...args) => myLogger.info(msg, ...args)
})
```

### `client.login(options)`

Authenticates and returns the server list with populations.

```typescript
const servers = await client.login({
  username: "user",
  password: "pass",
})
// servers: ServerInfo[] = [{ name: string, population: number }]
```

Also supports token-based login:

```typescript
const servers = await client.login({
  username: "user",
  token: "savedToken",
})
```

### `client.connect(serverName, options?)`

Connects to a game server. Handles queue automatically if the server is full.

```typescript
await client.connect("Blizzard")

// with queue monitoring
await client.connect("Blizzard", {
  onQueueUpdate: ({ position, queueLength }) => {
    console.log(`#${position} of ${queueLength}`)
  }
})
```

After `connect()` resolves, `client.player`, `client.room`, and `client.users` are populated.

### State

| Property | Type | Description |
|---|---|---|
| `client.player` | `PlayerData \| null` | Your penguin's full data (coins, inventory, settings, etc.) |
| `client.room` | `number \| null` | Current room ID |
| `client.users` | `Map<number, RoomUser>` | All penguins in the current room, keyed by ID |
| `client.connected` | `boolean` | Whether the client is connected to a game server |

`client.users` is automatically kept in sync — players are added/removed as they join/leave, positions and equipment update in real-time.

### Actions

```typescript
// Movement
client.walk(x, y)
client.joinRoom(roomId)
client.joinRoom(roomId, spawnX, spawnY)

// Chat
client.sendMessage("hello!")
client.sendEmote(1)          // wave
client.sendSafe(800)         // safe chat message id
client.snowball(x, y)

// Equipment
client.equipColor(1)
client.equipHead(1234)
client.equipFace(5678)
client.equipNeck(9012)
client.equipBody(3456)
client.equipHand(7890)
client.equipFeet(1234)
client.equipFlag(5678)
client.equipPhoto(9012)
client.addItem(itemId)

// Social
client.buddyRequest(userId)
client.buddyAccept(userId)
client.buddyReject(userId)
client.buddyRequestSeen(userId)
client.getBuddy(userId, "buddies")      // fetch buddy details
client.getBuddy(userId, "buddyRequests") // fetch request details
client.removeBuddy(userId)
client.addIgnore(userId)
client.removeIgnore(userId)
client.getPlayer(userId)
client.sendPostcard(userId, "62")  // send mail (costs coins)

// Stamps & Igloos
client.getStamps(userId)           // view stampbook
client.getIglooOpen(userId)        // check if igloo is open
client.joinIgloo(userId)           // enter igloo

// Animation
client.sendFrame(frameId)

// Utility
client.getMascots()
client.getAllSlots()
await client.sleep(2000)  // delay between actions
client.disconnect()
```

### Events

All events are fully typed via `ServerMessages`.

```typescript
client.on("send_message", ({ id, message }) => {
  const user = client.users.get(id)
  console.log(`${user?.username}: ${message}`)
})

client.on("add_player", ({ user }) => {
  console.log(`${user.username} joined the room`)
})

client.on("remove_player", ({ user }) => {
  console.log(`Player ${user} left`)
})

client.on("send_position", ({ id, x, y }) => {
  console.log(`Player ${id} moved to (${x}, ${y})`)
})

client.on("update_player", ({ id, item, slot }) => {
  console.log(`Player ${id} equipped ${item} on ${slot}`)
})

client.on("send_emote", ({ id, emote }) => {
  console.log(`Player ${id} emote ${emote}`)
})

client.on("send_frame", ({ id, frame }) => {
  console.log(`Player ${id} frame ${frame}`)
})

client.on("join_room", ({ room, users }) => {
  console.log(`Joined room ${room} with ${users.length} penguins`)
})

client.on("wait_queue_update", ({ position, queueLength }) => {
  console.log(`Queue: #${position}/${queueLength}`)
})

client.on("kick", ({ reason }) => {
  console.log(`Kicked: ${reason}`)
})

client.on("close_with_error", ({ error }) => {
  console.log(`Disconnected: ${error}`)
})

client.on("buddy_accept", ({ id, username, online }) => {
  console.log(`${username} accepted your buddy request (online: ${online})`)
})

client.on("stamps_result", ({ stamps, username }) => {
  console.log(`${username} has ${stamps.length} stamps`)
})

client.on("disconnect", () => {
  console.log("Connection lost")
})
```

The `kick` event fires on CPLegacy, `close_with_error` on CPJourney — both indicate the server forcibly disconnected the client (e.g. duplicate login). State is automatically cleaned up in both cases.

## Types

All types are exported for external use:

```typescript
import type {
  PlayerData,       // full player data (coins, inventory, settings, buddies, etc.)
  RoomUser,         // player in a room (appearance, position, state)
  PlayerAppearance, // equipment slots (color, head, face, body, etc.)
  PlayerSettings,   // game settings
  Buddy,            // buddy list entry
  Mascot,           // mascot data
  ServerInfo,       // server name + population
  LoginOptions,     // username + password login
  TokenLoginOptions,// username + token login
  LoginResult,      // login response (servers, key, username)
  QueueUpdate,      // queue position update
  ClientMessages,   // all client -> server message types
  ServerMessages,   // all server -> client message types
} from "pickle.ts"
```

## Custom Adapters

To support a different CPPS, extend `BaseAdapter`:

```typescript
import { BaseAdapter } from "pickle.ts"

export class MyServerAdapter extends BaseAdapter {
  readonly id = "MyServer"

  async login(options) { /* your login flow */ }
  async connect(serverName, loginResult, options?) { /* your connect flow */ }
  send(action, args) { /* your packet format */ }
  disconnect() { /* cleanup */ }

  // override any game method if the server uses different packets
  joinRoom(room, x, y) {
    this.send("custom_join", { roomId: room })
  }
}
```

## License

MIT
