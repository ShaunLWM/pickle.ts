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

  send(action: string, args: Record<string, unknown>): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.emit("message", { action, args });
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
      displayName: raw.displayName as string | undefined,
      joinTime: raw.joinTime as string | undefined,
      x: (raw.x as number) ?? 0,
      y: (raw.y as number) ?? 0,
      frame: (raw.frame as number) ?? 0,
      walking: raw.walking as number | undefined,
      meta: {
        hat: raw.hat,
        face_mask: raw.face_mask,
        neck_scarf: raw.neck_scarf,
        body_shirt: raw.body_shirt,
        hand_glove: raw.hand_glove,
        transform: raw.transform,
        walkingPuffleType: raw.walkingPuffleType,
        openSprite: raw.openSprite,
        mascotGiveaway: raw.mascotGiveaway,
        iglooOpen: raw.iglooOpen,
        iglooBounds: raw.iglooBounds,
        igloo_slot: raw.igloo_slot,
        currentLayer: raw.currentLayer,
        fireRank: raw.fireRank,
      },
      _raw: raw,
    };
  }

  override normalizePlayer(raw: Record<string, unknown>): PlayerData {
    const user = raw.user as Record<string, unknown>;
    const normalized = this.normalizeUser(user);
    return {
      ...normalized,
      _raw: raw,
      coins: (raw.coins as number) ?? 0,
      rank: (raw.rank as number) ?? 0,
      inventory: (raw.inventory as number[]) ?? [],
      furniture: (raw.furniture as unknown[]) ?? [],
      flooring: (raw.flooring as unknown[]) ?? [],
      buddies: (user.buddies as Buddy[]) ?? [],
      buddyRequests: (user.buddyRequests as number[]) ?? [],
      ignores: (user.ignores as number[]) ?? [],
      igloos: (user.igloos as unknown[]) ?? [],
      meta: {
        ...normalized.meta,
        settings: user.settings,
        puffleInventory: raw.puffleInventory ?? user.puffleInventory,
        partyCoins: raw.partyCoins ?? user.partyCoins,
        gems: raw.gems ?? user.gems,
        streamer: raw.streamer ?? user.streamer,
        username_verified: raw.username_verified ?? user.username_verified,
        email_verified: raw.email_verified ?? user.email_verified,
        inf_skill_points: raw.inf_skill_points ?? user.inf_skill_points,
        highest_floor_reached:
          raw.highest_floor_reached ?? user.highest_floor_reached,
        towerMeters: raw.towerMeters ?? user.towerMeters,
        towerExperience: raw.towerExperience ?? user.towerExperience,
      },
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
