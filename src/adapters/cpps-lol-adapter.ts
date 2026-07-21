import { io, type Socket } from "socket.io-client";
import { ClientOperationError } from "../errors.js";
import {
  type ClientOperationOptions,
  DEFAULT_CLIENT_CONNECTION_TIMEOUTS,
} from "../lifecycle.js";
import type {
  LoginOptions,
  LoginResult,
  QueueUpdate,
  TokenLoginOptions,
} from "../types/adapter-types.js";
import type {
  IglooFurniturePlacement,
  PlayerData,
  RoomUser,
} from "../types/player-types.js";
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js";
import { CppslolPacketSigner } from "./cpps-lol-packet-signer.js";

const BASE_URL = "https://play.cpps.lol";

type LoginResponse = {
  success: boolean;
  message?: string;
  username: string;
  key: string;
  populations: Record<string, number | { bars: number; users: number }>;
};

type GameAuthResponse = {
  success: boolean;
  packetKey?: string;
  serverTime?: number;
  reconnectToken?: string;
  token?: string;
};

type ServerMessage = {
  action: string;
  args: Record<string, unknown>;
};

export class CppslolAdapter extends BaseAdapter {
  readonly id = "CPPS.lol";
  private signer: CppslolPacketSigner | null = null;
  private sessionToken = "";

  async login(
    options: LoginOptions | TokenLoginOptions,
    operationOptions?: ClientOperationOptions,
  ): Promise<LoginResult> {
    this.resetLoginState();
    this.sessionToken = "";
    const loginSocket = this.createSocket("/world/login/");

    return new Promise<LoginResult>((resolve, reject) => {
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
        this.sessionToken = "";
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
        const action = "token" in options ? "token_login" : "login";
        const args =
          "token" in options
            ? { username: options.username, token: options.token }
            : { username: options.username, password: options.password };

        loginSocket.emit("message", { action, args });
      };

      const onMessage = (message: ServerMessage): void => {
        if (message.action !== "login") return;
        const response = message.args as LoginResponse;

        if (!response.success) {
          this.loginMessage = response.message ?? null;
          const errorMessage = response.message ?? "Login failed";
          const invalidCredentials =
            /password|credential|incorrect|invalid login/i.test(errorMessage);
          fail(
            new ClientOperationError({
              category: invalidCredentials
                ? "invalid_credentials"
                : "login_rejected",
              phase: "transport_connecting",
              retryable: false,
              message: errorMessage,
            }),
          );
          return;
        }

        // CPPS.lol's population value is the bar count shown in its server browser.
        // `users` is the exact number of penguins online.
        const servers = Object.entries(response.populations).map(
          ([name, population]) =>
            typeof population === "number"
              ? { name, population }
              : {
                  name,
                  population: population.bars,
                  users: population.users,
                },
        );

        this.sessionToken = "token" in options ? options.token : "";

        succeed({
          servers,
          key: response.key,
          username: response.username,
          moderator: false,
          buddyWorlds: [],
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
  }

  async connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket> {
    this.signer = null;
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
      this.signer = null;
      this.sessionToken = "";
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
        this.signer = null;
        this.sessionToken = "";
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
        gameSocket.emit("message", {
          action: "game_auth",
          args: {
            username: loginResult.username,
            key: loginResult.key,
            createToken: true,
            token: this.sessionToken,
          },
        });
      };

      const onMessage = (message: ServerMessage): void => {
        switch (message.action) {
          case "wait_queue_update": {
            const update = message.args as QueueUpdate;
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
            const response = message.args as GameAuthResponse;
            if (
              !response.success ||
              !response.packetKey ||
              typeof response.serverTime !== "number"
            ) {
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

            try {
              this.signer = new CppslolPacketSigner(
                response.packetKey,
                response.serverTime,
              );
              this.sessionToken = response.token ?? this.sessionToken;
            } catch (cause) {
              fail(
                new ClientOperationError({
                  category: "auth_failed",
                  phase: "authenticating",
                  retryable: true,
                  message: "Game authentication returned invalid signing data",
                  cause,
                }),
              );
              return;
            }

            this.reportLifecycle(options, "joining_session");
            gameSocket.emit("message", { action: "join_server", args: {} });
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
            message: `Disconnected before game authentication${reason ? `: ${reason}` : ""}`,
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

  send(action: string, args: Record<string, unknown>): void {
    if (!this.socket || !this.signer) {
      throw new Error("Not connected or authenticated");
    }
    this.socket.emit("message", this.signer.sign(action, args));
  }

  disconnect(): void {
    this.signer = null;
    this.sessionToken = "";
    this.socket?.disconnect();
    this.socket = null;
  }

  override normalizeUser(raw: Record<string, unknown>): RoomUser {
    return {
      ...this.extractAppearance(raw),
      id: raw.id as number,
      username: raw.username as string,
      displayName:
        (raw.nickname as string) ??
        (raw.displayName as string) ??
        (raw.username as string),
      joinTime: raw.joinTime as string | undefined,
      x: (raw.x as number) ?? 0,
      y: (raw.y as number) ?? 0,
      frame: (raw.frame as number) ?? 0,
      meta: {
        toy: raw.toy,
        headLayer: raw.headLayer,
        headColor: raw.headColor,
        headLayerColor: raw.headLayerColor,
        faceLayer: raw.faceLayer,
        faceColor: raw.faceColor,
        faceLayerColor: raw.faceLayerColor,
        neckLayer: raw.neckLayer,
        neckColor: raw.neckColor,
        neckLayerColor: raw.neckLayerColor,
        bodyLayer: raw.bodyLayer,
        bodyColor: raw.bodyColor,
        bodyLayerColor: raw.bodyLayerColor,
        handLayer: raw.handLayer,
        handColor: raw.handColor,
        handLayerColor: raw.handLayerColor,
        feetLayer: raw.feetLayer,
        feetColor: raw.feetColor,
        feetLayerColor: raw.feetLayerColor,
        flagLayer: raw.flagLayer,
        flagColor: raw.flagColor,
        flagLayerColor: raw.flagLayerColor,
        photoLayer: raw.photoLayer,
        photoColor: raw.photoColor,
        photoLayerColor: raw.photoLayerColor,
        flags: raw.flags,
        isMascot: raw.isMascot,
        invisible: raw.invisible,
        isAfk: raw.isAfk,
        connectionUnstable: raw.connectionUnstable,
        transform: raw.transform,
        playercardMusic: raw.playercardMusic,
        outfits: raw.outfits,
        relationships: raw.relationships,
        likes: raw.likes,
        features: raw.features,
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
        snowflakes: raw.snowflakes,
        postcards: raw.postcards,
        mascots: raw.mascots,
        pets: raw.pets,
        locations: raw.locations,
      },
    };
  }

  override sendMessage(message: string): void {
    this.send("send_message", { message });
  }

  override sendEmote(emote: number): void {
    this.sendPackedEmote(1, emote);
  }

  override sendSafe(safe: number): void {
    this.send("send_safe", { safe });
  }

  override walk(x: number, y: number): void {
    this.send("send_position", { x, y });
  }

  override sendFrame(frame: number, set?: boolean): void {
    this.send("send_frame", { set: set ?? true, frame });
  }

  override snowball(x: number, y: number): void {
    this.send("snowball", { x, y });
  }

  override joinRoom(room: number, x?: number, y?: number): void {
    this.leaveWaddle();
    this.send("join_room", { room, x: x ?? 0, y: y ?? 0 });
  }

  override addItem(item: number): void {
    this.send("add_item", { item: String(item) });
  }

  private updatePlayer(item: number): void {
    this.send("update_player", { item });
  }

  override equipColor(item: number): void {
    this.updatePlayer(item);
  }

  override equipHead(item: number): void {
    this.updatePlayer(item);
  }

  override equipFace(item: number): void {
    this.updatePlayer(item);
  }

  override equipNeck(item: number): void {
    this.updatePlayer(item);
  }

  override equipBody(item: number): void {
    this.updatePlayer(item);
  }

  override equipHand(item: number): void {
    this.updatePlayer(item);
  }

  override equipFeet(item: number): void {
    this.updatePlayer(item);
  }

  override equipFlag(item: number): void {
    this.updatePlayer(item);
  }

  override equipPhoto(item: number): void {
    this.updatePlayer(item);
  }

  override getIglooOpen(igloo: number): void {
    this.send("get_igloo_open", { igloo });
  }

  override joinIgloo(igloo: number, x?: number, y?: number): void {
    this.leaveWaddle();
    this.send("join_igloo", { igloo, x: x ?? 0, y: y ?? 0 });
  }

  override updateIglooFurniture(furniture: IglooFurniturePlacement[]): void {
    this.send("update_furniture", { furniture });
  }

  openIglooRaw(): void {
    this.send("open_igloo", {});
  }

  sendPackedEmote(pack: number, emote: number): void {
    this.send("send_emote", { pack, emote });
  }

  updateLayeredPlayer(item: number): void {
    this.send("update_player", { item, layer: true });
  }

  acceptMature(): void {
    this.send("accept_mature", {});
  }

  removeInventory(item: number): void {
    this.send("remove_inventory", { item });
  }

  getSnowflakeState(): void {
    this.send("get_snowflake_state", {});
  }

  getPets(userId: number): void {
    this.send("get_pets", { userId });
  }

  getIglooContest(): void {
    this.send("get_igloo_contest", {});
  }

  getIglooLikesFor(iglooId: number): void {
    this.send("get_igloo_likes", { iglooId });
  }

  likeIglooById(iglooId: number): void {
    this.send("like_igloo", { iglooId });
  }

  sendMail(recipient: number, postcardId: number): void {
    this.send("send_mail", { recipient, postcardId });
  }

  marryRequest(id: number): void {
    this.send("marry_request", { id });
  }

  leaveWaddle(): void {
    this.send("leave_waddle", {});
  }

  protected createSocket(path: string): Socket {
    return io(BASE_URL, {
      ...this.socketIoOptions(BASE_URL),
      path,
      transports: ["polling", "websocket"],
      reconnection: false,
    });
  }
}
