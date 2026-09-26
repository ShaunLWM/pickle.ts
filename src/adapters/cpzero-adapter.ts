import { createHash } from "node:crypto";
import WebSocket from "ws";
import type { Socket } from "socket.io-client";
import { ClientOperationError } from "../errors.js";
import {
  type ClientOperationOptions,
  DEFAULT_CLIENT_CONNECTION_TIMEOUTS,
} from "../lifecycle.js";
import type {
  LoginOptions,
  LoginResult,
  ServerInfo,
  TokenLoginOptions,
} from "../types/adapter-types.js";

import type { PlayerData, RoomUser } from "../types/player-types.js";
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js";

const LOGIN_URL = "wss://server.cpzero.net/login";
const GAME_URL_PREFIX = "wss://server.cpzero.net/";
const SERVERS_XML_URL = "https://play.cpzero.net/servers.xml";
const LOGIN_ZONE = "w1";

/**
 * Parse a classic Club Penguin XT packet.
 * Format: `%xt%{handler}%{roomId}%{arg1}%{arg2}%...%\0`
 */
function parseXt(raw: string): { handler: string; roomId: string; args: string[] } | null {
  const trimmed = raw.replace(/\0+$/, "");
  if (!trimmed.startsWith("%xt%")) return null;
  const parts = trimmed.split("%");
  // parts[0] = "", parts[1] = "xt", parts[2] = handler, parts[3] = roomId, rest = args
  if (parts.length < 4) return null;
  return {
    handler: parts[2],
    roomId: parts[3],
    args: parts.slice(4),
  };
}

/**
 * Parse a pipe-delimited player string from Houdini.
 * Format: id|nickname|approval|color|head|face|neck|body|hand|feet|flag|photo|x|y|frame|member|memberDays|avatar|penguinState|partyState|puffleState
 */
function parsePlayerString(str: string): Record<string, unknown> {
  const p = str.split("|");
  return {
    id: Number(p[0]),
    nickname: p[1] ?? "",
    approval: Number(p[2]) || 0,
    color: Number(p[3]) || 0,
    head: Number(p[4]) || 0,
    face: Number(p[5]) || 0,
    neck: Number(p[6]) || 0,
    body: Number(p[7]) || 0,
    hand: Number(p[8]) || 0,
    feet: Number(p[9]) || 0,
    flag: Number(p[10]) || 0,
    photo: Number(p[11]) || 0,
    x: Number(p[12]) || 0,
    y: Number(p[13]) || 0,
    frame: Number(p[14]) || 0,
    member: Number(p[15]) || 0,
    memberDays: Number(p[16]) || 0,
    avatar: Number(p[17]) || 0,
    _raw_parts: p,
  };
}

/**
 * Parse world populations from the login response.
 * Format: "3100,0|3101,0|3103,7|3102,0|3104,7" → [{id, population}, ...]
 */
function parseWorldPopulations(raw: string): { id: number; population: number }[] {
  if (!raw) return [];
  return raw
    .split("|")
    .filter(Boolean)
    .map((entry) => {
      const [id, pop] = entry.split(",");
      return { id: Number(id), population: Number(pop) || 0 };
    });
}

/**
 * Fetch server ID → name mapping from servers.xml.
 * When `locale` is set, only returns servers under that `<language>` block.
 */
async function fetchServerNames(locale?: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const resp = await fetch(SERVERS_XML_URL);
    if (!resp.ok) return map;
    const xml = await resp.text();
    const safeLocale = locale && /^[a-z]{2,5}$/i.test(locale) ? locale : undefined;
    const source = safeLocale
      ? xml.match(new RegExp(`<language\\s+locale="${safeLocale}">([\\s\\S]*?)</language>`))?.[1] ?? ""
      : xml;
    for (const m of source.matchAll(/<server\s([^>]+)>/g)) {
      const attrs = m[1];
      const id = attrs.match(/id="(\d+)"/)?.[1];
      const name = attrs.match(/name="([^"]+)"/)?.[1];
      if (id && name) map.set(Number(id), name);
    }
  } catch {
    // Non-fatal — unknown IDs fall back to "Server {id}"
  }
  return map;
}

const SFS_VERSION_REQUEST = '<msg t="sys"><body action="verChk" r="0"><ver v="253" /></body></msg>\0';
const SFS_RNDK_REQUEST = '<msg t="sys"><body action="rndK" r="-1"></body></msg>\0';

/** Build a SmartFoxServer login request. */
function buildSfsLogin(username: string, loginHash: string, zone: string): string {
  return `<msg t="sys"><body action="login" r="0"><login z="${zone}"><nick><![CDATA[${username}]]></nick><pword><![CDATA[${loginHash}]]></pword></login></body></msg>\0`;
}

/** Build an XT send packet: %xt%s%{handler}%{roomId}%{args}%\0 */
function buildXtSend(handler: string, roomId: string, ...args: (string | number)[]): string {
  return `%xt%s%${handler}%${roomId}%${args.join("%")}%\0`;
}

const HOUDINI_STATIC_KEY = 'Y(02.>\'H}t":E1';

function md5Hex(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

/** Swap the two 16-char halves of a 32-char hex string, optionally MD5-ing first. */
function encryptPassword(password: string, digest = true): string {
  const hash = digest ? md5Hex(password) : password;
  return hash.slice(16, 32) + hash.slice(0, 16);
}

/**
 * Standard Houdini login hash.
 * 1. MD5(plaintext).toUpperCase()
 * 2. swapHalves(result) + rndk + staticKey
 * 3. MD5 + swapHalves
 */
function hashPassword(password: string, randomKey: string): string {
  const preHash = md5Hex(password).toUpperCase();
  let key = encryptPassword(preHash, false);
  key += randomKey;
  key += HOUDINI_STATIC_KEY;
  return encryptPassword(key);
}

export class CpzeroAdapter extends BaseAdapter {
  readonly id = "CPZero";
  private ws: WebSocket | null = null;
  private loginKey = "";
  private confirmationHash = "";
  private rawLoginData = "";
  private playerId = 0;

  async login(
    options: LoginOptions | TokenLoginOptions,
    operationOptions?: ClientOperationOptions,
  ): Promise<LoginResult> {
    this.resetLoginState();

    if ("token" in options) {
      throw new ClientOperationError({
        category: "unsupported_operation",
        phase: "transport_connecting",
        retryable: false,
        message: "CPZero does not support token login",
      });
    }

    type RawLoginData = {
      playerId: number;
      loginKey: string;
      confirmationHash: string;
      rawLoginData: string;
      username: string;
      worlds: { id: number; population: number }[];
    };

    const raw = await new Promise<RawLoginData>((resolve, reject) => {
      let settled = false;
      let randomKey = "";

      const timeout = setTimeout(() => {
        fail(
          new ClientOperationError({
            category: "login_timeout",
            phase: "transport_connecting",
            retryable: true,
            message: "Login timed out",
          }),
        );
      }, operationOptions?.timeoutMs ?? DEFAULT_CLIENT_CONNECTION_TIMEOUTS.loginMs);

      const ws = new WebSocket(LOGIN_URL, {
        ...this.webSocketOptions(LOGIN_URL),
      });

      const cleanup = (): void => {
        clearTimeout(timeout);
        operationOptions?.signal?.removeEventListener("abort", onAbort);
      };

      const fail = (error: ClientOperationError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        ws.close();
        reject(error);
      };

      const succeed = (value: RawLoginData): void => {
        if (settled) return;
        settled = true;
        cleanup();
        ws.close();
        resolve(value);
      };

      ws.on("open", () => {
        ws.send(SFS_VERSION_REQUEST);
      });

      ws.on("message", (data: Buffer) => {
        const messages = data.toString("utf-8").split("\0").filter(Boolean);

        for (const raw of messages) {
          // SmartFoxServer XML messages
          if (raw.includes('action="apiOK"')) {
            ws.send(SFS_RNDK_REQUEST);
            continue;
          }

          if (raw.includes('action="rndK"')) {
            const match = raw.match(/<k>([^<]+)<\/k>/);
            if (match) {
              randomKey = match[1];
              const loginHash = hashPassword(options.password, randomKey);
              ws.send(buildSfsLogin(options.username, loginHash, LOGIN_ZONE));
            }
            continue;
          }

          // XT login response
          const xt = parseXt(raw);
          if (!xt) continue;

          switch (xt.handler) {
            case "l": {
              // Vanilla format: args = [rawLoginData, confirmationHash, "", worldPopulations, buddyPresence, email]
              // rawLoginData = "id|id|username|loginKey|houdini|approval|rejection"
              const rawLoginData = xt.args[0] ?? "";
              const loginDataParts = rawLoginData.split("|");
              const playerId = Number(loginDataParts[0]);
              const loginKey = loginDataParts[3] ?? "";
              const confirmationHash = xt.args[1] ?? "";
              const worldPopsRaw = xt.args[3] ?? "";
              const worlds = parseWorldPopulations(worldPopsRaw);

              this.loginKey = loginKey;
              this.confirmationHash = confirmationHash;
              this.rawLoginData = rawLoginData;
              this.playerId = playerId;

              succeed({
                playerId,
                loginKey,
                confirmationHash,
                rawLoginData,
                username: options.username,
                worlds,
              });
              break;
            }
            case "e": {
              const errorCode = Number(xt.args[0]);
              const message = errorCodeToMessage(errorCode);
              this.loginMessage = message;

              let category: "invalid_credentials" | "account_banned" | "login_rejected";
              switch (true) {
                case errorCode === 100 || errorCode === 101:
                  category = "invalid_credentials";
                  break;
                case errorCode === 200:
                  category = "account_banned";
                  this.loginStatus = "banned";
                  break;
                default:
                  category = "login_rejected";
              }

              fail(
                new ClientOperationError({
                  category,
                  phase: "transport_connecting",
                  retryable: false,
                  message,
                }),
              );
              break;
            }
          }
        }
      });

      ws.on("error", (cause: Error) => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: "transport_connecting",
            retryable: true,
            message: `Login connection failed: ${cause.message}`,
            cause,
          }),
        );
      });

      ws.on("close", () => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: "transport_connecting",
            retryable: true,
            message: "Login connection closed unexpectedly",
          }),
        );
      });

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

      operationOptions?.signal?.addEventListener("abort", onAbort, {
        once: true,
      });
    });

    // Resolve world IDs to names via servers.xml, optionally filtered by locale
    const language = "token" in options ? undefined : options.language;
    const nameMap = await fetchServerNames(language);
    const filtered = language
      ? raw.worlds.filter((w) => nameMap.has(w.id))
      : raw.worlds;
    const servers: ServerInfo[] = filtered.map((w) => ({
      name: nameMap.get(w.id) ?? `Server ${w.id}`,
      // Houdini bar levels (0-7); min 1 so listed servers always show at least 1 bar
      population: Math.max(1, w.population),
    }));

    return {
      servers,
      key: raw.loginKey,
      username: raw.username,
      moderator: false,
      buddyWorlds: [],
    };
  }

  async connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket> {
    this.reportLifecycle(options, "transport_connecting");
    const serverSlug = serverName.toLowerCase().replace(/\s+/g, "_");
    const url = `${GAME_URL_PREFIX}${serverSlug}`;
    const timeouts = this.connectionTimeouts(options);

    const ws = new WebSocket(url, {
      ...this.webSocketOptions(url),
    });
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let randomKey = "";
      let activePhase: "transport_connecting" | "authenticating" | "joining_session" =
        "transport_connecting";

      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        options?.signal?.removeEventListener("abort", onAbort);
      };

      const fail = (error: ClientOperationError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        ws.close();
        this.ws = null;
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
        category: "transport_error" | "auth_timeout",
        phase: "transport_connecting" | "authenticating",
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

      const handleGameMessage = (raw: string): void => {
        const xt = parseXt(raw);
        if (!xt) return;

        // Translate XT packets to adapter messages for the client
        const translated = translateXtToAdapterMessage(xt.handler, xt.args, this.playerId);
        if (translated) {
          // Filter out internal auth messages
          if (translated.action === "game_auth" || translated.action === "wait_queue_update") {
            return;
          }
          options?.onMessage?.(translated);
        }
      };

      ws.on("open", () => {
        ws.send(SFS_VERSION_REQUEST);
      });

      ws.on("message", (data: Buffer) => {
        const messages = data.toString("utf-8").split("\0").filter(Boolean);

        for (const raw of messages) {
          // SmartFox handshake phase
          if (raw.includes('action="apiOK"')) {
            ws.send(SFS_RNDK_REQUEST);
            continue;
          }

          if (raw.includes('action="rndK"')) {
            const match = raw.match(/<k>([^<]+)<\/k>/);
            if (match) {
              randomKey = match[1];
              activePhase = "authenticating";
              this.reportLifecycle(options, "authenticating");
              startTimer(
                timeouts.authenticationMs,
                "auth_timeout",
                "authenticating",
                "Game authentication timed out",
              );
              // World auth: encryptPassword(loginKey + rndk) + loginKey + "#" + confirmationHash
              const authHash = encryptPassword(this.loginKey + randomKey) + this.loginKey;
              const pword = this.confirmationHash
                ? `${authHash}#${this.confirmationHash}`
                : authHash;
              ws.send(
                buildSfsLogin(this.rawLoginData || loginResult.username, pword, LOGIN_ZONE),
              );
            }
            continue;
          }

          // XT packets
          const xt = parseXt(raw);
          if (!xt) continue;

          switch (xt.handler) {
            case "l": {
              // Game auth success - send join server with penguin ID and login key
              this.reportLifecycle(options, "joining_session");
              ws.send(`%xt%s%j#js%-1%${this.playerId}%${this.loginKey}%en%\0`);
              // Don't resolve yet - wait for js (join server response)
              break;
            }
            case "js": {
              // Join server success - now we're in, resolve and start forwarding
              // Remove the one-time message handler and install persistent forwarding
              ws.removeAllListeners("message");
              ws.removeAllListeners("error");
              ws.on("message", (msgData: Buffer) => {
                const msgs = msgData.toString("utf-8").split("\0").filter(Boolean);
                for (const msg of msgs) {
                  handleGameMessage(msg);
                }
              });
              ws.on("error", () => {
                // Prevent unhandled error event crash; close handler fires next
              });
              ws.on("close", (code: number, reason: Buffer) => {
                options?.onDisconnect?.(reason.toString("utf-8") || `WS closed (${code})`);
              });
              succeed();
              break;
            }
            case "e": {
              const errorCode = Number(xt.args[0]);
              fail(
                new ClientOperationError({
                  category: "auth_failed",
                  phase: "authenticating",
                  retryable: true,
                  message: `Game authentication failed: error ${errorCode}`,
                }),
              );
              break;
            }
            default: {
              // Forward any early game messages (lp, jr, etc. can arrive before js completes)
              handleGameMessage(raw);
              break;
            }
          }
        }
      });

      ws.on("error", (cause: Error) => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: "transport_connecting",
            retryable: true,
            message: `Game connection failed: ${cause.message}`,
            cause,
          }),
        );
      });

      ws.on("close", () => {
        fail(
          new ClientOperationError({
            category: "transport_error",
            phase: activePhase,
            retryable: true,
            message: "Disconnected before game authentication",
          }),
        );
      });

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

      options?.signal?.addEventListener("abort", onAbort, { once: true });
      startTimer(
        timeouts.transportMs,
        "transport_error",
        "transport_connecting",
        "Game transport connection timed out",
      );
    });

    // Return a fake Socket to satisfy the type - the Client never uses it directly
    return this.ws as unknown as Socket;
  }

  send(action: string, args: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    // Map adapter action names back to XT protocol
    const xt = buildXtFromAction(action, args, this.playerId);
    if (xt) {
      this.ws.send(xt);
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.socket = null;
  }

  override normalizeUser(raw: Record<string, unknown>): RoomUser {
    return {
      ...this.extractAppearance(raw),
      id: raw.id as number,
      username: raw.nickname as string,
      displayName: raw.nickname as string,
      x: (raw.x as number) ?? 0,
      y: (raw.y as number) ?? 0,
      frame: (raw.frame as number) ?? 0,
      meta: {
        member: raw.member,
        approval: raw.approval,
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
      buddies: (raw.buddies as PlayerData["buddies"]) ?? [],
      buddyRequests: (raw.buddyRequests as number[]) ?? [],
      ignores: (raw.ignores as number[]) ?? [],
      furniture: (raw.furniture as unknown[]) ?? [],
      flooring: [],
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

  override sendFrame(frame: number): void {
    this.send("send_frame", { frame });
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

  override addIgnore(id: number): void {
    this.send("ignore_add", { id });
  }

  override removeIgnore(id: number): void {
    this.send("ignore_remove", { id });
  }

  override joinIgloo(igloo: number, x?: number, y?: number): void {
    this.send("join_igloo", { igloo, x: x ?? 0, y: y ?? 0 });
  }

  override gameOver(coins: number): void {
    this.send("game_over", { coins });
  }
}

/** Translate classic CP XT handler names to unified adapter message format. */
function translateXtToAdapterMessage(
  handler: string,
  args: string[],
  myId: number,
): { action: string; args: Record<string, unknown> } | null {
  switch (handler) {
    case "lp": {
      // Load player: playerString%coins%...
      const player = parsePlayerString(args[0] ?? "");
      const coins = Number(args[1]) || 0;
      const inventory = (args[5] ?? "")
        .split(",")
        .filter(Boolean)
        .map(Number);
      return {
        action: "load_player",
        args: {
          user: player,
          coins,
          rank: 0,
          inventory,
          buddies: [],
          buddyRequests: [],
          ignores: [],
          furniture: [],
          igloos: [],
        },
      };
    }
    case "jr": {
      // Join room: roomId%playerString1%playerString2%...
      const room = Number(args[0]);
      const users: Record<string, unknown>[] = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i]) {
          users.push(parsePlayerString(args[i]));
        }
      }
      return { action: "join_room", args: { room, users } };
    }
    case "ap": {
      // Add player
      const user = parsePlayerString(args[0] ?? "");
      return { action: "add_player", args: { user } };
    }
    case "rp": {
      // Remove player
      return { action: "remove_player", args: { user: Number(args[0]) } };
    }
    case "sp": {
      // Send position: userId%x%y
      return {
        action: "send_position",
        args: { id: Number(args[0]), x: Number(args[1]), y: Number(args[2]) },
      };
    }
    case "sf": {
      // Send frame
      return {
        action: "send_frame",
        args: { id: Number(args[0]), frame: Number(args[1]) },
      };
    }
    case "sm": {
      // Send message
      return {
        action: "send_message",
        args: { id: Number(args[0]), message: args[1] ?? "" },
      };
    }
    case "se": {
      // Send emote
      return {
        action: "send_emote",
        args: { id: Number(args[0]), emote: Number(args[1]) },
      };
    }
    case "ss": {
      // Send safe message
      return {
        action: "send_safe",
        args: { id: Number(args[0]), safe: Number(args[1]) },
      };
    }
    case "sb": {
      // Snowball
      return {
        action: "snowball",
        args: { id: Number(args[0]), x: Number(args[1]), y: Number(args[2]) },
      };
    }
    case "up": {
      // Update player (equip item)
      return {
        action: "update_player",
        args: { id: Number(args[0]), slot: args[1], item: Number(args[2]) },
      };
    }
    case "ai": {
      // Add item
      return {
        action: "add_item",
        args: { item: Number(args[0]), coins: Number(args[1]) },
      };
    }
    case "e": {
      return {
        action: "error",
        args: { error: Number(args[0]) },
      };
    }
    case "kick":
    case "k": {
      return {
        action: "kick",
        args: { reason: args[0] ?? "kicked" },
      };
    }
    default: {
      // Forward unhandled XT packets as generic messages
      return {
        action: handler,
        args: { raw: args },
      };
    }
  }
}

/** Build XT packet from adapter action name + args. */
function buildXtFromAction(
  action: string,
  args: Record<string, unknown>,
  playerId: number,
): string | null {
  const id = String(playerId);
  const internalId = "-1";

  switch (action) {
    case "send_position":
      return buildXtSend("u#sp", internalId, String(args.x), String(args.y));
    case "send_message":
      return buildXtSend("m#sm", internalId, id, String(args.message));
    case "send_emote":
      return buildXtSend("u#se", internalId, String(args.emote));
    case "send_safe":
      return buildXtSend("u#ss", internalId, String(args.safe));
    case "send_frame":
      return buildXtSend("u#sf", internalId, String(args.frame));
    case "snowball":
      return buildXtSend("u#sb", internalId, String(args.x), String(args.y));
    case "join_room":
      return buildXtSend("j#jr", internalId, String(args.room), String(args.x ?? 0), String(args.y ?? 0));
    case "add_item":
      return buildXtSend("i#ai", internalId, String(args.item));
    case "update_color":
      return buildXtSend("s#upc", internalId, String(args.item));
    case "update_head":
      return buildXtSend("s#uph", internalId, String(args.item));
    case "update_face":
      return buildXtSend("s#upf", internalId, String(args.item));
    case "update_neck":
      return buildXtSend("s#upn", internalId, String(args.item));
    case "update_body":
      return buildXtSend("s#upb", internalId, String(args.item));
    case "update_hand":
      return buildXtSend("s#upa", internalId, String(args.item));
    case "update_feet":
      return buildXtSend("s#upe", internalId, String(args.item));
    case "update_flag":
      return buildXtSend("s#upl", internalId, String(args.item));
    case "update_photo":
      return buildXtSend("s#upp", internalId, String(args.item));
    case "buddy_request":
      return buildXtSend("b#br", internalId, String(args.id));
    case "buddy_accept":
      return buildXtSend("b#ba", internalId, String(args.id));
    case "ignore_add":
      return buildXtSend("n#an", internalId, String(args.id));
    case "ignore_remove":
      return buildXtSend("n#rn", internalId, String(args.id));
    case "join_igloo":
      return buildXtSend("j#jp", internalId, String(args.igloo), String(args.x ?? 0), String(args.y ?? 0));
    case "game_over":
      return buildXtSend("zo", internalId, String(args.coins));
    default:
      return null;
  }
}

function errorCodeToMessage(code: number): string {
  switch (code) {
    case 100: return "Username does not exist";
    case 101: return "Incorrect password";
    case 103: return "Server full";
    case 150: return "Name approval needed";
    case 200: return "Account banned";
    case 601: return "Invalid login - already logged in";
    case 602: return "Invalid login - too many attempts";
    case 603: return "Connection limit exceeded";
    default: return `Login error: ${code}`;
  }
}
