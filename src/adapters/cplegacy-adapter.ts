import { io, type Socket } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";
import type {
  LoginOptions,
  LoginResult,
  QueueUpdate,
  ServerInfo,
  TokenLoginOptions,
} from "../types/adapter-types.js";
import type { Buddy, PlayerData, RoomUser } from "../types/player-types.js";
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js";

const LOGIN_URL = "https://api.cplegacy.com/login";
const TOKEN_LOGIN_URL = "https://api.cplegacy.com/token_login";
const BROWSER_ORIGIN = "https://play.cplegacy.com";

type LoginResponse = {
  success: boolean;
  username: string;
  key: string;
  populations: Record<string, number>;
  requires2FA: boolean;
  message?: string;
  wantedVersion?: string;
};

type GameAuthResponse = {
  success: boolean;
};

/**
 * Wraps a CPLegacy socket to normalize its positional message format
 * `("message", action, args)` into the `{ action, args }` envelope
 * that the Client class expects.
 */
function wrapSocket(raw: Socket): Socket {
  const original = raw.on.bind(raw);

  raw.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "message") {
      return original(event, (action: unknown, args: unknown) => {
        listener({ action, args: args ?? {} });
      });
    }
    return original(event, listener);
  }) as typeof raw.on;

  return raw;
}

export class CplegacyAdapter extends BaseAdapter {
  readonly id = "CPLegacy";
  private version = "";

  async login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult> {
    const url = "token" in options ? TOKEN_LOGIN_URL : LOGIN_URL;
    const body: Record<string, unknown> =
      "token" in options
        ? { username: options.username, token: options.token }
        : {
            username: options.username,
            password: options.password,
            version: this.version,
          };

    let data = await this.postLogin(url, body);

    // Version negotiation: server returns wantedVersion when ours is stale/empty
    if (!data.success && data.wantedVersion) {
      this.version = data.wantedVersion;
      body.version = this.version;
      data = await this.postLogin(url, body);
    }

    if (!data.success) {
      this.loginMessage = data.message ?? null;
      throw new Error(`Login failed: ${data.message ?? "unknown error"}`);
    }

    const servers: ServerInfo[] = Object.entries(data.populations ?? {}).map(
      ([name, population]) => ({ name, population }),
    );

    return {
      servers,
      key: data.key,
      username: data.username,
      moderator: false,
      buddyWorlds: [],
    };
  }

  async connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket> {
    const wsUrl = `wss://${serverName.toLowerCase()}.server.cplegacy.com`;
    const rawSocket = io(wsUrl, {
      ...this.socketIoOptions(BROWSER_ORIGIN),
      path: "/socket.io/",
      parser: msgpackParser,
      transports: ["websocket"],
      reconnection: false,
    });
    this.socket = rawSocket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        rawSocket.disconnect();
        reject(new Error("Game connection timed out"));
      }, 15_000);

      rawSocket.on("connect", () => {
        rawSocket.emit("message", "game_auth", {
          username: loginResult.username,
          key: loginResult.key,
          createToken: false,
          token: "",
        });
      });

      rawSocket.on(
        "message",
        (action: string, args: Record<string, unknown>) => {
          switch (action) {
            case "wait_queue_update": {
              options?.onQueueUpdate?.(args as unknown as QueueUpdate);
              break;
            }
            case "game_auth": {
              const response = args as unknown as GameAuthResponse;
              if (!response.success) {
                clearTimeout(timeout);
                rawSocket.disconnect();
                reject(new Error("Game auth failed"));
                return;
              }

              // CPLegacy requires explicitly requesting load_player before join_server
              rawSocket.emit("message", "load_player", {});
              rawSocket.emit("message", "join_server", {});
              clearTimeout(timeout);
              resolve();
              break;
            }
          }
        },
      );

      rawSocket.on("connect_error", (err: Error) => {
        clearTimeout(timeout);
        rawSocket.disconnect();
        reject(new Error(`Game connection failed: ${err.message}`));
      });
    });

    // Return wrapped socket so Client receives normalized { action, args } messages
    return wrapSocket(rawSocket);
  }

  send(action: string, args: Record<string, unknown>): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.emit("message", action, args);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  override normalizeUser(raw: Record<string, unknown>): RoomUser {
    return {
      ...this.extractAppearance(raw),
      id: raw.id as number,
      username: raw.username as string,
      displayName: (raw.realUsername as string) ?? (raw.username as string),
      joinTime: raw.joinTime as string | undefined,
      x: (raw.x as number) ?? 0,
      y: (raw.y as number) ?? 0,
      frame: (raw.frame as number) ?? 0,
      walking: (raw.walking as number) ?? undefined,
      meta: {
        internalUsername: raw.username as string,
        approved: raw.approved,
        emailVerified: raw.emailVerified,
        safeChat: raw.safeChat,
        tutorial: raw.tutorial,
        loginStreak: raw.loginStreak,
        walkingColor: raw.walkingColor,
        stampbookColor: raw.stampbookColor,
        stampbookClasp: raw.stampbookClasp,
        stampbookPattern: raw.stampbookPattern,
        ninjaPoints: raw.ninjaPoints,
        highestNinjaRank: raw.highestNinjaRank,
        character: raw.character,
        transformed: raw.transformed,
      },
      _raw: raw,
    };
  }

  override normalizePlayer(raw: Record<string, unknown>): PlayerData {
    const user = raw.user as Record<string, unknown>;
    return {
      ...this.normalizeUser(user),
      _raw: raw,
      coins: (user.coins as number) ?? 0,
      rank: (user.rank as number) ?? 0,
      inventory: (raw.inventory as number[]) ?? [],
      furniture: raw.furniture as Record<string, unknown> | undefined,
      buddies: [],
      buddyRequests:
        (raw.pending as Buddy[] | undefined)?.map((b) => b.id) ?? [],
      ignores: [],
      igloos: (raw.igloos as unknown[]) ?? [],
    };
  }

  override sendMessage(message: string): void {
    this.send("send_message", { message });
  }

  override sendEmote(emote: number): void {
    this.send("send_emote", { emote });
  }

  override sendSafe(safe: number): void {
    this.send("send_safe", { safe });
  }

  override walk(x: number, y: number): void {
    this.send("send_position", { x, y });
  }

  override sendFrame(frame: number, set?: boolean): void {
    this.send("send_frame", { frame, set });
  }

  override snowball(x: number, y: number): void {
    this.send("snowball", { x, y });
  }

  override joinRoom(room: number, x?: number, y?: number): void {
    this.send("join_room", { room, x: x ?? 0, y: y ?? 0 });
  }

  override addItem(item: number): void {
    this.send("add_item", { item });
  }

  override equipColor(item: number): void {
    this.send("update_color", { item });
  }

  override equipHead(item: number): void {
    this.send("update_head", { item });
  }

  override equipFace(item: number): void {
    this.send("update_face", { item });
  }

  override equipNeck(item: number): void {
    this.send("update_neck", { item });
  }

  override equipBody(item: number): void {
    this.send("update_body", { item });
  }

  override equipHand(item: number): void {
    this.send("update_hand", { item });
  }

  override equipFeet(item: number): void {
    this.send("update_feet", { item });
  }

  override equipFlag(item: number): void {
    this.send("update_flag", { item });
  }

  override equipPhoto(item: number): void {
    this.send("update_photo", { item });
  }

  override buddyRequest(id: number): void {
    this.send("buddy_request", { id });
  }

  override buddyAccept(id: number): void {
    this.send("buddy_accept", { id });
  }

  override buddyReject(id: number): void {
    this.send("buddy_reject", { id });
  }

  override removeBuddy(id: number): void {
    this.send("remove_buddy", { id });
  }

  override addIgnore(id: number): void {
    this.send("ignore_add", { id });
  }

  override removeIgnore(id: number): void {
    this.send("ignore_remove", { id });
  }

  override getPlayer(id: number): void {
    this.send("get_player", { id });
  }

  override getStamps(userId: number): void {
    this.send("get_stamps", { userId });
  }

  override getPostcards(): void {
    this.send("get_postcards", {});
  }

  override joinIgloo(igloo: number, x?: number, y?: number): void {
    this.send("join_igloo", { igloo, x: x ?? 0, y: y ?? 0 });
  }

  override gameOver(coins: number): void {
    this.send("game_over", { coins });
  }

  override collectStamp(stamp: number): void {
    this.send("collect_stamp", { stamp });
  }

  private async postLogin(
    url: string,
    body: Record<string, unknown>,
  ): Promise<LoginResponse> {
    const resp = await fetch(url, {
      method: "POST",
      headers: this.connectionHeaders(BROWSER_ORIGIN, {
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify(body),
    });

    return resp.json() as Promise<LoginResponse>;
  }
}
