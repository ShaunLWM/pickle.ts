import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BaseAdapter,
  ConnectOptions,
} from "../src/adapters/base-adapter.js";
import { Client } from "../src/client.js";
import { ClientOperationError } from "../src/errors.js";
import type {
  LoginOptions,
  LoginResult,
  TokenLoginOptions,
} from "../src/types/adapter-types.js";
import type { PlayerData, RoomUser } from "../src/types/player-types.js";
import { FakeSocket } from "./helpers/fake-socket.js";

const loginResult: LoginResult = {
  servers: [{ name: "Blizzard", population: 1 }],
  key: "safe-test-key",
  username: "Test Bot",
  moderator: false,
  buddyWorlds: [],
};

class ImmediateAdapter {
  readonly socket = new FakeSocket();
  disconnectCalls = 0;
  connectOptions: ConnectOptions | undefined;
  loginMessage = null;
  loginStatus = "active" as const;

  constructor(readonly id = "CPJourney") {}

  async login(
    _options: LoginOptions | TokenLoginOptions,
  ): Promise<LoginResult> {
    return loginResult;
  }

  async connect(
    _serverName: string,
    _loginResult: LoginResult,
    options?: ConnectOptions,
  ) {
    this.connectOptions = options;
    options?.onMessage?.({
      action: "load_player",
      args: { user: { id: 7, username: "Test Bot" } },
    });
    options?.onMessage?.({
      action: "join_room",
      args: { room: 100, users: [] },
    });
    return this.socket.asSocket();
  }

  disconnect(): void {
    this.disconnectCalls += 1;
  }

  normalizeUser(raw: Record<string, unknown>): RoomUser {
    return {
      id: raw.id as number,
      username: raw.username as string,
      x: 0,
      y: 0,
      frame: 0,
      color: 0,
      head: 0,
      face: 0,
      neck: 0,
      body: 0,
      hand: 0,
      feet: 0,
      flag: 0,
      photo: 0,
      meta: {},
      _raw: raw,
    };
  }

  normalizePlayer(raw: Record<string, unknown>): PlayerData {
    const user = this.normalizeUser(raw.user as Record<string, unknown>);
    return {
      ...user,
      coins: 0,
      rank: 0,
      inventory: [],
      buddies: [],
      ignores: [],
      _raw: raw,
    };
  }
}

function installAdapter(client: Client, adapter: ImmediateAdapter): void {
  (client as unknown as { adapter: BaseAdapter }).adapter =
    adapter as unknown as BaseAdapter;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Client.connect", () => {
  it("processes immediate initial messages exactly once", async () => {
    const client = new Client("CPJourney");
    const adapter = new ImmediateAdapter();
    installAdapter(client, adapter);
    let playerLoads = 0;
    let roomJoins = 0;
    client.on("load_player", () => {
      playerLoads += 1;
    });
    client.on("join_room", () => {
      roomJoins += 1;
    });

    await client.login({ username: "Test Bot", password: "safe" });
    await client.connect("Blizzard", {
      timeouts: { initialStateMs: 50 },
    });

    expect(client.connected).toBe(true);
    expect(client.player?.id).toBe(7);
    expect(client.room).toBe(100);
    expect(playerLoads).toBe(1);
    expect(roomJoins).toBe(1);
  });

  it("disconnects and rejects when initial state never arrives", async () => {
    vi.useFakeTimers();
    const client = new Client("CPJourney");
    const adapter = new ImmediateAdapter();
    adapter.connect = async (
      _serverName: string,
      _result: LoginResult,
      options?: ConnectOptions,
    ) => {
      adapter.connectOptions = options;
      return adapter.socket.asSocket();
    };
    installAdapter(client, adapter);
    await client.login({ username: "Test Bot", password: "safe" });
    const promise = client.connect("Blizzard", {
      timeouts: { initialStateMs: 50 },
    });
    const assertion = expect(promise).rejects.toMatchObject({
      category: "initial_state_timeout",
      phase: "awaiting_initial_state",
    });

    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    expect(adapter.disconnectCalls).toBe(1);
    expect(client.connected).toBe(false);
    expect(client.listenerCount("load_player")).toBe(0);
    expect(client.listenerCount("join_room")).toBe(0);
  });

  it("distinguishes intentional and remote disconnects", async () => {
    const client = new Client("CPJourney");
    const adapter = new ImmediateAdapter();
    installAdapter(client, adapter);
    const disconnects: Array<{ intentional: boolean; reason: string | null }> =
      [];
    client.on("disconnect", (info) => disconnects.push(info));
    await client.login({ username: "Test Bot", password: "safe" });
    await client.connect("Blizzard");

    adapter.connectOptions?.onDisconnect?.("transport close");
    expect(disconnects).toEqual([
      {
        intentional: false,
        reason: "transport close",
        occurredAt: expect.any(Number),
      },
    ]);

    await client.connect("Blizzard");
    client.disconnect();
    expect(disconnects[1]).toMatchObject({ intentional: true });
  });

  it("synchronizes captured player state before emitting updates", async () => {
    const client = new Client("CPJourney");
    const adapter = new ImmediateAdapter();
    installAdapter(client, adapter);
    await client.login({ username: "Test Bot", password: "safe" });
    await client.connect("Blizzard");

    adapter.connectOptions?.onMessage?.({
      action: "game_over",
      args: { coins: 410 },
    });
    adapter.connectOptions?.onMessage?.({
      action: "igloo_open_status",
      args: { status: 1 },
    });
    adapter.connectOptions?.onMessage?.({
      action: "add_player",
      args: { user: { id: 8, username: "Puffle Walker" } },
    });
    adapter.connectOptions?.onMessage?.({
      action: "add_player",
      args: { user: { id: 7, username: "Test Bot" } },
    });
    adapter.connectOptions?.onMessage?.({
      action: "walk_puffle",
      args: { user: 8, puffle: 11, type: 0 },
    });

    expect(client.player?.coins).toBe(410);
    expect(client.player?.meta.iglooOpen).toBe(1);
    expect(client.users.get(8)).toMatchObject({
      walking: 11,
      meta: { walkingPuffleType: 0 },
    });

    client.on("transform_player", ({ id, transform }) => {
      expect(client.users.get(id)?.meta.transform).toBe(transform);
    });
    client.on("igloo_bounds_status", ({ status }) => {
      expect(client.player?.meta.iglooBounds).toBe(status);
      expect(client.users.get(7)?.meta.iglooBounds).toBe(status);
    });
    adapter.connectOptions?.onMessage?.({
      action: "transform_player",
      args: { id: 8, transform: 35 },
    });
    adapter.connectOptions?.onMessage?.({
      action: "transform_player",
      args: { id: 7, transform: 12 },
    });
    adapter.connectOptions?.onMessage?.({
      action: "igloo_bounds_status",
      args: { status: 1 },
    });

    expect(client.users.get(8)?.meta.transform).toBe(35);
    expect(client.users.get(7)?.meta.transform).toBe(12);
    expect(client.player?.meta.transform).toBe(12);

    adapter.connectOptions?.onMessage?.({
      action: "stop_walking",
      args: { user: 8, puffle: { id: 11, type: 0 } },
    });
    expect(client.users.get(8)).toMatchObject({
      walking: 0,
      meta: { walkingPuffleType: undefined },
    });
  });

  it("does not impose CPJourney coin semantics on another adapter", async () => {
    const client = new Client("CPLegacy");
    const adapter = new ImmediateAdapter("CPLegacy");
    installAdapter(client, adapter);
    await client.login({ username: "Test Bot", password: "safe" });
    await client.connect("Blizzard");

    adapter.connectOptions?.onMessage?.({
      action: "game_over",
      args: { coins: 410 },
    });

    expect(client.player?.coins).toBe(0);
  });

  it("invalidates a previous login result before retrying login", async () => {
    const client = new Client("CPJourney");
    const adapter = new ImmediateAdapter();
    installAdapter(client, adapter);
    await client.login({ username: "Test Bot", password: "safe" });

    adapter.login = async () => {
      throw new Error("retry rejected");
    };

    await expect(
      client.login({ username: "Test Bot", password: "wrong" }),
    ).rejects.toThrow("retry rejected");
    await expect(client.connect("Blizzard")).rejects.toThrow(
      "Must call login() first",
    );
  });

  it("reports disconnected after an adapter-stage connection failure", async () => {
    const client = new Client("CPJourney");
    const adapter = new ImmediateAdapter();
    adapter.connect = async (
      _serverName: string,
      _result: LoginResult,
      options?: ConnectOptions,
    ) => {
      options?.onLifecycleUpdate?.({
        phase: "authenticating",
        occurredAt: Date.now(),
      });
      throw new ClientOperationError({
        category: "auth_timeout",
        phase: "authenticating",
        retryable: true,
        message: "Authentication timed out",
      });
    };
    installAdapter(client, adapter);
    await client.login({ username: "Test Bot", password: "safe" });
    const phases: string[] = [];

    await expect(
      client.connect("Blizzard", {
        onLifecycleUpdate: ({ phase }) => phases.push(phase),
      }),
    ).rejects.toMatchObject({ category: "auth_timeout" });

    expect(phases).toEqual(["authenticating", "disconnected"]);
    expect(adapter.disconnectCalls).toBe(1);
    expect(client.connected).toBe(false);
  });
});
