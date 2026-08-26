import { EventEmitter } from "node:events";
import type {
  AdapterMessage,
  BaseAdapter,
  ConnectOptions,
} from "./adapters/base-adapter.js";
import { type AdapterName, createAdapter } from "./adapters/index.js";
import type { ConnectionProfileInput } from "./connection-profile.js";
import { ClientOperationError } from "./errors.js";
import { CardJitsu } from "./games/card-jitsu.js";
import { Cppslol } from "./games/cpps-lol.js";
import {
  type ClientDisconnectInfo,
  type ClientOperationOptions,
  DEFAULT_CLIENT_CONNECTION_TIMEOUTS,
} from "./lifecycle.js";
import type {
  LoginOptions,
  LoginResult,
  QueueUpdate,
  ServerInfo,
  TokenLoginOptions,
} from "./types/adapter-types.js";
import type { ClientMessages, ServerMessages } from "./types/message-types.js";
import type { PlayerData, RoomUser } from "./types/player-types.js";

/** Actions with explicit switch-case handling or typed in ServerMessages — not truly unknown. */
const KNOWN_ACTIONS = new Set<string>([
  // Handled in switch
  "load_player",
  "join_room",
  "add_player",
  "remove_player",
  "send_position",
  "send_frame",
  "update_player",
  "kick",
  "close_with_error",
  // Typed passthrough (emitted as-is, no state updates needed)
  "send_message",
  "send_emote",
  "cpj_ping",
  "open_sprite",
  "close_sprite",
  "set_weather",
  "server_error",
  "error",
  "stamp_earned",
  "game_over",
  "join_game_room",
  "get_ninja",
  "get_waddles",
  "update_waddle",
  "join_matchmaking",
  "tick_matchmaking",
  "start_game",
  "set_cards",
  "add_enemy_cards",
  "start_round",
  "enable_cards",
  "remove_card",
  "move_my_card",
  "card_effect",
  "round_over",
  "play_animation",
  "game_won",
  "get_player",
  "buddy_request",
  "buddy_accept",
  "buddy_reject",
  "buddy_request_seen",
  "get_buddy",
  "buddy_find",
  "send_postcard",
  "stamps_result",
  "ignore_add",
  "ignore_remove",
  "add_item",
  "get_postcards",
  "get_igloo_open",
  "get_igloos",
  "get_igloo_likes",
  "join_igloo",
  "get_puffles",
  "get_all_puffles",
  "get_wellbeing",
  "get_walking_puffle",
  "update_wellbeing",
  "puffle_levelup",
  "puffle_popup",
  "buy_puffle_item",
  "walk_puffle",
  "backyard_supplies",
  "receive_postcard",
  "get_store_music",
  "add_music",
  "get_igloostore_items",
  "add_furniture",
  "update_music",
  "igloo_open_status",
  "igloo_bounds_status",
  "igloo_liked",
  "get_mascots",
  "wait_queue_update",
  "slot",
  "snowball",
  "equip_toy",
  "send_safe",
  "stop_walking",
  "update_table",
  "transform_player",
  "adopt_puffle",
  "info",
  "queue_server_join",
  "disconnect",
  "unknown_packet",
  "remove_inventory",
  "snowflake_state",
  "get_pets",
  "igloo_contest",
  "igloo_likes",
  "marry_request",
]);

type ServerMessageHandler<K extends keyof ServerMessages> = (
  args: ServerMessages[K],
) => void;

type ServerMessageMatcher<K extends keyof ServerMessages> = (
  args: ServerMessages[K],
) => boolean;

export type LogFn = (message: string, ...args: unknown[]) => void;

export type ClientOptions = {
  debug?: boolean | LogFn;
  connectionProfile?: ConnectionProfileInput;
};

export class Client extends EventEmitter {
  player: PlayerData | null = null;
  room: number | null = null;
  users: Map<number, RoomUser> = new Map();
  connected = false;

  private adapter: BaseAdapter;
  private loginResult: LoginResult | null = null;
  private log: LogFn | null = null;
  private _cardJitsu: CardJitsu | null = null;
  private _cppslol: Cppslol | null = null;
  private intentionalDisconnect = false;
  private disconnectNotified = false;
  private connectionFailure: ClientOperationError | null = null;
  private lifecycleReporter: ConnectOptions["onLifecycleUpdate"];
  private requestTails = new Map<keyof ServerMessages, Promise<void>>();
  private disconnectEpoch = 0;
  private lastDisconnectInfo: ClientDisconnectInfo | null = null;

  get loginMessage(): string | null {
    return this.adapter.loginMessage;
  }

  get loginStatus(): "active" | "banned" {
    return this.adapter.loginStatus;
  }

  get cardJitsu(): CardJitsu {
    if (!this._cardJitsu)
      this._cardJitsu = new CardJitsu(this.adapter, this.request.bind(this));
    return this._cardJitsu;
  }

  get cppslol(): Cppslol {
    if (!this._cppslol)
      this._cppslol = new Cppslol(this.adapter, this.request.bind(this));
    return this._cppslol;
  }

  constructor(server: AdapterName, options?: ClientOptions) {
    super();
    this.adapter = createAdapter(server, options?.connectionProfile);

    if (options?.debug) {
      this.log =
        typeof options.debug === "function"
          ? options.debug
          : console.log.bind(console);
    }
  }

  async login(
    options: LoginOptions | TokenLoginOptions,
    operationOptions?: ClientOperationOptions,
  ): Promise<ServerInfo[]> {
    this.log?.("[login] logging in as", options.username);
    this.loginResult = null;
    const loginResult = await this.adapter.login(options, operationOptions);
    this.loginResult = loginResult;
    this.log?.("[login] success —", loginResult.servers.length, "servers");
    return loginResult.servers;
  }

  async connect(serverName: string, options?: ConnectOptions): Promise<void> {
    if (!this.loginResult) throw new Error("Must call login() first");

    this.log?.("[connect] joining", serverName);
    this.intentionalDisconnect = false;
    this.disconnectNotified = false;
    this.connectionFailure = null;
    this.lastDisconnectInfo = null;
    this.lifecycleReporter = options?.onLifecycleUpdate;

    const connectOptions: ConnectOptions = {
      ...options,
      onQueueUpdate: (update: QueueUpdate) => {
        this.log?.("[queue]", `#${update.position}/${update.queueLength}`);
        this.emit("wait_queue_update", update);
        options?.onQueueUpdate?.(update);
      },
      onMessage: (message: AdapterMessage) => {
        this.handleMessage(message);
      },
      onDisconnect: (reason) => {
        this.handleAdapterDisconnect(reason);
      },
    };

    try {
      await this.adapter.connect(serverName, this.loginResult, connectOptions);
      this.reportLifecycle("awaiting_initial_state");
      await this.waitForInitialState(connectOptions);
      this.connected = true;
      this.connectionFailure = null;
      this.reportLifecycle("ready");
    } catch (cause) {
      const error =
        cause instanceof ClientOperationError
          ? cause
          : new ClientOperationError({
              category: "transport_error",
              phase: "transport_connecting",
              retryable: true,
              message:
                cause instanceof Error ? cause.message : "Connection failed",
              cause,
            });
      this.intentionalDisconnect = false;
      this.adapter.disconnect();
      this.cleanup();
      if (!this.disconnectNotified) {
        this.disconnectNotified = true;
        this.disconnectEpoch += 1;
        this.lastDisconnectInfo = {
          intentional: false,
          reason: error.message,
          occurredAt: Date.now(),
        };
        this.reportLifecycle("disconnected");
      }
      throw error;
    }
  }

  private waitForInitialState(options: ConnectOptions): Promise<void> {
    const timeoutMs =
      options.timeouts?.initialStateMs ??
      DEFAULT_CLIENT_CONNECTION_TIMEOUTS.initialStateMs;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanupWait = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        this.off("load_player", onProgress);
        this.off("join_room", onProgress);
        this.off("kick", onKick);
        this.off("close_with_error", onCloseWithError);
        this.off("server_error", onServerError);
        this.off("disconnect", onDisconnect);
        options.signal?.removeEventListener("abort", onAbort);
      };

      const succeed = (): void => {
        if (settled) return;
        settled = true;
        cleanupWait();
        resolve();
      };

      const fail = (error: ClientOperationError): void => {
        if (settled) return;
        settled = true;
        cleanupWait();
        reject(error);
      };

      const checkReady = (): void => {
        if (this.connectionFailure) {
          fail(this.connectionFailure);
          return;
        }
        if (this.player !== null && this.room !== null) succeed();
      };

      const onProgress = (): void => checkReady();
      const onKick = ({ reason }: ServerMessages["kick"]): void => {
        fail(
          new ClientOperationError({
            category: "kicked",
            phase: "awaiting_initial_state",
            retryable: true,
            message: `Kicked before initial state: ${reason ?? "unknown"}`,
          }),
        );
      };
      const onCloseWithError = ({
        error,
      }: ServerMessages["close_with_error"]): void => {
        fail(
          new ClientOperationError({
            category: "kicked",
            phase: "awaiting_initial_state",
            retryable: true,
            message: `Connection closed before initial state: ${error ?? "unknown"}`,
          }),
        );
      };
      const onServerError = ({
        error,
      }: ServerMessages["server_error"]): void => {
        fail(
          new ClientOperationError({
            category: "server_error",
            phase: "awaiting_initial_state",
            retryable: true,
            message: `Server error before initial state: ${String(error)}`,
          }),
        );
      };
      const onDisconnect = (info: ClientDisconnectInfo): void => {
        fail(
          new ClientOperationError({
            category: "disconnected",
            phase: "awaiting_initial_state",
            retryable: !info.intentional,
            message: `Disconnected before initial state${info.reason ? `: ${info.reason}` : ""}`,
          }),
        );
      };
      const onAbort = (): void => {
        fail(
          new ClientOperationError({
            category: "aborted",
            phase: "awaiting_initial_state",
            retryable: true,
            message: "Initial state wait cancelled",
          }),
        );
      };

      this.on("load_player", onProgress);
      this.on("join_room", onProgress);
      this.on("kick", onKick);
      this.on("close_with_error", onCloseWithError);
      this.on("server_error", onServerError);
      this.on("disconnect", onDisconnect);
      options.signal?.addEventListener("abort", onAbort, { once: true });

      if (options.signal?.aborted) {
        onAbort();
        return;
      }

      checkReady();
      if (settled) return;

      timer = setTimeout(() => {
        fail(
          new ClientOperationError({
            category: "initial_state_timeout",
            phase: "awaiting_initial_state",
            retryable: true,
            message: "Waiting for initial player and room state timed out",
          }),
        );
      }, timeoutMs);
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

  /** Wait for a server event. Resolves with the event payload and rejects on timeout, abort, or disconnect. */
  waitFor<K extends keyof ServerMessages>(
    event: K,
    timeout?: number,
  ): Promise<ServerMessages[K]>;
  waitFor<K extends keyof ServerMessages>(
    event: K,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages[K]>;
  waitFor<K extends keyof ServerMessages>(
    event: K,
    optionsOrTimeout?: number | ClientOperationOptions,
  ): Promise<ServerMessages[K]> {
    return this.waitForEvent(event, optionsOrTimeout);
  }

  private waitForEvent<K extends keyof ServerMessages>(
    event: K,
    optionsOrTimeout?: number | ClientOperationOptions,
    send?: () => void,
    matches?: ServerMessageMatcher<K>,
    rejectOnServerError?: boolean,
  ): Promise<ServerMessages[K]> {
    const options =
      typeof optionsOrTimeout === "number"
        ? { timeoutMs: optionsOrTimeout }
        : optionsOrTimeout;
    const timeoutMs =
      options?.timeoutMs ?? DEFAULT_CLIENT_CONNECTION_TIMEOUTS.requestMs;

    return new Promise<ServerMessages[K]>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        this.off(event, handler as unknown as (...args: unknown[]) => void);
        this.off("disconnect", onDisconnect);
        if (rejectOnServerError)
          this.off(
            "server_error",
            onServerError as unknown as (...args: unknown[]) => void,
          );
        options?.signal?.removeEventListener("abort", onAbort);
      };

      const handler = ((args: ServerMessages[K]) => {
        if (settled) return;
        if (matches && !matches(args)) return;
        settled = true;
        cleanup();
        resolve(args);
      }) as ServerMessageHandler<K>;

      const rejectWith = (error: ClientOperationError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const onDisconnect = (info?: ClientDisconnectInfo): void => {
        rejectWith(
          new ClientOperationError({
            category: "disconnected",
            phase: "ready",
            retryable: !info?.intentional,
            message: `Disconnected while waiting for ${String(event)}${info?.reason ? `: ${info.reason}` : ""}`,
          }),
        );
      };

      const onAbort = (): void => {
        rejectWith(
          new ClientOperationError({
            category: "aborted",
            phase: "ready",
            retryable: true,
            message: `Cancelled while waiting for ${String(event)}`,
          }),
        );
      };

      const onServerError = ({
        error,
      }: ServerMessages["server_error"]): void => {
        rejectWith(
          new ClientOperationError({
            category: "server_error",
            phase: "ready",
            retryable: false,
            message: `Server error while waiting for ${String(event)}: ${String(error)}`,
          }),
        );
      };

      if (options?.signal?.aborted) {
        onAbort();
        return;
      }

      if (Number.isFinite(timeoutMs)) {
        timer = setTimeout(() => {
          rejectWith(
            new ClientOperationError({
              category: "operation_timeout",
              phase: "ready",
              retryable: true,
              message: `Timed out waiting for ${String(event)}`,
            }),
          );
        }, timeoutMs);
      }

      this.on(event, handler);
      this.once("disconnect", onDisconnect);
      if (rejectOnServerError)
        this.once(
          "server_error",
          onServerError as unknown as (...args: unknown[]) => void,
        );
      options?.signal?.addEventListener("abort", onAbort, { once: true });

      if (send) {
        try {
          send();
        } catch (cause) {
          if (cause instanceof ClientOperationError) {
            rejectWith(cause);
            return;
          }
          rejectWith(
            new ClientOperationError({
              category: "transport_error",
              phase: "ready",
              retryable: true,
              message: `Failed to send request for ${String(event)}`,
              cause,
            }),
          );
        }
      }
    });
  }

  private request<K extends keyof ServerMessages>(
    event: K,
    send: () => void,
    options?: ClientOperationOptions,
    matches?: ServerMessageMatcher<K>,
  ): Promise<ServerMessages[K]> {
    const previous = this.requestTails.get(event);
    const disconnectEpoch = this.disconnectEpoch;
    let releaseTurn = (): void => {};
    const turn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const tail = previous ? previous.then(() => turn) : turn;
    this.requestTails.set(event, tail);

    const rejectOnServerError =
      this.adapter.rejectRequestsOnServerError;
    const operation = previous
      ? this.waitForRequestTurn(
          event,
          previous,
          disconnectEpoch,
          options?.signal,
        ).then(() =>
          this.waitForEvent(
            event,
            options,
            send,
            matches,
            rejectOnServerError,
          ),
        )
      : this.waitForEvent(event, options, send, matches, rejectOnServerError);

    return operation.finally(() => {
      releaseTurn();
      void tail.finally(() => {
        if (this.requestTails.get(event) === tail) {
          this.requestTails.delete(event);
        }
      });
    });
  }

  private waitForRequestTurn(
    event: keyof ServerMessages,
    previous: Promise<void>,
    disconnectEpoch: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const aborted = (): ClientOperationError =>
      new ClientOperationError({
        category: "aborted",
        phase: "ready",
        retryable: true,
        message: `Cancelled before sending request for ${String(event)}`,
      });

    if (signal?.aborted) return Promise.reject(aborted());

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(aborted());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      void previous.then(() => {
        if (settled) return;
        settled = true;
        cleanup();
        if (this.disconnectEpoch !== disconnectEpoch) {
          const info = this.lastDisconnectInfo;
          reject(
            new ClientOperationError({
              category: "disconnected",
              phase: "ready",
              retryable: !info?.intentional,
              message: `Disconnected before sending request for ${String(event)}${info?.reason ? `: ${info.reason}` : ""}`,
            }),
          );
          return;
        }
        resolve();
      });
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
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["join_room"]> {
    return this.request(
      "join_room",
      () => this.adapter.joinRoom(room, x, y),
      options,
      (response) => response.room === room,
    );
  }
  addItem(
    item: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["add_item"]> {
    return this.request(
      "add_item",
      () => this.adapter.addItem(item),
      options,
      (response) => Number(response.item) === item,
    );
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
  buddyAccept(
    id: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["buddy_accept"]> {
    return this.request(
      "buddy_accept",
      () => this.adapter.buddyAccept(id),
      options,
      (response) => response.id === id,
    );
  }
  buddyReject(
    id: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["buddy_reject"]> {
    return this.request(
      "buddy_reject",
      () => this.adapter.buddyReject(id),
      options,
      (response) => response.id === id,
    );
  }
  buddyRequestSeen(
    id: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["buddy_request_seen"]> {
    return this.request(
      "buddy_request_seen",
      () => this.adapter.buddyRequestSeen(id),
      options,
      (response) => response.id === id,
    );
  }
  getBuddy(
    id: number,
    type: "buddies" | "buddyRequests",
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_buddy"]> {
    return this.request(
      "get_buddy",
      () => this.adapter.getBuddy(id, type),
      options,
      (response) => response.id === id && response.type === type,
    );
  }
  findBuddy(
    id: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["buddy_find"]> {
    return this.request(
      "buddy_find",
      () => this.adapter.findBuddy(id),
      options,
    );
  }
  removeBuddy(id: number): void {
    this.adapter.removeBuddy(id);
  }
  addIgnore(
    id: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["ignore_add"]> {
    return this.request(
      "ignore_add",
      () => this.adapter.addIgnore(id),
      options,
      (response) => response.id === id,
    );
  }
  removeIgnore(
    id: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["ignore_remove"]> {
    return this.request(
      "ignore_remove",
      () => this.adapter.removeIgnore(id),
      options,
      (response) => response.id === id,
    );
  }
  getPlayer(
    id: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_player"]> {
    return this.request(
      "get_player",
      () => this.adapter.getPlayer(id),
      options,
      (response) => response.user.id === id,
    );
  }
  getAllSlots(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["slot"]> {
    return this.request("slot", () => this.adapter.getAllSlots(), options);
  }
  getMascots(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_mascots"]> {
    return this.request(
      "get_mascots",
      () => this.adapter.getMascots(),
      options,
    );
  }
  sendPostcard(
    userId: number,
    cardId: string,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["send_postcard"]> {
    return this.request(
      "send_postcard",
      () => this.adapter.sendPostcard(userId, cardId),
      options,
    );
  }
  getStamps(
    userId: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["stamps_result"]> {
    return this.request(
      "stamps_result",
      () => this.adapter.getStamps(userId),
      options,
    );
  }
  getPostcards(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_postcards"]> {
    return this.request(
      "get_postcards",
      () => this.adapter.getPostcards(),
      options,
    );
  }
  getIglooOpen(
    igloo: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_igloo_open"]> {
    return this.request(
      "get_igloo_open",
      () => this.adapter.getIglooOpen(igloo),
      options,
    );
  }
  getIgloos(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_igloos"]> {
    return this.request("get_igloos", () => this.adapter.getIgloos(), options);
  }
  getPuffles(
    userId: number,
    options?: ClientOperationOptions & { isBackyard?: boolean },
  ): Promise<ServerMessages["get_puffles"]> {
    return this.request(
      "get_puffles",
      () => this.adapter.getPuffles(userId, options?.isBackyard),
      options,
      (response) => response.userId === userId,
    );
  }
  getAllPuffles(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_all_puffles"]> {
    return this.request(
      "get_all_puffles",
      () => this.adapter.getAllPuffles(),
      options,
    );
  }
  getPuffleWellbeing(
    puffle: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_wellbeing"]> {
    return this.request(
      "get_wellbeing",
      () => this.adapter.getPuffleWellbeing(puffle),
      options,
      (response) => response.puffleId === puffle,
    );
  }
  playPuffle(puffle: number): void {
    this.adapter.playPuffle(puffle);
  }
  restPuffle(puffle: number): void {
    this.adapter.restPuffle(puffle);
  }
  buyPuffleItem(
    puffleId: number,
    item: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["buy_puffle_item"]> {
    return this.request(
      "buy_puffle_item",
      () => this.adapter.buyPuffleItem(puffleId, item),
      options,
      (response) => response.puffleId === puffleId && response.item === item,
    );
  }
  walkPuffle(
    puffle: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_walking_puffle"]> {
    return this.request(
      "get_walking_puffle",
      () => this.adapter.walkPuffle(puffle),
      options,
      (response) => response.puffle.id === puffle,
    );
  }
  /** CPJourney sends tower_init after its walking-puffle acknowledgement. */
  initializePuffleTower(): void {
    this.adapter.initializePuffleTower();
  }
  getBackyardSupplies(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["backyard_supplies"]> {
    return this.request(
      "backyard_supplies",
      () => this.adapter.getBackyardSupplies(),
      options,
    );
  }
  adoptPuffle(
    type: number,
    name: string,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["adopt_puffle"]> {
    return this.request(
      "adopt_puffle",
      () => this.adapter.adoptPuffle(type, name),
      options,
    );
  }
  getIglooLikes(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_igloo_likes"]> {
    return this.request(
      "get_igloo_likes",
      () => this.adapter.getIglooLikes(),
      options,
    );
  }
  checkPuffleSprite(puffleSprite: boolean): void {
    this.adapter.checkPuffleSprite(puffleSprite);
  }
  joinIgloo(
    igloo: number,
    x?: number,
    y?: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["join_igloo"]> {
    return this.request(
      "join_igloo",
      () => this.adapter.joinIgloo(igloo, x, y),
      options,
      (response) => response.igloo === igloo,
    );
  }
  getStoreMusic(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_store_music"]> {
    return this.request(
      "get_store_music",
      () => this.adapter.getStoreMusic(),
      options,
    );
  }
  buyMusic(
    music: string,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["add_music"]> {
    return this.request(
      "add_music",
      () => this.adapter.buyMusic(music),
      options,
      (response) => response.music === music,
    );
  }
  getIglooStoreItems(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["get_igloostore_items"]> {
    return this.request(
      "get_igloostore_items",
      () => this.adapter.getIglooStoreItems(),
      options,
    );
  }
  buyFurniture(
    furniture: string,
    amount = 1,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["add_furniture"]> {
    return this.request(
      "add_furniture",
      () => this.adapter.buyFurniture(furniture, amount),
      options,
      (response) =>
        response.furniture === furniture && response.amount === amount,
    );
  }
  updateIglooMusic(
    music: string,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["update_music"]> {
    return this.request(
      "update_music",
      () => this.adapter.updateIglooMusic(music),
      options,
      (response) => response.music === music,
    );
  }
  updateIglooFurniture(
    furniture: ClientMessages["update_furniture"]["furniture"],
  ): void {
    this.adapter.updateIglooFurniture(furniture);
  }
  autoUpdateIglooFurniture(
    furniture: ClientMessages["update_furniture_auto"]["furniture"],
  ): void {
    this.adapter.autoUpdateIglooFurniture(furniture);
  }
  updateIglooType(type: number): void {
    this.adapter.updateIglooType(type);
  }
  openIgloo(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["igloo_open_status"]> {
    return this.request(
      "igloo_open_status",
      () => this.adapter.openIgloo(),
      options,
    );
  }
  closeIglooBounds(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["igloo_bounds_status"]> {
    return this.request(
      "igloo_bounds_status",
      () => this.adapter.closeIglooBounds(),
      options,
    );
  }
  likeIgloo(
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["igloo_liked"]> {
    return this.request("igloo_liked", () => this.adapter.likeIgloo(), options);
  }
  openIglooEditor(): void {
    this.adapter.openIglooEditor();
  }
  closeIglooEditor(): void {
    this.adapter.closeIglooEditor();
  }
  gameOver(
    coins: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["game_over"]> {
    return this.request(
      "game_over",
      () => this.adapter.gameOver(coins),
      options,
    );
  }
  collectStamp(
    stamp: number,
    options?: ClientOperationOptions,
  ): Promise<ServerMessages["stamp_earned"]> {
    return this.request(
      "stamp_earned",
      () => this.adapter.collectStamp(stamp),
      options,
    );
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  disconnect(): void {
    this.log?.("[disconnect] closing connection");
    this.intentionalDisconnect = true;
    this.reportLifecycle("disconnecting");
    this.adapter.disconnect();
    this.handleAdapterDisconnect("client disconnect");
  }

  private reportLifecycle(
    phase: Parameters<
      NonNullable<ConnectOptions["onLifecycleUpdate"]>
    >[0]["phase"],
  ): void {
    this.lifecycleReporter?.({ phase, occurredAt: Date.now() });
  }

  private handleAdapterDisconnect(reason: string | null): void {
    if (this.disconnectNotified) return;
    this.disconnectNotified = true;
    const info: ClientDisconnectInfo = {
      intentional: this.intentionalDisconnect,
      reason,
      occurredAt: Date.now(),
    };
    this.disconnectEpoch += 1;
    this.lastDisconnectInfo = info;
    if (!info.intentional && !this.connected) {
      this.connectionFailure = new ClientOperationError({
        category: "disconnected",
        phase: "awaiting_initial_state",
        retryable: true,
        message: `Disconnected before initial state${reason ? `: ${reason}` : ""}`,
      });
    }
    this.log?.(
      "[disconnect]",
      info.intentional ? "connection closed" : "connection lost",
      reason ?? "",
    );
    this.cleanup();
    this.reportLifecycle("disconnected");
    this.emit("disconnect", info);
  }

  private cleanup(): void {
    this.connected = false;
    this.player = null;
    this.room = null;
    this.users.clear();
  }

  private handleMessage(msg: AdapterMessage): void {
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
      case "join_igloo": {
        const igloo = args.igloo as number;
        const rawUsers = args.users as Record<string, unknown>[];
        this.room = igloo;
        this.users.clear();
        const iglooUsers: RoomUser[] = [];
        for (const rawUser of rawUsers) {
          const user = this.adapter.normalizeUser(rawUser);
          this.users.set(user.id, user);
          iglooUsers.push(user);
        }
        emitArgs = { ...args, users: iglooUsers };
        this.log?.(
          "[join_igloo]",
          `igloo=${igloo}`,
          `users=${iglooUsers.length}`,
        );
        break;
      }
      case "update_player": {
        const id = args.id as number;
        const slot = args.slot as string;
        const item = Number(args.item);
        const updateSlot = (user: RoomUser): void => {
          if (slot in user) {
            (user as Record<string, unknown>)[slot] = item;
          } else if (slot in user.meta || this.adapter.id === "CPPS.lol") {
            user.meta[slot] = item;
          }
        };
        const roomUser = this.users.get(id);
        if (roomUser) updateSlot(roomUser);
        if (this.player?.id === id && this.player !== roomUser) {
          updateSlot(this.player);
        }
        break;
      }
      case "walk_puffle": {
        const id = args.user as number;
        const user = this.users.get(id);
        if (user) {
          user.walking = args.puffle as number;
          user.meta.walkingPuffleType = args.type as number;
        }
        break;
      }
      case "stop_walking": {
        const id = args.user as number;
        const user = this.users.get(id);
        if (user) {
          user.walking = 0;
          user.meta.walkingPuffleType = undefined;
        }
        break;
      }
      case "igloo_open_status": {
        const status = args.status as number;
        if (this.player) {
          this.player.meta.iglooOpen = status;
          const roomUser = this.users.get(this.player.id);
          if (roomUser) roomUser.meta.iglooOpen = status;
        }
        break;
      }
      case "igloo_bounds_status": {
        const status = args.status as number;
        if (this.player) {
          this.player.meta.iglooBounds = status;
          const roomUser = this.users.get(this.player.id);
          if (roomUser) roomUser.meta.iglooBounds = status;
        }
        break;
      }
      case "transform_player": {
        const id = args.id as number;
        const transform = args.transform as number;
        const roomUser = this.users.get(id);
        if (roomUser) roomUser.meta.transform = transform;
        if (this.player?.id === id && this.player !== roomUser) {
          this.player.meta.transform = transform;
        }
        break;
      }
      case "remove_inventory": {
        if (this.adapter.id !== "CPPS.lol" || !this.player) break;
        const item = Number(args.id);
        if (Number.isFinite(item)) {
          this.player.inventory = this.player.inventory.filter(
            (inventoryItem) => inventoryItem !== item,
          );
        }
        break;
      }
      case "add_item": {
        if (this.adapter.id !== "CPJourney" && this.adapter.id !== "CPPS.lol") {
          break;
        }
        const coins = args.coins;
        if (this.player && typeof coins === "number") {
          this.player.coins = coins;
        }
        const item = Number(args.item);
        if (
          this.player &&
          Number.isFinite(item) &&
          !this.player.inventory.includes(item)
        ) {
          this.player.inventory.push(item);
        }
        break;
      }
      case "add_furniture":
      case "add_music":
      case "adopt_puffle":
      case "buy_puffle_item":
      case "game_over": {
        // These captured coin values are CPJourney totals. Do not impose that
        // interpretation on adapters that reuse an action name differently.
        if (this.adapter.id !== "CPJourney") break;
        const coins = args.coins;
        if (this.player && typeof coins === "number") {
          this.player.coins = coins;
        }
        break;
      }
      case "kick": {
        const reason = (args as { reason?: string }).reason ?? "unknown";
        this.log?.("[kick]", reason);
        if (!this.connected) {
          this.connectionFailure = new ClientOperationError({
            category: "kicked",
            phase: "awaiting_initial_state",
            retryable: true,
            message: `Kicked before initial state: ${reason}`,
          });
        }
        this.cleanup();
        break;
      }
      case "close_with_error": {
        const error = (args as { error?: string }).error ?? "unknown";
        this.log?.("[kick]", error);
        if (!this.connected) {
          this.connectionFailure = new ClientOperationError({
            category: "kicked",
            phase: "awaiting_initial_state",
            retryable: true,
            message: `Connection closed before initial state: ${error}`,
          });
        }
        this.cleanup();
        break;
      }
      case "error": {
        const error = (args as { error?: string | number }).error ?? "unknown";
        if (!this.connected) {
          this.connectionFailure = new ClientOperationError({
            category: "server_error",
            phase: "awaiting_initial_state",
            retryable: true,
            message: `Server error before initial state: ${String(error)}`,
          });
        }
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
