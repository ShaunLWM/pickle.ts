import { io, type Socket } from "socket.io-client";
import msgpackParser from "socket.io-msgpack-parser";
import type {
  LoginOptions,
  LoginResult,
  QueueUpdate,
  ServerInfo,
  TokenLoginOptions,
} from "../types/adapter-types.js";
import { BaseAdapter, type ConnectOptions } from "./base-adapter.js";

const LOGIN_URL = "https://api.cplegacy.com/login";
const TOKEN_LOGIN_URL = "https://api.cplegacy.com/token_login";

type LoginResponse = {
  success: boolean;
  username: string;
  key: string;
  populations: Record<string, number>;
  requires2FA: boolean;
  message?: string;
  wantedVersion?: string;
};

type GameAuthResponse = {
  success: boolean;
};

/**
 * Wraps a CPLegacy socket to normalize its positional message format
 * `("message", action, args)` into the `{ action, args }` envelope
 * that the Client class expects.
 */
function wrapSocket(raw: Socket): Socket {
  const original = raw.on.bind(raw);

  raw.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === "message") {
      return original(event, (action: unknown, args: unknown) => {
        listener({ action, args: args ?? {} });
      });
    }
    return original(event, listener);
  }) as typeof raw.on;

  return raw;
}

export class CplegacyAdapter extends BaseAdapter {
  readonly id = "CPLegacy";
  private version = "";

  async login(options: LoginOptions | TokenLoginOptions): Promise<LoginResult> {
    const url = "token" in options ? TOKEN_LOGIN_URL : LOGIN_URL;
    const body: Record<string, unknown> =
      "token" in options
        ? { username: options.username, token: options.token }
        : {
            username: options.username,
            password: options.password,
            version: this.version,
          };

    let data = await this.postLogin(url, body);

    // Version negotiation: server returns wantedVersion when ours is stale/empty
    if (!data.success && data.wantedVersion) {
      this.version = data.wantedVersion;
      body.version = this.version;
      data = await this.postLogin(url, body);
    }

    if (!data.success) {
      throw new Error(`Login failed: ${data.message ?? "unknown error"}`);
    }

    const servers: ServerInfo[] = Object.entries(data.populations ?? {}).map(
      ([name, population]) => ({ name, population }),
    );

    return {
      servers,
      key: data.key,
      username: data.username,
      moderator: false,
      buddyWorlds: [],
    };
  }

  async connect(
    serverName: string,
    loginResult: LoginResult,
    options?: ConnectOptions,
  ): Promise<Socket> {
    const wsUrl = `wss://${serverName.toLowerCase()}.server.cplegacy.com`;
    const rawSocket = io(wsUrl, {
      path: "/socket.io/",
      parser: msgpackParser,
      transports: ["websocket"],
      reconnection: false,
    });
    this.socket = rawSocket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        rawSocket.disconnect();
        reject(new Error("Game connection timed out"));
      }, 15_000);

      rawSocket.on("connect", () => {
        rawSocket.emit("message", "game_auth", {
          username: loginResult.username,
          key: loginResult.key,
          createToken: false,
          token: "",
        });
      });

      rawSocket.on(
        "message",
        (action: string, args: Record<string, unknown>) => {
          switch (action) {
            case "wait_queue_update": {
              options?.onQueueUpdate?.(args as unknown as QueueUpdate);
              break;
            }
            case "game_auth": {
              const response = args as unknown as GameAuthResponse;
              if (!response.success) {
                clearTimeout(timeout);
                rawSocket.disconnect();
                reject(new Error("Game auth failed"));
                return;
              }

              // CPLegacy requires explicitly requesting load_player before join_server
              rawSocket.emit("message", "load_player", {});
              rawSocket.emit("message", "join_server", {});
              clearTimeout(timeout);
              resolve();
              break;
            }
          }
        },
      );

      rawSocket.on("connect_error", (err: Error) => {
        clearTimeout(timeout);
        rawSocket.disconnect();
        reject(new Error(`Game connection failed: ${err.message}`));
      });
    });

    // Return wrapped socket so Client receives normalized { action, args } messages
    return wrapSocket(rawSocket);
  }

  send(action: string, args: Record<string, unknown>): void {
    if (!this.socket) throw new Error("Not connected");
    this.socket.emit("message", action, args);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  private async postLogin(
    url: string,
    body: Record<string, unknown>,
  ): Promise<LoginResponse> {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    return resp.json() as Promise<LoginResponse>;
  }
}
