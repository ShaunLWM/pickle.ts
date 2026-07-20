import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CpjourneyAdapter } from "../../src/adapters/cpjourney-adapter.js";
import type { ClientLifecycleUpdate, LoginResult } from "../../src/index.js";
import { FakeSocket, flushMicrotasks } from "../helpers/fake-socket.js";

const loginResult: LoginResult = {
  servers: [{ name: "Blizzard", population: 1 }],
  key: "safe-test-key",
  username: "Test Bot",
  moderator: false,
  buddyWorlds: [],
};

class TestCpjourneyAdapter extends CpjourneyAdapter {
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

describe("CPJourney connection lifecycle", () => {
  it("rejects an unexpected queue-socket disconnect", async () => {
    const adapter = new TestCpjourneyAdapter();
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { queueMs: 100 },
    });
    const queueSocket = adapter.sockets[0];
    expect(queueSocket).toBeDefined();

    queueSocket?.serverEmit("connect");
    queueSocket?.serverEmit("disconnect", "transport close");

    await expect(promise).rejects.toMatchObject({
      category: "transport_error",
      phase: "queueing",
      retryable: true,
    });
    expect(queueSocket?.listenerCount("message")).toBe(0);
    expect(queueSocket?.listenerCount("disconnect")).toBe(0);
  });

  it("treats its own queue close as successful and reports progress", async () => {
    const adapter = new TestCpjourneyAdapter();
    const updates: ClientLifecycleUpdate[] = [];
    const queueUpdates: Array<{ position: number; queueLength: number }> = [];
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { queueMs: 100, authenticationMs: 100 },
      onLifecycleUpdate: (update) => updates.push(update),
      onQueueUpdate: ({ position, queueLength }) =>
        queueUpdates.push({ position, queueLength }),
    });
    const queueSocket = adapter.sockets[0];

    queueSocket?.serverEmit("connect");
    queueSocket?.serverEmit("message", {
      action: "wait_queue_update",
      args: { userId: 7, position: 2, queueLength: 9 },
    });
    queueSocket?.serverEmit("message", {
      action: "queue_server_join",
      args: {},
    });
    await flushMicrotasks();

    const gameSocket = adapter.sockets[1];
    expect(gameSocket).toBeDefined();
    gameSocket?.serverEmit("connect");
    gameSocket?.serverEmit("message", {
      action: "game_auth",
      args: { success: true },
    });

    await expect(promise).resolves.toBe(gameSocket?.asSocket());
    expect(queueUpdates).toEqual([{ position: 2, queueLength: 9 }]);
    expect(updates.map(({ phase }) => phase)).toEqual([
      "transport_connecting",
      "queueing",
      "queueing",
      "transport_connecting",
      "authenticating",
      "joining_session",
    ]);
    expect(updates[2]?.queue).toMatchObject({
      position: 2,
      queueLength: 9,
    });
    expect(queueSocket?.listenerCount("message")).toBe(0);
    expect(queueSocket?.listenerCount("disconnect")).toBe(0);
  });

  it("uses the browser auth payload and switches a game queue to its queue timeout", async () => {
    vi.useFakeTimers();
    const adapter = new TestCpjourneyAdapter();
    const updates: ClientLifecycleUpdate[] = [];
    const queueUpdates: Array<{ position: number; queueLength: number }> = [];
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { queueMs: 100, authenticationMs: 20 },
      onLifecycleUpdate: (update) => updates.push(update),
      onQueueUpdate: ({ position, queueLength }) =>
        queueUpdates.push({ position, queueLength }),
    });
    const assertion = expect(promise).resolves.toBeDefined();
    const queueSocket = adapter.sockets[0];

    queueSocket?.serverEmit("connect");
    queueSocket?.serverEmit("message", {
      action: "queue_server_join",
      args: {},
    });
    await flushMicrotasks();

    const gameSocket = adapter.sockets[1];
    gameSocket?.serverEmit("connect");
    expect(gameSocket?.sent).toContainEqual({
      event: "message",
      args: [
        {
          action: "game_auth",
          args: {
            username: loginResult.username,
            key: loginResult.key,
            createToken: false,
            joinInvis: false,
            takeoverMascot: false,
            token: "",
          },
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(15);
    gameSocket?.serverEmit("message", {
      action: "wait_queue_update",
      args: { userId: 7, position: 48, queueLength: 48 },
    });
    await vi.advanceTimersByTimeAsync(30);
    gameSocket?.serverEmit("message", {
      action: "game_auth",
      args: { success: true },
    });

    await assertion;
    expect(queueUpdates).toEqual([{ position: 48, queueLength: 48 }]);
    expect(updates.map(({ phase }) => phase)).toEqual([
      "transport_connecting",
      "queueing",
      "transport_connecting",
      "authenticating",
      "queueing",
      "joining_session",
    ]);
    expect(updates[4]?.queue).toMatchObject({
      position: 48,
      queueLength: 48,
    });
    expect(gameSocket?.sent).toContainEqual({
      event: "message",
      args: [{ action: "join_server", args: {} }],
    });
  });

  it("forwards a supplied login token into game authentication", async () => {
    const adapter = new TestCpjourneyAdapter();
    const loginPromise = adapter.login(
      { username: "Test Bot", token: "safe-test-token" },
      { timeoutMs: 100 },
    );
    const loginSocket = adapter.sockets[0];

    loginSocket?.serverEmit("connect");
    loginSocket?.serverEmit("message", {
      action: "login",
      args: {
        success: true,
        username: loginResult.username,
        key: loginResult.key,
        populations: { Blizzard: 1 },
        moderator: false,
        buddyWorlds: [],
      },
    });
    const tokenLoginResult = await loginPromise;

    const connectPromise = adapter.connect("Blizzard", tokenLoginResult, {
      timeouts: { queueMs: 100, authenticationMs: 100 },
    });
    const queueSocket = adapter.sockets[1];
    queueSocket?.serverEmit("connect");
    queueSocket?.serverEmit("message", {
      action: "queue_server_join",
      args: {},
    });
    await flushMicrotasks();

    const gameSocket = adapter.sockets[2];
    gameSocket?.serverEmit("connect");
    expect(gameSocket?.sent).toContainEqual({
      event: "message",
      args: [
        {
          action: "game_auth",
          args: {
            username: loginResult.username,
            key: loginResult.key,
            createToken: false,
            joinInvis: false,
            takeoverMascot: false,
            token: "safe-test-token",
          },
        },
      ],
    });
    gameSocket?.serverEmit("message", {
      action: "game_auth",
      args: { success: true },
    });

    await expect(connectPromise).resolves.toBe(gameSocket?.asSocket());
  });

  it("times out a silent game-socket queue without limiting total queue time", async () => {
    vi.useFakeTimers();
    const adapter = new TestCpjourneyAdapter();
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { queueMs: 40, authenticationMs: 20 },
    });
    const assertion = expect(promise).rejects.toMatchObject({
      category: "queue_timeout",
      phase: "queueing",
      retryable: true,
    });
    const queueSocket = adapter.sockets[0];

    queueSocket?.serverEmit("connect");
    queueSocket?.serverEmit("message", {
      action: "queue_server_join",
      args: {},
    });
    await flushMicrotasks();

    const gameSocket = adapter.sockets[1];
    gameSocket?.serverEmit("connect");
    gameSocket?.serverEmit("message", {
      action: "wait_queue_update",
      args: { userId: 7, position: 2, queueLength: 9 },
    });
    await vi.advanceTimersByTimeAsync(20);
    gameSocket?.serverEmit("message", {
      action: "wait_queue_update",
      args: { userId: 7, position: 1, queueLength: 9 },
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(gameSocket?.disconnected).toBe(false);
    await vi.advanceTimersByTimeAsync(20);

    await assertion;
    expect(gameSocket?.disconnected).toBe(true);
  });

  it("keeps the login-socket queue alive while updates continue", async () => {
    vi.useFakeTimers();
    const adapter = new TestCpjourneyAdapter();
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { queueMs: 50 },
    });
    const assertion = expect(promise).rejects.toMatchObject({
      category: "queue_timeout",
      phase: "queueing",
    });
    const queueSocket = adapter.sockets[0];

    queueSocket?.serverEmit("connect");
    queueSocket?.serverEmit("message", {
      action: "wait_queue_update",
      args: { userId: 7, position: 2, queueLength: 9 },
    });
    await vi.advanceTimersByTimeAsync(25);
    queueSocket?.serverEmit("message", {
      action: "wait_queue_update",
      args: { userId: 7, position: 1, queueLength: 9 },
    });
    await vi.advanceTimersByTimeAsync(25);
    expect(queueSocket?.disconnected).toBe(false);
    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(queueSocket?.disconnected).toBe(true);
  });

  it("times out authentication and closes the game socket", async () => {
    vi.useFakeTimers();
    const adapter = new TestCpjourneyAdapter();
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { queueMs: 100, authenticationMs: 50 },
    });
    const queueSocket = adapter.sockets[0];
    queueSocket?.serverEmit("connect");
    queueSocket?.serverEmit("message", {
      action: "queue_server_join",
      args: {},
    });
    await flushMicrotasks();
    const gameSocket = adapter.sockets[1];
    gameSocket?.serverEmit("connect");
    const assertion = expect(promise).rejects.toMatchObject({
      category: "auth_timeout",
      phase: "authenticating",
    });

    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    expect(gameSocket?.disconnected).toBe(true);
    expect(gameSocket?.listenerCount("message")).toBe(0);
  });
});

describe("CPJourney login lifecycle", () => {
  it("classifies the verified multiline banned response", async () => {
    const message =
      "Banned:\nYou are banned forever\n(Attempted Game Manipulation)";
    const adapter = new TestCpjourneyAdapter();
    const promise = adapter.login(
      { username: "Test Bot", password: "safe" },
      { timeoutMs: 100 },
    );
    const socket = adapter.sockets[0];

    socket?.serverEmit("connect");
    socket?.serverEmit("message", {
      action: "login",
      args: { success: false, message },
    });

    await expect(promise).rejects.toMatchObject({
      category: "account_banned",
      phase: "transport_connecting",
      retryable: false,
      message,
    });
    expect(adapter.loginStatus).toBe("banned");
    expect(adapter.loginMessage).toBe(message);
  });

  it.each([
    "Penguin not found. Try Again?",
    "Incorrect password. NOTE: Passwords are CaSe SeNsiTIVE",
  ])("classifies the verified credential rejection %j", async (message) => {
    const adapter = new TestCpjourneyAdapter();
    const promise = adapter.login(
      { username: "Test Bot", password: "safe" },
      { timeoutMs: 100 },
    );
    const socket = adapter.sockets[0];

    socket?.serverEmit("connect");
    socket?.serverEmit("message", {
      action: "login",
      args: { success: false, message },
    });

    await expect(promise).rejects.toMatchObject({
      category: "invalid_credentials",
      phase: "transport_connecting",
      retryable: false,
      message,
    });
    expect(adapter.loginMessage).toBe(message);
    expect(socket?.disconnected).toBe(true);
    expect(socket?.listenerCount("message")).toBe(0);
  });

  it("resets banned state before a later login attempt", async () => {
    const adapter = new TestCpjourneyAdapter();
    const bannedPromise = adapter.login(
      { username: "Test Bot", password: "safe" },
      { timeoutMs: 100 },
    );
    const bannedAssertion = expect(bannedPromise).rejects.toMatchObject({
      category: "account_banned",
    });
    adapter.sockets[0]?.serverEmit("connect");
    adapter.sockets[0]?.serverEmit("message", {
      action: "login",
      args: { success: false, message: "Banned: forever" },
    });
    await bannedAssertion;

    const retryPromise = adapter.login(
      { username: "Test Bot", password: "safe" },
      { timeoutMs: 100 },
    );
    expect(adapter.loginStatus).toBe("active");
    expect(adapter.loginMessage).toBeNull();
    const retryAssertion = expect(retryPromise).rejects.toMatchObject({
      category: "invalid_credentials",
    });
    adapter.sockets[1]?.serverEmit("connect");
    adapter.sockets[1]?.serverEmit("message", {
      action: "login",
      args: {
        success: false,
        message: "Incorrect password. NOTE: Passwords are CaSe SeNsiTIVE",
      },
    });

    await retryAssertion;
    expect(adapter.loginStatus).toBe("active");
  });

  it("cancels login and removes temporary listeners", async () => {
    const adapter = new TestCpjourneyAdapter();
    const controller = new AbortController();
    const promise = adapter.login(
      { username: "Test Bot", password: "safe" },
      { signal: controller.signal, timeoutMs: 100 },
    );
    const socket = adapter.sockets[0];

    controller.abort();

    await expect(promise).rejects.toMatchObject({
      category: "aborted",
      retryable: true,
    });
    expect(socket?.disconnected).toBe(true);
    expect(socket?.listenerCount("message")).toBe(0);
    expect(socket?.listenerCount("disconnect")).toBe(0);
  });
});
