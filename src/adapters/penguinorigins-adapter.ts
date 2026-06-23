import { io, type Socket } from "socket.io-client";
import type {
  LoginOptions,
  LoginResult,
  QueueUpdate,
  TokenLoginOptions,
} from "../types/adapter-types.js";
import type { PlayerData, RoomUser } from "../types/player-types.js";
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js";

const BASE_URL = "https://play.penguinorigins.online";

type LoginResponse = {
  success: boolean;
  message?: string;
  username: string;
  key: string;
  populations: Record<string, number>;
};

type GameAuthResponse = {
  success: boolean;
  token?: string;
};

type ServerMessage = {
  action: string;
  args: Record<string, unknown>;
};

export class PenguinoriginsAdapter extends BaseAdapter {
  readonly id = "PenguinOrigins";

  async login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult> {
    const loginSocket = this.createSocket("/world/login/");

    const result = await new Promise<LoginResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        loginSocket.disconnect();
        reject(new Error("Login timed out"));
      }, 10_000);

      loginSocket.on("connect", () => {
        const action = "token" in options ? "token_login" : "login";
        const args =
          "token" in options
            ? { username: options.username, token: options.token }
            : { username: options.username, password: options.password };

        loginSocket.emit("message", { action, args });
      });

      loginSocket.on("message", (msg: ServerMessage) => {
        if (msg.action !== "login") return;

        clearTimeout(timeout);
        loginSocket.disconnect();

        const response = msg.args as LoginResponse;

        if (!response.success) {
          this.loginMessage = response.message ?? null;
          reject(new Error(response.message ?? "Login failed"));
          return;
        }

        const servers = Object.entries(response.populations).map(
          ([name, population]) => ({ name, population }),
        );

        resolve({
          servers,
          key: response.key,
          username: response.username,
          moderator: false,
          buddyWorlds: [],
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
            createToken: true,
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
      displayName: (raw.nickname as string) ?? (raw.username as string),
      joinTime: raw.joinTime as string | undefined,
      x: (raw.x as number) ?? 0,
      y: (raw.y as number) ?? 0,
      frame: (raw.frame as number) ?? 0,
      meta: {
        toy: raw.toy,
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
      buddies: (raw.buddies as PlayerData["buddies"]) ?? [],
      buddyRequests: (raw.buddyRequests as number[]) ?? [],
      ignores: (raw.ignores as number[]) ?? [],
      igloos: (raw.igloos as unknown[]) ?? [],
      meta: {
        ...normalized.meta,
        postcards: raw.postcards,
        mascots: raw.mascots,
        pets: raw.pets,
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
    this.send("send_frame", { frame, set: set ?? false });
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
    this.send("update_player", { item });
  }

  override equipHead(item: number): void {
    this.send("update_player", { item });
  }

  override equipFace(item: number): void {
    this.send("update_player", { item });
  }

  override equipNeck(item: number): void {
    this.send("update_player", { item });
  }

  override equipBody(item: number): void {
    this.send("update_player", { item });
  }

  override equipHand(item: number): void {
    this.send("update_player", { item });
  }

  override equipFeet(item: number): void {
    this.send("update_player", { item });
  }

  override equipFlag(item: number): void {
    this.send("update_player", { item });
  }

  override equipPhoto(item: number): void {
    this.send("update_player", { item });
  }

  override buddyRequest(id: number): void {
    this.send("buddy_request", { id });
  }

  override buddyAccept(id: number): void {
    this.send("buddy_accept", { id });
  }

  override addIgnore(id: number): void {
    this.send("ignore_add", { id });
  }

  override removeIgnore(id: number): void {
    this.send("ignore_remove", { id });
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

  private createSocket(path: string): Socket {
    return io(BASE_URL, {
      ...this.socketIoOptions(BASE_URL),
      path,
      transports: ["polling", "websocket"],
      reconnection: false,
    });
  }
}
