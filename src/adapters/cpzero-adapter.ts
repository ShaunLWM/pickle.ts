import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type {
  LoginOptions,
  LoginResult,
  TokenLoginOptions,
} from "../types/adapter-types.js";
import type { PlayerData, RoomUser } from "../types/player-types.js";
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js";

const LOGIN_WS_URL = "wss://server.cpzero.net/login";
const GAME_WS_URL = "wss://server.cpzero.net/sub_zero";
const API_VERSION = "253";
const LOGIN_ZONE = "w1";
const NUL = "\0";

/**
 * CPZero user string field indices.
 * Extended Houdini format with 15 clothing slots (indices 3–17).
 */
const U = {
  ID: 0,
  USERNAME: 1,
  // 2 = agent/approval
  COLOR: 3,
  HEAD: 4,
  FACE: 5,
  NECK: 6,
  BODY: 7,
  HAND: 8,
  BACK: 9,
  BODY2: 10,
  HAND2: 11,
  BEAK: 12,
  HAIR: 13,
  FEET: 14,
  MOUNT: 15,
  FLAG: 16,
  PHOTO: 17,
  X: 18,
  Y: 19,
  FRAME: 20,
  // 21 = member
  RANK: 22,
} as const;

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

/** MD5 then swap the two 16-char halves — classic Houdini password hash. */
function swapMD5(input: string): string {
  const hash = md5(input);
  return hash.substring(16, 32) + hash.substring(0, 16);
}

function int(v: string | undefined): number {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parse a pipe-delimited user string into a keyed object.
 * Example: `32924|kingofxiaomi|1|15|674|0|0|...|x|y|frame|...`
 */
function parseUserString(str: string): Record<string, unknown> {
  const f = str.split("|");
  return {
    id: int(f[U.ID]),
    username: f[U.USERNAME] ?? "",
    color: int(f[U.COLOR]),
    head: int(f[U.HEAD]),
    face: int(f[U.FACE]),
    neck: int(f[U.NECK]),
    body: int(f[U.BODY]),
    hand: int(f[U.HAND]),
    back: int(f[U.BACK]),
    body2: int(f[U.BODY2]),
    hand2: int(f[U.HAND2]),
    beak: int(f[U.BEAK]),
    hair: int(f[U.HAIR]),
    feet: int(f[U.FEET]),
    mount: int(f[U.MOUNT]),
    flag: int(f[U.FLAG]),
    photo: int(f[U.PHOTO]),
    x: int(f[U.X]),
    y: int(f[U.Y]),
    frame: int(f[U.FRAME]),
    rank: int(f[U.RANK]),
  };
}

/**
 * Minimal Socket-like wrapper around a raw WebSocket.
 * Emits `"message"` with `{ action, args }` payloads so the Client class
 * can consume CPZero messages identically to Socket.IO adapters.
 */
class SmartFoxSocket extends EventEmitter {
  private ws: WebSocket;
  private _closed = false;
  private _buffering = true;
  private _buffer: { action: string; args: Record<string, unknown> }[] = [];

  constructor(ws: WebSocket) {
    super();
    this.ws = ws;

    ws.on("close", () => {
      this._closed = true;
      this.emit("disconnect");
    });

    ws.on("error", (err) => {
      this.emit("connect_error", err);
    });
  }

  /** Emit a `"message"` event with the standard `{ action, args }` shape. */
  dispatchMessage(action: string, args: Record<string, unknown>): void {
    if (this._buffering) {
      this._buffer.push({ action, args });
    }
    this.emit("message", { action, args });
  }

  /**
   * Stop buffering and replay all buffered messages on the next microtask.
   * This gives the Client time to attach its `socket.on("message", ...)` listener
   * after `connect()` resolves.
   */
  flush(): void {
    this._buffering = false;
    const buffered = this._buffer;
    this._buffer = [];
    setTimeout(() => {
      for (const msg of buffered) {
        this.emit("message", msg);
      }
    }, 0);
  }

  send(data: string): void {
    if (!this._closed) this.ws.send(data + NUL);
  }

  disconnect(): void {
    if (!this._closed) {
      this._closed = true;
      this.ws.close();
    }
  }

  get connected(): boolean {
    return !this._closed && this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Map `%xt%` command names to the normalized action + args shape
 * that the Client class expects.
 */
function translateXt(
  cmd: string,
  parts: string[],
): { action: string; args: Record<string, unknown> } | null {
  switch (cmd) {
    case "lp": {
      // load_player: parts[0] = user string, parts[1..] = extra fields
      const user = parseUserString(parts[0] ?? "");
      const coins = int(parts[1]);
      const rank = user.rank as number;
      return {
        action: "load_player",
        args: { user, coins, rank },
      };
    }

    case "jr": {
      // join_room: parts[0] = roomId, parts[1..] = user strings
      const room = int(parts[0]);
      const users = parts.slice(1).filter(Boolean).map(parseUserString);
      return { action: "join_room", args: { room, users } };
    }

    case "ap": {
      // add_player: single user string
      const user = parseUserString(parts[0] ?? "");
      return { action: "add_player", args: { user } };
    }

    case "rp": {
      // remove_player: user id
      return { action: "remove_player", args: { user: int(parts[0]) } };
    }

    case "sp": {
      // send_position: userId, x, y
      return {
        action: "send_position",
        args: { id: int(parts[0]), x: int(parts[1]), y: int(parts[2]) },
      };
    }

    case "sf": {
      // send_frame: userId, frame
      return {
        action: "send_frame",
        args: { id: int(parts[0]), frame: int(parts[1]) },
      };
    }

    case "sm": {
      // send_message: userId, message
      return {
        action: "send_message",
        args: { id: int(parts[0]), message: parts[1] ?? "" },
      };
    }

    case "se": {
      // send_emote: userId, emote
      return {
        action: "send_emote",
        args: { id: int(parts[0]), emote: int(parts[1]) },
      };
    }

    case "sa": {
      // send_action (safe chat): userId, action
      return {
        action: "send_safe",
        args: { id: int(parts[0]), safe: int(parts[1]) },
      };
    }

    case "sb": {
      // snowball: userId, x, y
      return {
        action: "snowball",
        args: { id: int(parts[0]), x: int(parts[1]), y: int(parts[2]) },
      };
    }

    case "gp": {
      // get_player response: user string
      const user = parseUserString(parts[0] ?? "");
      return { action: "get_player", args: { user } };
    }

    // Equip updates: userId, itemId
    case "upc":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "color" },
      };
    case "uph":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "head" },
      };
    case "upf":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "face" },
      };
    case "upn":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "neck" },
      };
    case "upb":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "body" },
      };
    case "upa":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "hand" },
      };
    case "upe":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "feet" },
      };
    case "upl":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "flag" },
      };
    case "upp":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "photo" },
      };
    case "upba":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "back" },
      };
    case "upm":
      return {
        action: "update_player",
        args: { id: int(parts[0]), item: int(parts[1]), slot: "mount" },
      };

    case "ai": {
      // add_item response: itemId, coins remaining
      return {
        action: "add_item",
        args: { item: int(parts[0]), coins: int(parts[1]) },
      };
    }

    case "jg": {
      // join_game_room
      return { action: "join_game_room", args: { game: int(parts[0]) } };
    }

    case "e": {
      // error
      return { action: "error", args: { error: parts[0] ?? "unknown" } };
    }

    default:
      return null;
  }
}

export class CpzeroAdapter extends BaseAdapter {
  readonly id = "CPZero";
  private sfs: SmartFoxSocket | null = null;

  async login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult> {
    if ("token" in options) {
      throw new Error("CPZero does not support token login");
    }

    const loginHash = options.secret;
    if (!loginHash) {
      throw new Error(
        "CPZero requires a pre-computed login hash in options.secret",
      );
    }

    const ws = new WebSocket(LOGIN_WS_URL);
    const result = await new Promise<LoginResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Login timed out"));
      }, 15_000);

      let _rndK = "";

      ws.on("open", () => {
        ws.send(xmlMsg("verChk", "0", `<ver v='${API_VERSION}' />`) + NUL);
      });

      ws.on("message", (raw: Buffer) => {
        const messages = raw.toString("utf-8").split(NUL).filter(Boolean);
        for (const msg of messages) {
          if (
            msg.includes('action="apiOK"') ||
            msg.includes("action='apiOK'")
          ) {
            ws.send(xmlMsg("rndK", "-1", "") + NUL);
            continue;
          }

          const kMatch = msg.match(/<k>(.*?)<\/k>/);
          if (kMatch) {
            _rndK = kMatch[1];
            const loginXml = xmlLogin(options.username, loginHash);
            ws.send(loginXml + NUL);
            continue;
          }

          if (msg.startsWith("%xt%l%")) {
            const xtParts = msg.split("%").filter(Boolean);
            // xt, l, -1, nickString, confirmationKey, ...
            const nickString = xtParts[3] ?? "";
            const confirmationKey = xtParts[4] ?? "";
            const nickFields = nickString.split("|");

            clearTimeout(timeout);
            ws.close();

            const userId = int(nickFields[0]);
            const username = nickFields[2] ?? options.username;
            resolve({
              servers: [{ name: "Sub Zero", population: 0 }],
              key: `${userId}|${nickString}|${confirmationKey}`,
              username,
              moderator: false,
              buddyWorlds: [],
            });
            return;
          }

          if (msg.startsWith("%xt%e%")) {
            clearTimeout(timeout);
            ws.close();
            const errParts = msg.split("%").filter(Boolean);
            reject(
              new Error(`Login failed: error ${errParts[3] ?? "unknown"}`),
            );
            return;
          }
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`Login WS error: ${(err as Error).message}`));
      });

      ws.on("close", () => {
        clearTimeout(timeout);
      });
    });

    return result;
  }

  async connect(
    _serverName: string,
    loginResult: LoginResult,
    _options?: ConnectOptions,
  ): Promise<import("socket.io-client").Socket> {
    // loginResult.key = "userId|nickString|confirmationKey"
    const keyParts = loginResult.key.split("|");
    const userId = keyParts[0] ?? "";
    const nickString = keyParts.slice(1, -1).join("|");
    const confirmationKey = keyParts[keyParts.length - 1] ?? "";
    const loginKey = nickString.split("|")[3] ?? "";

    const ws = new WebSocket(GAME_WS_URL);
    const sfs = new SmartFoxSocket(ws);
    this.sfs = sfs;
    // Store as unknown since SmartFoxSocket is not a Socket.IO Socket
    this.socket = sfs as unknown as import("socket.io-client").Socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Game connection timed out"));
      }, 15_000);

      ws.on("open", () => {
        sfs.send(xmlMsg("verChk", "0", `<ver v='${API_VERSION}' />`));
      });

      ws.on("message", (raw: Buffer) => {
        const messages = raw.toString("utf-8").split(NUL).filter(Boolean);
        for (const msg of messages) {
          // XML phase
          if (
            msg.includes('action="apiOK"') ||
            msg.includes("action='apiOK'")
          ) {
            sfs.send(xmlMsg("rndK", "-1", ""));
            continue;
          }

          const kMatch = msg.match(/<k>(.*?)<\/k>/);
          if (kMatch) {
            const rndK = kMatch[1];
            const gamePword = `${swapMD5(loginKey + rndK)}${loginKey}#${confirmationKey}`;
            sfs.send(xmlGameLogin(nickString, gamePword));
            continue;
          }

          // xt phase — may contain multiple messages concatenated
          if (msg.startsWith("%xt%")) {
            this.processXtBatch(msg, sfs);

            // Detect login success and send join_server
            if (msg.includes("%xt%l%")) {
              sfs.send(`%xt%s%j#js%-1%${userId}%${loginKey}%en%`);
            }

            // Resolve once we get load_player + join_room
            if (msg.includes("%xt%jr%")) {
              clearTimeout(timeout);
              resolve();
            }
          }

          if (msg.includes("%xt%e%")) {
            clearTimeout(timeout);
            ws.close();
            const errParts = msg.split("%").filter(Boolean);
            reject(
              new Error(`Game auth failed: error ${errParts[3] ?? "unknown"}`),
            );
            return;
          }
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Game WS error: ${(err as Error).message}`));
      });
    });

    // Wire up ongoing message handling
    ws.on("message", (raw: Buffer) => {
      const messages = raw.toString("utf-8").split(NUL).filter(Boolean);
      for (const msg of messages) {
        if (msg.startsWith("%xt%")) {
          this.processXtBatch(msg, sfs);
        }
      }
    });

    // Replay buffered load_player/join_room messages after the Client attaches its listener
    sfs.flush();

    // Cast to Socket — Client only uses .on("message") / .on("disconnect") / .off()
    return sfs as unknown as import("socket.io-client").Socket;
  }

  send(action: string, args: Record<string, unknown>): void {
    if (!this.sfs) throw new Error("Not connected");
    const xt = actionToXt(action, args);
    if (xt) this.sfs.send(xt);
  }

  disconnect(): void {
    this.sfs?.disconnect();
    this.sfs = null;
    this.socket = null;
  }

  override normalizeUser(raw: Record<string, unknown>): RoomUser {
    return {
      ...this.extractAppearance(raw),
      id: raw.id as number,
      username: raw.username as string,
      x: (raw.x as number) ?? 0,
      y: (raw.y as number) ?? 0,
      frame: (raw.frame as number) ?? 0,
      meta: {
        back: raw.back,
        body2: raw.body2,
        hand2: raw.hand2,
        beak: raw.beak,
        hair: raw.hair,
        mount: raw.mount,
        rank: raw.rank,
      },
      _raw: raw,
    };
  }

  override normalizePlayer(raw: Record<string, unknown>): PlayerData {
    const user = raw.user as Record<string, unknown>;
    return {
      ...this.normalizeUser(user),
      _raw: raw,
      coins: (raw.coins as number) ?? 0,
      rank: (user.rank as number) ?? 0,
      inventory: [],
      buddies: [],
      ignores: [],
    };
  }

  override sendMessage(message: string): void {
    if (!this.sfs) throw new Error("Not connected");
    const userId = 0; // Server ignores the sent userId for own messages
    this.sfs.send(`%xt%s%m#sm%-1%${userId}%${message}%`);
  }

  override sendEmote(emote: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%u#se%-1%${emote}%`);
  }

  override sendSafe(safe: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%u#sa%-1%${safe}%`);
  }

  override walk(x: number, y: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%u#sp%-1%${x}%${y}%`);
  }

  override sendFrame(frame: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%u#sf%-1%${frame}%`);
  }

  override snowball(x: number, y: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%u#sb%-1%${x}%${y}%`);
  }

  override joinRoom(room: number, x?: number, y?: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%j#jr%-1%${room}%${x ?? 0}%${y ?? 0}%`);
  }

  override addItem(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%i#ai%-1%${item}%`);
  }

  override equipColor(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#upc%-1%${item}%`);
  }

  override equipHead(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#uph%-1%${item}%`);
  }

  override equipFace(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#upf%-1%${item}%`);
  }

  override equipNeck(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#upn%-1%${item}%`);
  }

  override equipBody(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#upb%-1%${item}%`);
  }

  override equipHand(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#upa%-1%${item}%`);
  }

  override equipFeet(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#upe%-1%${item}%`);
  }

  override equipFlag(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#upl%-1%${item}%`);
  }

  override equipPhoto(item: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%s#upp%-1%${item}%`);
  }

  override getPlayer(id: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%u#gp%-1%${id}%`);
  }

  override joinIgloo(igloo: number, _x?: number, _y?: number): void {
    if (!this.sfs) throw new Error("Not connected");
    this.sfs.send(`%xt%s%j#jp%-1%${igloo}%igloo%`);
  }

  /**
   * Process a batch of `%xt%` messages that may be concatenated in a single
   * WebSocket frame (separated by \0 already split, but multiple %xt% in one string).
   */
  private processXtBatch(raw: string, sfs: SmartFoxSocket): void {
    // Split concatenated xt messages: " %xt%cmd1%...% %xt%cmd2%...%"
    const xtMessages = raw
      .split(/(?=%xt%)/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const xt of xtMessages) {
      const parts = xt.split("%").filter(Boolean);
      // parts: ["xt", cmd, roomId, ...args]
      if (parts[0] !== "xt" || parts.length < 3) continue;

      const cmd = parts[1];
      const xtArgs = parts.slice(3); // skip "xt", cmd, roomId

      const translated = translateXt(cmd, xtArgs);
      if (translated) {
        sfs.dispatchMessage(translated.action, translated.args);
      }
    }
  }
}

// ── XML helpers ──

function xmlMsg(action: string, r: string, body: string): string {
  return `<msg t='sys'><body action='${action}' r='${r}'>${body}</body></msg>`;
}

function xmlLogin(username: string, pword: string): string {
  return xmlMsg(
    "login",
    "0",
    `<login z='${LOGIN_ZONE}'><nick><![CDATA[${username}]]></nick><pword><![CDATA[${pword}]]></pword></login>`,
  );
}

function xmlGameLogin(nick: string, pword: string): string {
  return xmlMsg(
    "login",
    "0",
    `<login z='${LOGIN_ZONE}'><nick><![CDATA[${nick}]]></nick><pword><![CDATA[${pword}]]></pword></login>`,
  );
}

/**
 * Convert a normalized Client action to the raw `%xt%` send format.
 * Only used when called via the generic `send()` method.
 */
function actionToXt(
  action: string,
  args: Record<string, unknown>,
): string | null {
  switch (action) {
    case "send_position":
      return `%xt%s%u#sp%-1%${args.x}%${args.y}%`;
    case "send_frame":
      return `%xt%s%u#sf%-1%${args.frame}%`;
    case "send_message":
      return `%xt%s%m#sm%-1%0%${args.message}%`;
    case "send_emote":
      return `%xt%s%u#se%-1%${args.emote}%`;
    case "send_safe":
      return `%xt%s%u#sa%-1%${args.safe}%`;
    case "snowball":
      return `%xt%s%u#sb%-1%${args.x}%${args.y}%`;
    case "join_room":
      return `%xt%s%j#jr%-1%${args.room}%${args.x ?? 0}%${args.y ?? 0}%`;
    case "add_item":
      return `%xt%s%i#ai%-1%${args.item}%`;
    case "get_player":
      return `%xt%s%u#gp%-1%${args.id}%`;
    default:
      return null;
  }
}
