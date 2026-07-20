import { io, type Socket } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";
import { ClientOperationError } from "../errors.js";
import {
  type ClientOperationOptions,
  DEFAULT_CLIENT_CONNECTION_TIMEOUTS,
} from "../lifecycle.js";
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
const INVALID_CREDENTIAL_MESSAGES = new Set([
  "Penguin not found. Try Again?",
  "Incorrect password. NOTE: Passwords are CaSe SeNsiTIVE",
]);

type LoginResponse = {
  success: boolean;
  message?: string;
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
  private gameToken: string | undefined;

  async login(
    options: LoginOptions | TokenLoginOptions,
    operationOptions?: ClientOperationOptions,
  ): Promise<LoginResult> {
    this.resetLoginState();
    this.gameToken = "token" in options ? options.token : undefined;
    const loginSocket = this.createSocket("/world/login/");

    const result = await new Promise<LoginResult>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        fail(
          new ClientOperationError({
            category: "login_timeout",
            phase: "transport_connecting",
            retryable: true,
            message: "Login timed out",
          }),
        );
      }, operationOptions?.timeoutMs ??
        DEFAULT_CLIENT_CONNECTION_TIMEOUTS.loginMs);

      const cleanup = (): void => {
        clearTimeout(timeout);
        loginSocket.off("connect", onConnect);
        loginSocket.off("message", onMessage);
        loginSocket.off("connect_error", onConnectError);
        loginSocket.off("disconnect", onDisconnect);
        operationOptions?.signal?.removeEventListener("abort", onAbort);
      };

      const fail = (error: ClientOperationError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        loginSocket.disconnect();
        reject(error);
      };

      const succeed = (value: LoginResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        loginSocket.disconnect();
        resolve(value);
      };

      const onConnect = (): void => {
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
      };

      const onMessage = (msg: ServerMessage): void => {
        if (msg.action !== "login") return;

        const response = msg.args as LoginResponse;

        if (!response.success) {
          this.loginMessage = response.message ?? null;
          const message = response.message ?? "Login failed";
          if (response.message?.startsWith("Banned:")) {
            this.loginStatus = "banned";
          }
          const invalidCredentials = INVALID_CREDENTIAL_MESSAGES.has(message);
          fail(
            new ClientOperationError({
              category:
                this.loginStatus === "banned"
                  ? "account_banned"
                  : invalidCredentials
                    ? "invalid_credentials"
                    : "login_rejected",
              phase: "transport_connecting",
              retryable: false,
              message,
            }),
          );
          return;
        }

        const servers: ServerInfo[] = Object.entries(response.populations).map(
          ([name, population]) => ({ name, population }),
        );

        succeed({
          servers,
          key: response.key,
          username: response.username,
          moderator: response.moderator,
          buddyWorlds: response.buddyWorlds ?? [],
        });
      };

      const onConnectError = (cause: Error): void => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: "transport_connecting",
            retryable: true,
            message: `Login connection failed: ${cause.message}`,
            cause,
          }),
        );
      };

      const onDisconnect = (reason: string): void => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: "transport_connecting",
            retryable: true,
            message: `Login connection closed unexpectedly${reason ? `: ${reason}` : ""}`,
          }),
        );
      };

      const onAbort = (): void => {
        fail(
          new ClientOperationError({
            category: "aborted",
            phase: "transport_connecting",
            retryable: true,
            message: "Login cancelled",
          }),
        );
      };

      if (operationOptions?.signal?.aborted) {
        onAbort();
        return;
      }

      loginSocket.on("connect", onConnect);
      loginSocket.on("message", onMessage);
      loginSocket.on("connect_error", onConnectError);
      loginSocket.on("disconnect", onDisconnect);
      operationOptions?.signal?.addEventListener("abort", onAbort, {
        once: true,
      });
    });

    return result;
  }

  async connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket> {
    this.reportLifecycle(options, "transport_connecting");
    await this.queueForServer(serverName, options);

    this.reportLifecycle(options, "transport_connecting");
    const gameSocket = this.createSocket(`/world/${serverName.toLowerCase()}/`);
    this.socket = gameSocket;
    const timeouts = this.connectionTimeouts(options);

    const forwardMessage = (message: ServerMessage): void => {
      if (
        message.action === "game_auth" ||
        message.action === "wait_queue_update"
      ) {
        return;
      }
      options?.onMessage?.(message);
    };
    const forwardDisconnect = (reason: string): void => {
      options?.onDisconnect?.(reason ?? null);
    };
    gameSocket.on("message", forwardMessage);
    gameSocket.on("disconnect", forwardDisconnect);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let activePhase: "transport_connecting" | "authenticating" | "queueing" =
        "transport_connecting";

      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        gameSocket.off("connect", onConnect);
        gameSocket.off("message", onMessage);
        gameSocket.off("connect_error", onConnectError);
        gameSocket.off("disconnect", onDisconnect);
        options?.signal?.removeEventListener("abort", onAbort);
      };

      const fail = (error: ClientOperationError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        gameSocket.off("message", forwardMessage);
        gameSocket.off("disconnect", forwardDisconnect);
        gameSocket.disconnect();
        this.socket = null;
        reject(error);
      };

      const succeed = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };

      const startTimer = (
        timeoutMs: number,
        category: "transport_error" | "auth_timeout" | "queue_timeout",
        phase: "transport_connecting" | "authenticating" | "queueing",
        message: string,
      ): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          fail(
            new ClientOperationError({
              category,
              phase,
              retryable: true,
              message,
            }),
          );
        }, timeoutMs);
      };

      const onConnect = (): void => {
        activePhase = "authenticating";
        this.reportLifecycle(options, "authenticating");
        startTimer(
          timeouts.authenticationMs,
          "auth_timeout",
          "authenticating",
          "Game authentication timed out",
        );
        const authArgs: Record<string, unknown> = {
          username: loginResult.username,
          key: loginResult.key,
          createToken: false,
          joinInvis: false,
          takeoverMascot: false,
          token: this.gameToken ?? "",
        };

        gameSocket.emit("message", {
          action: "game_auth",
          args: authArgs,
        });
      };

      const onMessage = (msg: ServerMessage): void => {
        switch (msg.action) {
          case "wait_queue_update": {
            const update = msg.args as QueueUpdate;
            activePhase = "queueing";
            this.reportLifecycle(options, "queueing", update);
            options?.onQueueUpdate?.(update);
            startTimer(
              timeouts.queueMs,
              "queue_timeout",
              "queueing",
              "Game server queue stopped responding",
            );
            break;
          }
          case "game_auth": {
            const response = msg.args as GameAuthResponse;
            if (!response.success) {
              fail(
                new ClientOperationError({
                  category: "auth_failed",
                  phase: "authenticating",
                  retryable: true,
                  message: "Game authentication failed",
                }),
              );
              return;
            }

            this.reportLifecycle(options, "joining_session");
            gameSocket.emit("message", {
              action: "join_server",
              args: {},
            });
            succeed();
            break;
          }
        }
      };

      const onConnectError = (cause: Error): void => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: "transport_connecting",
            retryable: true,
            message: `Game connection failed: ${cause.message}`,
            cause,
          }),
        );
      };

      const onDisconnect = (reason: string): void => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: activePhase,
            retryable: true,
            message: `Disconnected before joining the game${reason ? `: ${reason}` : ""}`,
          }),
        );
      };

      const onAbort = (): void => {
        fail(
          new ClientOperationError({
            category: "aborted",
            phase: activePhase,
            retryable: true,
            message: "Game connection cancelled",
          }),
        );
      };

      if (options?.signal?.aborted) {
        onAbort();
        return;
      }

      gameSocket.on("connect", onConnect);
      gameSocket.on("message", onMessage);
      gameSocket.on("connect_error", onConnectError);
      gameSocket.on("disconnect", onDisconnect);
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      startTimer(
        timeouts.transportMs,
        "transport_error",
        "transport_connecting",
        "Game transport connection timed out",
      );
    });

    return gameSocket;
  }

  private async queueForServer(
    serverName: string,
    options?: ConnectOptions,
  ): Promise<void> {
    const queueSocket = this.createSocket("/world/login/");
    const timeouts = this.connectionTimeouts(options);
    this.reportLifecycle(options, "queueing");

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let completed = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const startQueueIdleTimer = (): void => {
        if (timeout !== undefined) clearTimeout(timeout);
        timeout = setTimeout(() => {
          fail(
            new ClientOperationError({
              category: "queue_timeout",
              phase: "queueing",
              retryable: true,
              message: "Server queue stopped responding",
            }),
          );
        }, timeouts.queueMs);
      };

      const cleanup = (): void => {
        if (timeout !== undefined) clearTimeout(timeout);
        queueSocket.off("connect", onConnect);
        queueSocket.off("message", onMessage);
        queueSocket.off("disconnect", onDisconnect);
        queueSocket.off("connect_error", onConnectError);
        options?.signal?.removeEventListener("abort", onAbort);
      };

      const fail = (error: ClientOperationError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        queueSocket.disconnect();
        reject(error);
      };

      const succeed = (): void => {
        if (settled) return;
        settled = true;
        completed = true;
        cleanup();
        queueSocket.disconnect();
        resolve();
      };

      const onConnect = (): void => {
        queueSocket.emit("message", {
          action: "queue_server_join",
          args: { server: serverName },
        });
      };

      const onMessage = (msg: ServerMessage): void => {
        switch (msg.action) {
          case "wait_queue_update": {
            const update = msg.args as QueueUpdate;
            this.reportLifecycle(options, "queueing", update);
            options?.onQueueUpdate?.(update);
            startQueueIdleTimer();
            break;
          }
          case "queue_server_join": {
            succeed();
            break;
          }
        }
      };

      const onDisconnect = (reason: string): void => {
        if (completed) return;
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: "queueing",
            retryable: true,
            message: `Queue connection closed unexpectedly${reason ? `: ${reason}` : ""}`,
          }),
        );
      };

      const onConnectError = (cause: Error): void => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: "queueing",
            retryable: true,
            message: `Queue connection failed: ${cause.message}`,
            cause,
          }),
        );
      };

      const onAbort = (): void => {
        fail(
          new ClientOperationError({
            category: "aborted",
            phase: "queueing",
            retryable: true,
            message: "Queue wait cancelled",
          }),
        );
      };

      if (options?.signal?.aborted) {
        onAbort();
        return;
      }

      queueSocket.on("connect", onConnect);
      queueSocket.on("message", onMessage);
      queueSocket.on("disconnect", onDisconnect);
      queueSocket.on("connect_error", onConnectError);
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      startQueueIdleTimer();
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
    const {
      id,
      username,
      displayName,
      joinTime,
      x,
      y,
      frame,
      walking,
      color,
      head,
      face,
      neck,
      body,
      hand,
      feet,
      flag,
      photo,
      ...rest
    } = raw;
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
    const {
      user: _user,
      coins,
      rank,
      inventory,
      furniture,
      flooring,
      buddies,
      buddyRequests,
      ignores,
      igloos,
      ...rest
    } = raw;
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

  override findBuddy(id: number): void {
    this.send("buddy_find", { id });
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

  override getPuffles(userId: number, isBackyard?: boolean): void {
    this.send("get_puffles", {
      userId,
      ...(isBackyard !== undefined ? { isBackyard } : {}),
    });
  }

  override getAllPuffles(): void {
    this.send("get_all_puffles", {});
  }

  override getPuffleWellbeing(puffle: number): void {
    this.send("get_wellbeing", { puffle });
  }

  override playPuffle(puffle: number): void {
    this.send("puffle_play", { puffle });
  }

  override restPuffle(puffle: number): void {
    this.send("update_puffle_rest", { puffle });
  }

  override buyPuffleItem(puffleId: number, item: number): void {
    this.send("puffle_buy_item", { puffleId, item });
  }

  override walkPuffle(puffle: number): void {
    this.send("walk_puffle", { puffle });
  }

  override initializePuffleTower(): void {
    this.send("tower_init", {});
  }

  override getBackyardSupplies(): void {
    this.send("backyard_supplies", {});
  }

  override adoptPuffle(type: number, name: string): void {
    this.send("adopt_puffle", { type, name });
  }

  override getIglooLikes(): void {
    this.send("get_igloo_likes", {});
  }

  override checkPuffleSprite(puffleSprite: boolean): void {
    this.send("check_puffle_sprite", { puffleSprite });
  }

  override joinIgloo(igloo: number, x?: number, y?: number): void {
    this.send("join_igloo", { igloo, x: x ?? 0, y: y ?? 0 });
  }

  override getStoreMusic(): void {
    this.send("get_store_music", {});
  }

  override buyMusic(music: string): void {
    this.send("add_music", { music });
  }

  override getIglooStoreItems(): void {
    this.send("get_igloostore_items", {});
  }

  override buyFurniture(furniture: string, amount: number): void {
    this.send("add_furniture", { furniture, amount });
  }

  override updateIglooMusic(music: string): void {
    this.send("update_music", { music });
  }

  override updateIglooFurniture(
    furniture: Array<{
      furnitureId: number;
      x: number;
      y: number;
      rotation: number;
      frame: number;
      depth: number;
      slot?: number;
    }>,
  ): void {
    this.send("update_furniture", { furniture });
  }

  override autoUpdateIglooFurniture(
    furniture: Array<{
      furnitureId: number;
      x: number;
      y: number;
      rotation: number;
      frame: number;
      depth: number;
      slot?: number;
    }>,
  ): void {
    this.send("update_furniture_auto", { furniture });
  }

  override updateIglooType(type: number): void {
    this.send("update_igloo", { type });
  }

  override openIgloo(): void {
    this.send("open_igloo", {});
  }

  override closeIglooBounds(): void {
    this.send("close_igloo_bounds", {});
  }

  override likeIgloo(): void {
    this.send("like_igloo", {});
  }

  override openIglooEditor(): void {
    this.send("igloo_editor_open", {});
  }

  override closeIglooEditor(): void {
    this.send("igloo_editor_closed", {});
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

  protected createSocket(path: string): Socket {
    return io(BASE_URL, {
      ...this.socketIoOptions(BASE_URL),
      path,
      parser: msgpackParser,
      transports: ["polling", "websocket"],
      reconnection: false,
    });
  }
}
