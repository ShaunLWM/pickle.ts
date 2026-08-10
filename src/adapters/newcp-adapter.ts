import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import nacl from "tweetnacl";
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

const CRUMBS_URL =
  "https://media8.newcp.net/assets/media/crumbs/en/crumbs.json";

type WorldConfig = {
  id?: number;
  host: string;
  path: string;
  login?: boolean;
};

type CrumbsWorlds = Record<string, WorldConfig>;

type LoginResponseWorld = {
  id: string;
  name: string;
  population: number;
  buddies: boolean;
};

type LoginResponse = {
  success: boolean;
  message?: string;
  username: string;
  key: string;
  worlds: LoginResponseWorld[];
};

type GameAuthResponse = {
  success: boolean;
  token?: string;
};

class Encryptor {
  private aesKey: Buffer | null = null;
  private keypair = nacl.box.keyPair();

  get publicKey(): string {
    return Buffer.from(this.keypair.publicKey).toString("base64");
  }

  get encrypted(): boolean {
    return this.aesKey !== null;
  }

  acquireKey(encryptedB64: string, serverPubKeyB64: string): string | null {
    const data = Buffer.from(encryptedB64, "base64");
    const serverPubKey = Buffer.from(serverPubKeyB64, "base64");
    const nonce = data.subarray(0, nacl.box.nonceLength);
    const ciphertext = data.subarray(nacl.box.nonceLength);
    const plaintext = nacl.box.open(
      new Uint8Array(ciphertext),
      new Uint8Array(nonce),
      new Uint8Array(serverPubKey),
      this.keypair.secretKey,
    );
    return plaintext ? new TextDecoder().decode(plaintext) : null;
  }

  setKey(keyString: string): void {
    this.aesKey = Buffer.from(keyString, "utf-8");
  }

  encrypt(plaintext: string): string {
    if (!this.aesKey) throw new Error("Encryption key not set");
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", this.aesKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf-8"),
      cipher.final(),
    ]);
    const result = Buffer.concat([iv, encrypted]);
    return result.toString("base64");
  }

  decrypt(data: string): string {
    if (!this.aesKey) throw new Error("Encryption key not set");
    const buf = Buffer.from(data, "base64");
    const iv = buf.subarray(0, 16);
    const ciphertext = buf.subarray(16);
    const decipher = createDecipheriv("aes-256-cbc", this.aesKey, iv);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf-8");
  }

  encode(data: Record<string, unknown>): string {
    return this.encrypted
      ? this.encrypt(JSON.stringify(data))
      : JSON.stringify(data);
  }

  decode(data: unknown): Record<string, unknown> {
    if (this.encrypted && typeof data === "string") {
      return JSON.parse(this.decrypt(data)) as Record<string, unknown>;
    }
    return typeof data === "string"
      ? (JSON.parse(data) as Record<string, unknown>)
      : (data as Record<string, unknown>);
  }
}

function performHandshake(
  socket: Socket,
  encryptor: Encryptor,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      socket.off("handshake", onHandshake);
      signal.removeEventListener("abort", onAbort);
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onAbort = (): void => {
      fail(new Error("Handshake cancelled"));
    };

    const onHandshake = (
      encryptedKey: string,
      serverPubKeyB64: string,
    ): void => {
      try {
        const raw = encryptor.acquireKey(encryptedKey, serverPubKeyB64);
        if (!raw) {
          fail(new Error("Failed to decrypt handshake key"));
          return;
        }

        const parsed = JSON.parse(raw) as { key: string; time?: number };
        if (
          parsed.time &&
          typeof parsed.time === "number" &&
          Math.abs(Date.now() - parsed.time) > 300_000
        ) {
          fail(new Error("Server time desync"));
          return;
        }

        encryptor.setKey(parsed.key);
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      } catch (cause) {
        fail(cause instanceof Error ? cause : new Error("Handshake failed"));
      }
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    socket.on("handshake", onHandshake);
    signal.addEventListener("abort", onAbort, { once: true });

    socket.emit("handshake", encryptor.publicKey);
  });
}

/**
 * Wraps a NewCP socket to decrypt incoming messages into the
 * `{ action, args }` envelope that the Client class expects.
 */
function wrapSocket(raw: Socket, encryptor: Encryptor): Socket {
  const original = raw.on.bind(raw);

  raw.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "message") {
      return original(event, (msg: unknown) => {
        try {
          const decoded = encryptor.decode(msg);
          listener({ action: decoded.action, args: decoded.args ?? {} });
        } catch {
          // Skip malformed messages
        }
      });
    }
    return original(event, listener);
  }) as typeof raw.on;

  return raw;
}

export class NewcpAdapter extends BaseAdapter {
  readonly id = "NewCP";
  private encryptor = new Encryptor();
  private worlds: CrumbsWorlds | null = null;

  async login(
    options: LoginOptions | TokenLoginOptions,
    operationOptions?: ClientOperationOptions,
  ): Promise<LoginResult> {
    this.resetLoginState();
    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = (): void => controller.abort();
    if (operationOptions?.signal?.aborted) {
      throw new ClientOperationError({
        category: "aborted",
        phase: "transport_connecting",
        retryable: true,
        message: "Login cancelled",
      });
    }
    operationOptions?.signal?.addEventListener("abort", onCallerAbort, {
      once: true,
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, operationOptions?.timeoutMs ??
      DEFAULT_CLIENT_CONNECTION_TIMEOUTS.loginMs);

    let loginSocket: Socket | null = null;
    try {
      if (!this.worlds) {
        await this.loadWorlds(controller.signal);
      }

      const loginWorld = Object.values(this.worlds ?? {}).find((w) => w.login);
      if (!loginWorld) {
        throw new ClientOperationError({
          category: "login_rejected",
          phase: "transport_connecting",
          retryable: false,
          message: "Login world not found in crumbs",
        });
      }

      loginSocket = this.createSocket(loginWorld.host, loginWorld.path);
      this.encryptor = new Encryptor();

      return await new Promise<LoginResult>((resolve, reject) => {
        let settled = false;

        const cleanup = (): void => {
          loginSocket?.off("connect", onConnect);
          loginSocket?.off("message", onMessage);
          loginSocket?.off("connect_error", onConnectError);
          loginSocket?.off("disconnect", onDisconnect);
          controller.signal.removeEventListener("abort", onAbort);
        };

        const fail = (error: ClientOperationError): void => {
          if (settled) return;
          settled = true;
          cleanup();
          loginSocket?.disconnect();
          reject(error);
        };

        const succeed = (result: LoginResult): void => {
          if (settled) return;
          settled = true;
          cleanup();
          loginSocket?.disconnect();
          resolve(result);
        };

        const onConnect = async (): Promise<void> => {
          try {
            if (!loginSocket) return;
            await performHandshake(
              loginSocket,
              this.encryptor,
              controller.signal,
            );
            const args =
              "token" in options
                ? { username: options.username, token: options.token }
                : { username: options.username, password: options.password };
            const encrypted = this.encryptor.encode({ action: "login", args });
            loginSocket.emit("message", encrypted);
          } catch (cause) {
            if (settled) return;
            fail(
              new ClientOperationError({
                category: controller.signal.aborted
                  ? timedOut
                    ? "login_timeout"
                    : "aborted"
                  : "transport_error",
                phase: "transport_connecting",
                retryable: true,
                message: controller.signal.aborted
                  ? timedOut
                    ? "Login timed out"
                    : "Login cancelled"
                  : cause instanceof Error
                    ? `Login handshake failed: ${cause.message}`
                    : "Login handshake failed",
                cause,
              }),
            );
          }
        };

        const onMessage = (message: unknown): void => {
          try {
            const decoded = this.encryptor.decode(message);
            if (decoded.action !== "login") return;
            const response = decoded.args as unknown as LoginResponse;
            if (!response.success) {
              this.loginMessage = response.message ?? null;
              const responseMessage = response.message ?? "Login failed";
              const invalidCredentials =
                /password|credential|incorrect|invalid login/i.test(
                  responseMessage,
                );
              fail(
                new ClientOperationError({
                  category: invalidCredentials
                    ? "invalid_credentials"
                    : "login_rejected",
                  phase: "transport_connecting",
                  retryable: false,
                  message: responseMessage,
                }),
              );
              return;
            }

            const servers: ServerInfo[] = (response.worlds ?? []).map((w) => ({
              name: w.name,
              population: w.population,
            }));
            const buddyWorlds = (response.worlds ?? [])
              .filter((w) => w.buddies)
              .map((w) => w.name);
            succeed({
              servers,
              key: response.key,
              username: response.username,
              moderator: false,
              buddyWorlds,
            });
          } catch (cause) {
            fail(
              new ClientOperationError({
                category: "transport_error",
                phase: "transport_connecting",
                retryable: true,
                message: "Invalid login response",
                cause,
              }),
            );
          }
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
              category: timedOut ? "login_timeout" : "aborted",
              phase: "transport_connecting",
              retryable: true,
              message: timedOut ? "Login timed out" : "Login cancelled",
            }),
          );
        };

        loginSocket?.on("connect", onConnect);
        loginSocket?.on("message", onMessage);
        loginSocket?.on("connect_error", onConnectError);
        loginSocket?.on("disconnect", onDisconnect);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
    } catch (cause) {
      if (cause instanceof ClientOperationError) throw cause;
      if (controller.signal.aborted) {
        throw new ClientOperationError({
          category: timedOut ? "login_timeout" : "aborted",
          phase: "transport_connecting",
          retryable: true,
          message: timedOut ? "Login timed out" : "Login cancelled",
          cause,
        });
      }
      throw new ClientOperationError({
        category: "transport_error",
        phase: "transport_connecting",
        retryable: true,
        message: cause instanceof Error ? cause.message : "Login failed",
        cause,
      });
    } finally {
      clearTimeout(timeout);
      operationOptions?.signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  async connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket> {
    if (!this.worlds) {
      await this.loadWorlds(options?.signal);
    }

    const worldConfig = this.worlds?.[serverName];
    if (!worldConfig)
      throw new Error(`World config not found for: ${serverName}`);

    this.encryptor = new Encryptor();
    this.reportLifecycle(options, "transport_connecting");
    const gameSocket = this.createSocket(worldConfig.host, worldConfig.path);
    this.socket = gameSocket;
    const timeouts = this.connectionTimeouts(options);
    const phaseController = new AbortController();

    const forwardMessage = (message: unknown): void => {
      try {
        const decoded = this.encryptor.decode(message);
        const action = decoded.action;
        if (typeof action !== "string") return;
        if (action === "game_auth" || action === "wait_queue_update") return;
        options?.onMessage?.({
          action,
          args: (decoded.args as Record<string, unknown> | undefined) ?? {},
        });
      } catch {
        // Malformed messages are ignored by the protocol adapter.
      }
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
        phaseController.abort();
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

      const onConnect = async (): Promise<void> => {
        activePhase = "authenticating";
        this.reportLifecycle(options, "authenticating");
        startTimer(
          timeouts.authenticationMs,
          "auth_timeout",
          "authenticating",
          "Game authentication timed out",
        );
        try {
          await performHandshake(
            gameSocket,
            this.encryptor,
            phaseController.signal,
          );
          if (settled) return;

          const encrypted = this.encryptor.encode({
            action: "game_auth",
            args: {
              username: loginResult.username,
              key: loginResult.key,
              createToken: false,
            },
          });
          gameSocket.emit("message", encrypted);
        } catch (cause) {
          if (settled) return;
          fail(
            new ClientOperationError({
              category: "transport_error",
              phase: "authenticating",
              retryable: true,
              message:
                cause instanceof Error
                  ? `Game handshake failed: ${cause.message}`
                  : "Game handshake failed",
              cause,
            }),
          );
        }
      };

      const onMessage = (message: unknown): void => {
        try {
          const decoded = this.encryptor.decode(message);

          switch (decoded.action) {
            case "wait_queue_update": {
              const update = decoded.args as unknown as QueueUpdate;
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
              const response = decoded.args as unknown as GameAuthResponse;
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
              const joinEncrypted = this.encryptor.encode({
                action: "join_server",
                args: {},
              });
              gameSocket.emit("message", joinEncrypted);
              succeed();
              break;
            }
          }
        } catch {
          // Ignore decode errors during auth phase
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

    return wrapSocket(gameSocket, this.encryptor);
  }

  send(action: string, args: Record<string, unknown>): void {
    if (!this.socket) throw new Error("Not connected");
    const encrypted = this.encryptor.encode({ action, args });
    this.socket.emit("message", encrypted);
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
      displayName: raw.nickname as string | undefined,
      x: (raw.x as number) ?? 0,
      y: (raw.y as number) ?? 0,
      frame: (raw.frame as number) ?? 0,
      meta: {
        nickname: raw.nickname,
        registrationDate: raw.registrationDate,
        customNameColor: raw.customNameColor,
        customBubbleColor: raw.customBubbleColor,
        customBubbleTextColor: raw.customBubbleTextColor,
        wallHacks: raw.wallHacks,
        moderator: raw.moderator,
        character: raw.character,
        approved: raw.approved,
        walking: raw.walking,
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
      rank: (raw.rank as number) ?? 0,
      inventory: (raw.inventory as number[]) ?? [],
      buddies: (raw.buddies as Buddy[]) ?? [],
      ignores: (raw.ignores as number[]) ?? [],
      furniture: raw.furniture as Record<string, unknown> | undefined,
      flooring: (raw.floorings as unknown[]) ?? [],
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

  override joinIgloo(igloo: number, x?: number, y?: number): void {
    this.send("join_igloo", { igloo, x: x ?? 0, y: y ?? 0 });
  }

  protected createSocket(host: string, path: string): Socket {
    return io(host, {
      ...this.socketIoOptions(host),
      path,
      transports: ["polling", "websocket"],
      reconnection: false,
    });
  }

  private async loadWorlds(signal?: AbortSignal): Promise<void> {
    const resp = await fetch(CRUMBS_URL, {
      headers: this.connectionHeaders(CRUMBS_URL),
      signal,
    });
    if (!resp.ok) throw new Error(`Failed to fetch crumbs: ${resp.status}`);
    const crumbs = (await resp.json()) as { worlds: CrumbsWorlds };
    this.worlds = crumbs.worlds;
  }
}
