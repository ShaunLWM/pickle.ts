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

const BASE_URL = "wss://play.cpjourney.net";
const DEFAULT_SECRET = "skip";

type LoginResponse = {
  success: boolean;
  username: string;
  key: string;
  populations: Record<string, number>;
  moderator: boolean;
  buddyWorlds: string[];
};

type GameAuthResponse = {
  success: boolean;
  token?: string;
};

type ServerMessage = {
  action: string;
  args: Record<string, unknown>;
};

export class CpjourneyAdapter extends BaseAdapter {
  readonly id = "CPJourney";

  async login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult> {
    const loginSocket = this.createSocket("/world/login/");

    const result = await new Promise<LoginResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        loginSocket.disconnect();
        reject(new Error("Login timed out"));
      }, 10_000);

      loginSocket.on("connect", () => {
        const secret = options.secret ?? DEFAULT_SECRET;
        const args =
          "token" in options
            ? { username: options.username, token: options.token, secret }
            : {
                username: options.username,
                password: options.password,
                secret,
              };

        loginSocket.emit("message", { action: "login", args });
      });

      loginSocket.on("message", (msg: ServerMessage) => {
        if (msg.action !== "login") return;

        clearTimeout(timeout);
        loginSocket.disconnect();

        const response = msg.args as LoginResponse;

        if (!response.success) {
          reject(new Error("Login failed"));
          return;
        }

        const servers: ServerInfo[] = Object.entries(response.populations).map(
          ([name, population]) => ({ name, population }),
        );

        resolve({
          servers,
          key: response.key,
          username: response.username,
          moderator: response.moderator,
          buddyWorlds: response.buddyWorlds ?? [],
        });
      });

      loginSocket.on("connect_error", (err: Error) => {
        clearTimeout(timeout);
        loginSocket.disconnect();
        reject(new Error(`Login connection failed: ${err.message}`));
      });
    });

    return result;
  }

  async connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket> {
    // Queue step on a fresh login socket (matches browser flow).
    // The original login socket is dead — server disconnects after login response.
    await this.queueForServer(serverName, options);

    // Connect game socket — still needs game_auth in Node.js
    // (browser uses cookies from HTTP polling, not available cross-Manager)
    const gameSocket = this.createSocket(`/world/${serverName.toLowerCase()}/`);
    this.socket = gameSocket;

    await new Promise<void>((resolve, reject) => {
      let authSent = false;

      gameSocket.on("connect", () => {
        gameSocket.emit("message", {
          action: "game_auth",
          args: {
            username: loginResult.username,
            key: loginResult.key,
            createToken: false,
            joinInvis: false,
            takeoverMascot: false,
            token: "",
          },
        });
      });

      gameSocket.on("message", (msg: ServerMessage) => {
        switch (msg.action) {
          case "wait_queue_update": {
            options?.onQueueUpdate?.(msg.args as QueueUpdate);
            break;
          }
          case "game_auth": {
            if (authSent) break;
            authSent = true;

            const response = msg.args as GameAuthResponse;
            if (!response.success) {
              gameSocket.disconnect();
              reject(new Error("Game auth failed"));
              return;
            }

            gameSocket.emit("message", {
              action: "join_server",
              args: {},
            });
            resolve();
            break;
          }
        }
      });

      gameSocket.on("connect_error", (err: Error) => {
        gameSocket.disconnect();
        reject(new Error(`Game connection failed: ${err.message}`));
      });
    });

    return gameSocket;
  }

  private async queueForServer(
    serverName: string,
    options?: ConnectOptions,
  ): Promise<void> {
    const queueSocket = this.createSocket("/world/login/");

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        queueSocket.disconnect();
        reject(new Error("Queue timed out"));
      }, 60_000);

      queueSocket.on("connect", () => {
        queueSocket.emit("message", {
          action: "queue_server_join",
          args: { server: serverName },
        });
      });

      queueSocket.on("message", (msg: ServerMessage) => {
        switch (msg.action) {
          case "wait_queue_update":
            options?.onQueueUpdate?.(msg.args as QueueUpdate);
            break;
          case "queue_server_join":
            clearTimeout(timeout);
            queueSocket.disconnect();
            resolve();
            break;
        }
      });

      queueSocket.once("disconnect", () => {
        clearTimeout(timeout);
        resolve();
      });

      queueSocket.on("connect_error", (err: Error) => {
        clearTimeout(timeout);
        queueSocket.disconnect();
        reject(new Error(`Queue connection failed: ${err.message}`));
      });
    });
  }

  send(action: string, args: Record<string, unknown>): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.emit("message", { action, args });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  override normalizeUser(raw: Record<string, unknown>): RoomUser {
    const { id, username, displayName, joinTime, x, y, frame, walking,
      color, head, face, neck, body, hand, feet, flag, photo,
      ...rest } = raw;
    return {
      ...this.extractAppearance(raw),
      id: id as number,
      username: username as string,
      displayName: displayName as string | undefined,
      joinTime: joinTime as string | undefined,
      x: (x as number) ?? 0,
      y: (y as number) ?? 0,
      frame: (frame as number) ?? 0,
      walking: walking as number | undefined,
      meta: rest,
      _raw: raw,
    };
  }

  override normalizePlayer(raw: Record<string, unknown>): PlayerData {
    const user = raw.user as Record<string, unknown>;
    const normalized = this.normalizeUser(user);
    const { user: _user, coins, rank, inventory, furniture, flooring,
      buddies, buddyRequests, ignores, igloos, ...rest } = raw;
    return {
      ...normalized,
      _raw: raw,
      coins: (coins as number) ?? 0,
      rank: (rank as number) ?? 0,
      inventory: (inventory as number[]) ?? [],
      furniture: (furniture as unknown[]) ?? [],
      flooring: (flooring as unknown[]) ?? [],
      buddies: (user.buddies as Buddy[]) ?? [],
      buddyRequests: (user.buddyRequests as number[]) ?? [],
      ignores: (user.ignores as number[]) ?? [],
      igloos: (igloos as unknown[]) ?? [],
      meta: { ...normalized.meta, ...rest },
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

  override buddyRequestSeen(id: number): void {
    this.send("buddy_request_seen", { id });
  }

  override getBuddy(id: number, type: "buddies" | "buddyRequests"): void {
    this.send("get_buddy", { id, type });
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

  override getAllSlots(): void {
    this.send("get_all_slots", {});
  }

  override getMascots(): void {
    this.send("get_mascots", {});
  }

  override sendPostcard(userId: number, cardId: string): void {
    this.send("send_postcard", { userId, cardId });
  }

  override getStamps(userId: number): void {
    this.send("get_stamps", { userId });
  }

  override getPostcards(): void {
    this.send("get_postcards", {});
  }

  override getIglooOpen(igloo: number): void {
    this.send("get_igloo_open", { igloo });
  }

  override getIgloos(): void {
    this.send("get_igloos", {});
  }

  override getPuffles(userId: number): void {
    this.send("get_puffles", { userId });
  }

  override adoptPuffle(type: number, name: string): void {
    this.send("adopt_puffle", { type, name });
  }

  override getIglooLikes(): void {
    this.send("get_igloo_likes", {});
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

  override getNinja(): void {
    this.send("get_ninja", {});
  }

  override getMats(): void {
    this.send("get_waddles", {});
  }

  override joinMatchmaking(): void {
    this.send("join_matchmaking", {});
  }

  override leaveMatchmaking(): void {
    this.send("leave_matchmaking", {});
  }

  override startGame(): void {
    this.send("start_game", {});
  }

  override selectCard(slot: number): void {
    this.send("select_card", { slot });
  }

  override loadAnimation(animation: string): void {
    this.send("load_animation", { animation });
  }

  override joinMat(waddle: number): void {
    this.send("join_waddle", { waddle });
  }

  private createSocket(path: string): Socket {
    return io(BASE_URL, {
      path,
      parser: msgpackParser,
      transports: ["polling", "websocket"],
      reconnection: false,
    });
  }
}
