import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { io, type Socket } from "socket.io-client";
import nacl from "tweetnacl";
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

function performHandshake(socket: Socket, encryptor: Encryptor): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Handshake timed out"));
    }, 10_000);

    socket.once(
      "handshake",
      (encryptedKey: string, serverPubKeyB64: string) => {
        clearTimeout(timeout);
        const raw = encryptor.acquireKey(encryptedKey, serverPubKeyB64);
        if (!raw) {
          reject(new Error("Failed to decrypt handshake key"));
          return;
        }

        const parsed = JSON.parse(raw) as { key: string; time?: number };
        if (
          parsed.time &&
          typeof parsed.time === "number" &&
          Math.abs(Date.now() - parsed.time) > 300_000
        ) {
          reject(new Error("Server time desync"));
          return;
        }

        encryptor.setKey(parsed.key);
        resolve();
      },
    );

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

  async login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult> {
    if (!this.worlds) {
      await this.loadWorlds();
    }

    const loginWorld = Object.values(this.worlds ?? {}).find((w) => w.login);
    if (!loginWorld) throw new Error("Login world not found in crumbs");

    const loginSocket = this.createSocket(loginWorld.host, loginWorld.path);
    this.encryptor = new Encryptor();

    const result = await new Promise<LoginResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        loginSocket.disconnect();
        reject(new Error("Login timed out"));
      }, 15_000);

      loginSocket.on("connect", async () => {
        try {
          await performHandshake(loginSocket, this.encryptor);

          const args =
            "token" in options
              ? { username: options.username, token: options.token }
              : { username: options.username, password: options.password };

          const encrypted = this.encryptor.encode({ action: "login", args });
          loginSocket.emit("message", encrypted);
        } catch (err) {
          clearTimeout(timeout);
          loginSocket.disconnect();
          reject(err);
        }
      });

      loginSocket.on("message", (msg: unknown) => {
        try {
          const decoded = this.encryptor.decode(msg);
          if (decoded.action !== "login") return;

          clearTimeout(timeout);
          loginSocket.disconnect();

          const response = decoded.args as unknown as LoginResponse;

          if (!response.success) {
            reject(new Error("Login failed"));
            return;
          }

          const servers: ServerInfo[] = Object.entries(
            response.populations ?? {},
          ).map(([name, population]) => ({ name, population }));

          resolve({
            servers,
            key: response.key,
            username: response.username,
            moderator: response.moderator ?? false,
            buddyWorlds: response.buddyWorlds ?? [],
          });
        } catch (err) {
          clearTimeout(timeout);
          loginSocket.disconnect();
          reject(err);
        }
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
    if (!this.worlds) {
      await this.loadWorlds();
    }

    const worldConfig = this.worlds?.[serverName];
    if (!worldConfig)
      throw new Error(`World config not found for: ${serverName}`);

    this.encryptor = new Encryptor();
    const gameSocket = this.createSocket(worldConfig.host, worldConfig.path);
    this.socket = gameSocket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        gameSocket.disconnect();
        reject(new Error("Game connection timed out"));
      }, 15_000);

      gameSocket.on("connect", async () => {
        try {
          await performHandshake(gameSocket, this.encryptor);

          const encrypted = this.encryptor.encode({
            action: "game_auth",
            args: {
              username: loginResult.username,
              key: loginResult.key,
              createToken: false,
            },
          });
          gameSocket.emit("message", encrypted);
        } catch (err) {
          clearTimeout(timeout);
          gameSocket.disconnect();
          reject(err);
        }
      });

      gameSocket.on("message", (msg: unknown) => {
        try {
          const decoded = this.encryptor.decode(msg);

          switch (decoded.action) {
            case "wait_queue_update": {
              options?.onQueueUpdate?.(decoded.args as unknown as QueueUpdate);
              break;
            }
            case "game_auth": {
              const response = decoded.args as unknown as GameAuthResponse;
              if (!response.success) {
                clearTimeout(timeout);
                gameSocket.disconnect();
                reject(new Error("Game auth failed"));
                return;
              }

              const joinEncrypted = this.encryptor.encode({
                action: "join_server",
                args: {},
              });
              gameSocket.emit("message", joinEncrypted);
              clearTimeout(timeout);
              resolve();
              break;
            }
          }
        } catch {
          // Ignore decode errors during auth phase
        }
      });

      gameSocket.on("connect_error", (err: Error) => {
        clearTimeout(timeout);
        gameSocket.disconnect();
        reject(new Error(`Game connection failed: ${err.message}`));
      });
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

  private createSocket(host: string, path: string): Socket {
    return io(host, {
      path,
      transports: ["polling", "websocket"],
      reconnection: false,
    });
  }

  private async loadWorlds(): Promise<void> {
    const resp = await fetch(CRUMBS_URL);
    if (!resp.ok) throw new Error(`Failed to fetch crumbs: ${resp.status}`);
    const crumbs = (await resp.json()) as { worlds: CrumbsWorlds };
    this.worlds = crumbs.worlds;
  }
}
