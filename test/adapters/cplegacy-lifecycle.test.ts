import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CplegacyAdapter } from "../../src/adapters/cplegacy-adapter.js";
import type { LoginResult } from "../../src/index.js";
import { FakeSocket } from "../helpers/fake-socket.js";

const loginResult: LoginResult = {
  servers: [{ name: "Blizzard", population: 1 }],
  key: "safe-test-key",
  username: "Test Bot",
  moderator: false,
  buddyWorlds: [],
};

class TestCplegacyAdapter extends CplegacyAdapter {
  readonly socketFixture = new FakeSocket();

  protected override createSocket(_serverName: string): Socket {
    return this.socketFixture.asSocket();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("CPLegacy connection lifecycle", () => {
  it("delivers initial messages through the pre-join sink exactly once", async () => {
    const adapter = new TestCplegacyAdapter();
    const messages: string[] = [];
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { authenticationMs: 100 },
      onMessage: ({ action }) => messages.push(action),
    });

    adapter.socketFixture.serverEmit("connect");
    adapter.socketFixture.serverEmit("message", "game_auth", {
      success: true,
    });
    adapter.socketFixture.serverEmit("message", "load_player", {
      user: { id: 7, username: "Test Bot" },
    });
    adapter.socketFixture.serverEmit("message", "join_room", {
      room: 100,
      users: [],
    });

    await expect(promise).resolves.toBeDefined();
    expect(messages).toEqual(["load_player", "join_room"]);
  });

  it("uses queue silence instead of the authentication timeout", async () => {
    vi.useFakeTimers();
    const adapter = new TestCplegacyAdapter();
    const phases: string[] = [];
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { authenticationMs: 20, queueMs: 40 },
      onLifecycleUpdate: ({ phase }) => phases.push(phase),
    });
    const assertion = expect(promise).rejects.toMatchObject({
      category: "queue_timeout",
      phase: "queueing",
    });

    adapter.socketFixture.serverEmit("connect");
    await vi.advanceTimersByTimeAsync(15);
    adapter.socketFixture.serverEmit("message", "wait_queue_update", {
      userId: 7,
      position: 2,
      queueLength: 9,
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(adapter.socketFixture.disconnected).toBe(false);
    await vi.advanceTimersByTimeAsync(20);

    await assertion;
    expect(phases).toContain("queueing");
    expect(adapter.socketFixture.disconnected).toBe(true);
  });
});
