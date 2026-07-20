import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PenguinoriginsAdapter } from "../../src/adapters/penguinorigins-adapter.js";
import type { LoginResult } from "../../src/index.js";
import { FakeSocket } from "../helpers/fake-socket.js";

const loginResult: LoginResult = {
  servers: [{ name: "Blizzard", population: 1 }],
  key: "safe-test-key",
  username: "Test Bot",
  moderator: false,
  buddyWorlds: [],
};

class TestPenguinoriginsAdapter extends PenguinoriginsAdapter {
  readonly sockets: FakeSocket[] = [];

  protected override createSocket(_path: string): Socket {
    const socket = new FakeSocket();
    this.sockets.push(socket);
    return socket.asSocket();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PenguinOrigins connection lifecycle", () => {
  it("times out authentication and closes the socket", async () => {
    vi.useFakeTimers();
    const adapter = new TestPenguinoriginsAdapter();
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { authenticationMs: 50 },
    });
    const socket = adapter.sockets[0];
    socket?.serverEmit("connect");
    const assertion = expect(promise).rejects.toMatchObject({
      category: "auth_timeout",
      phase: "authenticating",
    });

    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    expect(socket?.disconnected).toBe(true);
    expect(socket?.listenerCount("message")).toBe(0);
  });

  it("rejects a disconnect before authentication", async () => {
    const adapter = new TestPenguinoriginsAdapter();
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { authenticationMs: 100 },
    });
    const socket = adapter.sockets[0];
    socket?.serverEmit("connect");
    socket?.serverEmit("disconnect", "transport close");

    await expect(promise).rejects.toMatchObject({
      category: "transport_error",
      phase: "authenticating",
    });
    expect(socket?.listenerCount("disconnect")).toBe(0);
  });

  it("uses queue silence instead of the authentication timeout", async () => {
    vi.useFakeTimers();
    const adapter = new TestPenguinoriginsAdapter();
    const phases: string[] = [];
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { authenticationMs: 20, queueMs: 40 },
      onLifecycleUpdate: ({ phase }) => phases.push(phase),
    });
    const assertion = expect(promise).rejects.toMatchObject({
      category: "queue_timeout",
      phase: "queueing",
    });
    const socket = adapter.sockets[0];

    socket?.serverEmit("connect");
    await vi.advanceTimersByTimeAsync(15);
    socket?.serverEmit("message", {
      action: "wait_queue_update",
      args: { userId: 7, position: 2, queueLength: 9 },
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(socket?.disconnected).toBe(false);
    await vi.advanceTimersByTimeAsync(20);

    await assertion;
    expect(phases).toContain("queueing");
    expect(socket?.disconnected).toBe(true);
  });
});

describe("PenguinOrigins login lifecycle", () => {
  it("times out login and closes the socket", async () => {
    vi.useFakeTimers();
    const adapter = new TestPenguinoriginsAdapter();
    const promise = adapter.login(
      { username: "Test Bot", password: "safe" },
      { timeoutMs: 50 },
    );
    const socket = adapter.sockets[0];
    const assertion = expect(promise).rejects.toMatchObject({
      category: "login_timeout",
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    expect(socket?.disconnected).toBe(true);
    expect(socket?.listenerCount("message")).toBe(0);
    expect(socket?.listenerCount("disconnect")).toBe(0);
  });

  it("clears a previous login rejection before a retry", async () => {
    const adapter = new TestPenguinoriginsAdapter();
    const failedLogin = adapter.login(
      { username: "Test Bot", password: "wrong" },
      { timeoutMs: 100 },
    );
    adapter.sockets[0]?.serverEmit("message", {
      action: "login",
      args: { success: false, message: "Incorrect password" },
    });
    await expect(failedLogin).rejects.toMatchObject({
      category: "invalid_credentials",
    });
    expect(adapter.loginMessage).toBe("Incorrect password");

    const successfulLogin = adapter.login(
      { username: "Test Bot", password: "safe" },
      { timeoutMs: 100 },
    );
    expect(adapter.loginMessage).toBeNull();
    adapter.sockets[1]?.serverEmit("message", {
      action: "login",
      args: {
        success: true,
        populations: { Blizzard: 1 },
        key: "safe-test-key",
        username: "Test Bot",
      },
    });

    await expect(successfulLogin).resolves.toMatchObject({
      username: "Test Bot",
    });
  });
});
