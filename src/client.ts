import { EventEmitter } from "node:events";
import type { BaseAdapter, ConnectOptions } from "./adapters/base-adapter.js";
import { type AdapterName, createAdapter } from "./adapters/index.js";
import { CardJitsu } from "./games/card-jitsu.js";
import type {
  LoginOptions,
  LoginResult,
  QueueUpdate,
  ServerInfo,
  TokenLoginOptions,
} from "./types/adapter-types.js";
import type { ServerMessages } from "./types/message-types.js";
import type { PlayerData, RoomUser } from "./types/player-types.js";

/** Actions with explicit switch-case handling or typed in ServerMessages — not truly unknown. */
const KNOWN_ACTIONS = new Set<string>([
	// Handled in switch
	"load_player", "join_room", "add_player", "remove_player",
	"send_position", "send_frame", "update_player", "kick", "close_with_error",
	// Typed passthrough (emitted as-is, no state updates needed)
	"send_message", "send_emote", "cpj_ping", "open_sprite", "close_sprite",
	"set_weather", "server_error", "error", "stamp_earned", "game_over",
	"join_game_room", "get_ninja", "get_waddles", "update_waddle",
	"join_matchmaking", "tick_matchmaking", "start_game", "set_cards",
	"add_enemy_cards", "start_round", "enable_cards", "remove_card",
	"move_my_card", "card_effect", "round_over", "play_animation", "game_won",
	"get_player", "buddy_request", "buddy_accept", "buddy_reject",
	"buddy_request_seen", "get_buddy", "send_postcard", "stamps_result",
	"ignore_add", "ignore_remove", "add_item", "get_postcards",
	"get_igloo_open", "get_mascots", "wait_queue_update", "slot",
	"snowball", "send_safe", "stop_walking", "update_table", "transform_player",
	"queue_server_join",
	"disconnect", "unknown_packet",
]);

type ServerMessageHandler<K extends keyof ServerMessages> = (
  args: ServerMessages[K],
) => void;

export type LogFn = (message: string, ...args: unknown[]) => void;

export type ClientOptions = {
  debug?: boolean | LogFn;
};

type MessagePayload = {
  action: string;
  args: Record<string, unknown>;
};

function isMessagePayload(msg: unknown): msg is MessagePayload {
  return (
    typeof msg === "object" && msg !== null && "action" in msg && "args" in msg
  );
}

export class Client extends EventEmitter {
  player: PlayerData | null = null;
  room: number | null = null;
  users: Map<number, RoomUser> = new Map();
  connected = false;

  private adapter: BaseAdapter;
  private loginResult: LoginResult | null = null;
  private log: LogFn | null = null;
  private _cardJitsu: CardJitsu | null = null;

  get cardJitsu(): CardJitsu {
    if (!this._cardJitsu)
      this._cardJitsu = new CardJitsu(this.adapter, this.waitFor.bind(this));
    return this._cardJitsu;
  }

  constructor(server: AdapterName, options?: ClientOptions) {
    super();
    this.adapter = createAdapter(server);

    if (options?.debug) {
      this.log =
        typeof options.debug === "function"
          ? options.debug
          : console.log.bind(console);
    }
  }

  async login(
    options: LoginOptions | TokenLoginOptions,
  ): Promise<ServerInfo[]> {
    this.log?.("[login] logging in as", options.username);
    this.loginResult = await this.adapter.login(options);
    this.log?.("[login] success —", this.loginResult.servers.length, "servers");
    return this.loginResult.servers;
  }

  async connect(serverName: string, options?: ConnectOptions): Promise<void> {
    if (!this.loginResult) throw new Error("Must call login() first");

    this.log?.("[connect] joining", serverName);

    const connectOptions: ConnectOptions = {
      ...options,
      onQueueUpdate: (update: QueueUpdate) => {
        this.log?.("[queue]", `#${update.position}/${update.queueLength}`);
        this.emit("wait_queue_update", update);
        options?.onQueueUpdate?.(update);
      },
    };

    const socket = await this.adapter.connect(
      serverName,
      this.loginResult,
      connectOptions,
    );

    socket.on("message", (msg: unknown) => {
      if (!isMessagePayload(msg)) return;
      this.handleMessage(msg);
    });

    socket.on("disconnect", () => {
      this.log?.("[disconnect] connection lost");
      this.cleanup();
      this.emit("disconnect");
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Waiting for load_player timed out"));
      }, 10_000);

      let playerLoaded = false;
      let roomJoined = false;

      const checkReady = (): void => {
        if (playerLoaded && roomJoined) {
          clearTimeout(timeout);
          this.connected = true;
          resolve();
        }
      };

      const onMessage = (msg: unknown): void => {
        if (!isMessagePayload(msg)) return;
        switch (msg.action) {
          case "load_player":
            playerLoaded = true;
            checkReady();
            break;
          case "join_room":
            roomJoined = true;
            checkReady();
            break;
          case "kick":
            clearTimeout(timeout);
            socket.off("message", onMessage);
            reject(
              new Error(
                `Kicked: ${(msg.args as { reason?: string }).reason ?? "unknown"}`,
              ),
            );
            break;
          case "close_with_error":
            clearTimeout(timeout);
            socket.off("message", onMessage);
            reject(
              new Error(
                `Kicked: ${(msg.args as { error?: string }).error ?? "unknown"}`,
              ),
            );
            break;
          case "error":
            clearTimeout(timeout);
            socket.off("message", onMessage);
            reject(
              new Error(
                `Server error: ${(msg.args as { error?: string | number }).error ?? "unknown"}`,
              ),
            );
            break;
        }
      };

      const onDisconnect = (): void => {
        if (!playerLoaded || !roomJoined) {
          clearTimeout(timeout);
          reject(new Error("Disconnected before fully loaded"));
        }
      };

      socket.on("message", onMessage);
      socket.once("disconnect", onDisconnect);
    });
  }

  on<K extends keyof ServerMessages>(
    event: K,
    listener: ServerMessageHandler<K>,
  ): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  off<K extends keyof ServerMessages>(
    event: K,
    listener: ServerMessageHandler<K>,
  ): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }

  once<K extends keyof ServerMessages>(
    event: K,
    listener: ServerMessageHandler<K>,
  ): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener);
  }

  emit<K extends keyof ServerMessages>(
    event: K,
    args: ServerMessages[K],
  ): boolean;
  emit(event: string, ...args: unknown[]): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  /** Wait for a server event. Resolves with the event payload. Optional timeout in ms. Rejects on disconnect. */
  waitFor<K extends keyof ServerMessages>(
    event: K,
    timeout?: number,
  ): Promise<ServerMessages[K]> {
    return new Promise<ServerMessages[K]>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        this.off(event, handler as unknown as (...args: unknown[]) => void);
        this.off("disconnect", onDisconnect);
      };

      const handler = ((args: ServerMessages[K]) => {
        cleanup();
        resolve(args);
      }) as ServerMessageHandler<K>;

      const onDisconnect = (): void => {
        cleanup();
        reject(new Error(`Disconnected while waiting for ${String(event)}`));
      };

      if (timeout !== undefined) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for ${String(event)}`));
        }, timeout);
      }

      this.once(event, handler);
      this.once("disconnect", onDisconnect);
    });
  }

  sendMessage(message: string): void {
    this.adapter.sendMessage(message);
  }
  sendEmote(emote: number): void {
    this.adapter.sendEmote(emote);
  }
  sendSafe(safe: number): void {
    this.adapter.sendSafe(safe);
  }
  walk(x: number, y: number): void {
    this.adapter.walk(x, y);
  }
  sendFrame(frame: number, set?: boolean): void {
    this.adapter.sendFrame(frame, set);
  }
  snowball(x: number, y: number): void {
    this.adapter.snowball(x, y);
  }
  joinRoom(
    room: number,
    x?: number,
    y?: number,
  ): Promise<ServerMessages["join_room"]> {
    this.adapter.joinRoom(room, x, y);
    return this.waitFor("join_room");
  }
  addItem(item: number): Promise<ServerMessages["add_item"]> {
    this.adapter.addItem(item);
    return this.waitFor("add_item");
  }
  equipColor(item: number): void {
    this.adapter.equipColor(item);
  }
  equipHead(item: number): void {
    this.adapter.equipHead(item);
  }
  equipFace(item: number): void {
    this.adapter.equipFace(item);
  }
  equipNeck(item: number): void {
    this.adapter.equipNeck(item);
  }
  equipBody(item: number): void {
    this.adapter.equipBody(item);
  }
  equipHand(item: number): void {
    this.adapter.equipHand(item);
  }
  equipFeet(item: number): void {
    this.adapter.equipFeet(item);
  }
  equipFlag(item: number): void {
    this.adapter.equipFlag(item);
  }
  equipPhoto(item: number): void {
    this.adapter.equipPhoto(item);
  }
  buddyRequest(id: number): void {
    this.adapter.buddyRequest(id);
  }
  buddyAccept(id: number): Promise<ServerMessages["buddy_accept"]> {
    this.adapter.buddyAccept(id);
    return this.waitFor("buddy_accept");
  }
  buddyReject(id: number): Promise<ServerMessages["buddy_reject"]> {
    this.adapter.buddyReject(id);
    return this.waitFor("buddy_reject");
  }
  buddyRequestSeen(id: number): Promise<ServerMessages["buddy_request_seen"]> {
    this.adapter.buddyRequestSeen(id);
    return this.waitFor("buddy_request_seen");
  }
  getBuddy(
    id: number,
    type: "buddies" | "buddyRequests",
  ): Promise<ServerMessages["get_buddy"]> {
    this.adapter.getBuddy(id, type);
    return this.waitFor("get_buddy");
  }
  removeBuddy(id: number): void {
    this.adapter.removeBuddy(id);
  }
  addIgnore(id: number): Promise<ServerMessages["ignore_add"]> {
    this.adapter.addIgnore(id);
    return this.waitFor("ignore_add");
  }
  removeIgnore(id: number): Promise<ServerMessages["ignore_remove"]> {
    this.adapter.removeIgnore(id);
    return this.waitFor("ignore_remove");
  }
  getPlayer(id: number): Promise<ServerMessages["get_player"]> {
    this.adapter.getPlayer(id);
    return this.waitFor("get_player");
  }
  getAllSlots(): Promise<ServerMessages["slot"]> {
    this.adapter.getAllSlots();
    return this.waitFor("slot");
  }
  getMascots(): Promise<ServerMessages["get_mascots"]> {
    this.adapter.getMascots();
    return this.waitFor("get_mascots");
  }
  sendPostcard(
    userId: number,
    cardId: string,
  ): Promise<ServerMessages["send_postcard"]> {
    this.adapter.sendPostcard(userId, cardId);
    return this.waitFor("send_postcard");
  }
  getStamps(userId: number): Promise<ServerMessages["stamps_result"]> {
    this.adapter.getStamps(userId);
    return this.waitFor("stamps_result");
  }
  getPostcards(): Promise<ServerMessages["get_postcards"]> {
    this.adapter.getPostcards();
    return this.waitFor("get_postcards");
  }
  getIglooOpen(igloo: number): Promise<ServerMessages["get_igloo_open"]> {
    this.adapter.getIglooOpen(igloo);
    return this.waitFor("get_igloo_open");
  }
  joinIgloo(
    igloo: number,
    x?: number,
    y?: number,
  ): Promise<ServerMessages["join_room"]> {
    this.adapter.joinIgloo(igloo, x, y);
    return this.waitFor("join_room");
  }
  gameOver(coins: number): Promise<ServerMessages["game_over"]> {
    this.adapter.gameOver(coins);
    return this.waitFor("game_over");
  }
  collectStamp(stamp: number): Promise<ServerMessages["stamp_earned"]> {
    this.adapter.collectStamp(stamp);
    return this.waitFor("stamp_earned");
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  disconnect(): void {
    this.log?.("[disconnect] closing connection");
    this.adapter.disconnect();
    this.cleanup();
  }

  private cleanup(): void {
    this.connected = false;
    this.player = null;
    this.room = null;
    this.users.clear();
  }

  private handleMessage(msg: MessagePayload): void {
    const { action, args } = msg;
    let emitArgs: unknown = args;

    switch (action) {
      case "load_player": {
        const player = this.adapter.normalizePlayer(args);
        this.player = player;
        emitArgs = { user: player };
        this.log?.(
          "[load_player]",
          player.username,
          `id=${player.id}`,
          `coins=${player.coins}`,
          `inventory=${player.inventory.length}`,
        );
        break;
      }
      case "join_room": {
        const room = args.room as number;
        const rawUsers = args.users as Record<string, unknown>[];
        this.room = room;
        this.users.clear();
        const users: RoomUser[] = [];
        for (const rawUser of rawUsers) {
          const user = this.adapter.normalizeUser(rawUser);
          this.users.set(user.id, user);
          users.push(user);
        }
        emitArgs = { room, users };
        this.log?.("[join_room]", `room=${room}`, `users=${users.length}`);
        break;
      }
      case "add_player": {
        const user = this.adapter.normalizeUser(
          args.user as Record<string, unknown>,
        );
        this.users.set(user.id, user);
        emitArgs = { user };
        this.log?.("[add_player]", user.username, `id=${user.id}`);
        break;
      }
      case "remove_player": {
        const id = args.user as number;
        this.users.delete(id);
        this.log?.("[remove_player]", `id=${id}`);
        break;
      }
      case "send_position": {
        const id = args.id as number;
        const user = this.users.get(id);
        if (user) {
          user.x = args.x as number;
          user.y = args.y as number;
        }
        break;
      }
      case "send_frame": {
        const id = args.id as number;
        const user = this.users.get(id);
        if (user) {
          user.frame = args.frame as number;
        }
        break;
      }
      case "update_player": {
        const id = args.id as number;
        const slot = args.slot as string;
        const item = args.item as number;
        const user = this.users.get(id);
        if (user && slot in user) {
          (user as Record<string, unknown>)[slot] = item;
        }
        break;
      }
      case "kick": {
        const reason = (args as { reason?: string }).reason ?? "unknown";
        this.log?.("[kick]", reason);
        this.cleanup();
        break;
      }
      case "close_with_error": {
        const error = (args as { error?: string }).error ?? "unknown";
        this.log?.("[kick]", error);
        this.cleanup();
        break;
      }
      default: {
        if (!KNOWN_ACTIONS.has(action)) {
          this.log?.(`[unknown_packet]`, action, JSON.stringify(args));
          this.emit("unknown_packet", { action, args });
        }
        break;
      }
    }

    const eventName = action === "error" ? "server_error" : action;
    this.emit(eventName, emitArgs);
  }
}
