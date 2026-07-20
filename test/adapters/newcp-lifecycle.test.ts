import { createCipheriv } from "node:crypto";
import type { Socket } from "socket.io-client";
import nacl from "tweetnacl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewcpAdapter } from "../../src/adapters/newcp-adapter.js";
import type { LoginResult } from "../../src/index.js";
import { FakeSocket, flushMicrotasks } from "../helpers/fake-socket.js";

const loginResult: LoginResult = {
  servers: [{ name: "Blizzard", population: 1 }],
  key: "safe-test-key",
  username: "Test Bot",
  moderator: false,
  buddyWorlds: [],
};

const aesKey = "12345678901234567890123456789012";

function encryptedHandshake(clientPublicKeyB64: string): {
  encryptedKey: string;
  serverPublicKey: string;
} {
  const server = nacl.box.keyPair();
  const nonce = new Uint8Array(nacl.box.nonceLength);
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ key: aesKey, time: Date.now() }),
  );
  const ciphertext = nacl.box(
    plaintext,
    nonce,
    new Uint8Array(Buffer.from(clientPublicKeyB64, "base64")),
    server.secretKey,
  );
  return {
    encryptedKey: Buffer.concat([
      Buffer.from(nonce),
      Buffer.from(ciphertext),
    ]).toString("base64"),
    serverPublicKey: Buffer.from(server.publicKey).toString("base64"),
  };
}

function encryptMessage(value: Record<string, unknown>): string {
  const iv = Buffer.alloc(16, 1);
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(aesKey), iv);
  return Buffer.concat([
    iv,
    cipher.update(JSON.stringify(value), "utf-8"),
    cipher.final(),
  ]).toString("base64");
}

class TestNewcpAdapter extends NewcpAdapter {
  readonly socketFixture = new FakeSocket();

  constructor() {
    super();
    (this as unknown as { worlds: Record<string, unknown> }).worlds = {
      Blizzard: { host: "https://example.test", path: "/world" },
    };
  }

  protected override createSocket(_host: string, _path: string): Socket {
    return this.socketFixture.asSocket();
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("NewCP connection lifecycle", () => {
  it("installs decrypted message delivery before joining the session", async () => {
    const adapter = new TestNewcpAdapter();
    const messages: string[] = [];
    const promise = adapter.connect("Blizzard", loginResult, {
      timeouts: { authenticationMs: 100 },
      onMessage: ({ action }) => messages.push(action),
    });

    adapter.socketFixture.serverEmit("connect");
    const handshake = adapter.socketFixture.sent.find(
      ({ event }) => event === "handshake",
    );
    const clientPublicKey = handshake?.args[0];
    expect(typeof clientPublicKey).toBe("string");
    const response = encryptedHandshake(clientPublicKey as string);
    adapter.socketFixture.serverEmit(
      "handshake",
      response.encryptedKey,
      response.serverPublicKey,
    );
    await flushMicrotasks();

    adapter.socketFixture.serverEmit(
      "message",
      encryptMessage({ action: "game_auth", args: { success: true } }),
    );
    adapter.socketFixture.serverEmit(
      "message",
      encryptMessage({
        action: "load_player",
        args: { user: { id: 7, username: "Test Bot" } },
      }),
    );
    adapter.socketFixture.serverEmit(
      "message",
      encryptMessage({ action: "join_room", args: { room: 100, users: [] } }),
    );

    await expect(promise).resolves.toBeDefined();
    expect(messages).toEqual(["load_player", "join_room"]);
  });

  it("uses queue silence instead of the authentication timeout", async () => {
    vi.useFakeTimers();
    const adapter = new TestNewcpAdapter();
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
    const handshake = adapter.socketFixture.sent.find(
      ({ event }) => event === "handshake",
    );
    const response = encryptedHandshake(handshake?.args[0] as string);
    adapter.socketFixture.serverEmit(
      "handshake",
      response.encryptedKey,
      response.serverPublicKey,
    );
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(15);
    adapter.socketFixture.serverEmit(
      "message",
      encryptMessage({
        action: "wait_queue_update",
        args: { userId: 7, position: 2, queueLength: 9 },
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(adapter.socketFixture.disconnected).toBe(false);
    await vi.advanceTimersByTimeAsync(20);

    await assertion;
    expect(phases).toContain("queueing");
    expect(adapter.socketFixture.disconnected).toBe(true);
  });
});
