import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ClientConnectionTimeouts,
  type ClientDisconnectInfo,
  type ClientLifecycleUpdate,
  ClientOperationError,
  type ClientOperationOptions,
  DEFAULT_CLIENT_CONNECTION_TIMEOUTS,
} from "../src/index.js";

describe("client lifecycle contracts", () => {
  it("exposes stable timeout defaults", () => {
    expect(DEFAULT_CLIENT_CONNECTION_TIMEOUTS).toEqual({
      loginMs: 20_000,
      transportMs: 20_000,
      queueMs: 300_000,
      authenticationMs: 20_000,
      initialStateMs: 15_000,
      requestMs: 15_000,
    });

    expectTypeOf(
      DEFAULT_CLIENT_CONNECTION_TIMEOUTS,
    ).toMatchTypeOf<ClientConnectionTimeouts>();
  });

  it("types lifecycle, operation, and disconnect payloads", () => {
    const update: ClientLifecycleUpdate = {
      phase: "queueing",
      occurredAt: 1,
      queue: { userId: 7, position: 3, queueLength: 10 },
    };
    const options: ClientOperationOptions = {
      timeoutMs: 123,
      signal: new AbortController().signal,
    };
    const disconnect: ClientDisconnectInfo = {
      intentional: false,
      reason: "transport close",
      occurredAt: 2,
    };

    expect(update.queue?.position).toBe(3);
    expect(options.timeoutMs).toBe(123);
    expect(disconnect.intentional).toBe(false);
  });
});

describe("ClientOperationError", () => {
  it("preserves structured classification", () => {
    const error = new ClientOperationError({
      category: "auth_timeout",
      phase: "authenticating",
      retryable: true,
      message: "Authentication timed out",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ClientOperationError");
    expect(error.category).toBe("auth_timeout");
    expect(error.phase).toBe("authenticating");
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("Authentication timed out");
  });

  it("scrubs common credential forms from its public message", () => {
    const error = new ClientOperationError({
      category: "transport_error",
      phase: "transport_connecting",
      retryable: true,
      message:
        "failed https://bot:secret@example.test?token=abc&loginKey=def password=hunter2",
    });

    expect(error.message).not.toContain("secret");
    expect(error.message).not.toContain("abc");
    expect(error.message).not.toContain("def");
    expect(error.message).not.toContain("hunter2");
    expect(error.message).toContain("[REDACTED]");
  });

  it("scrubs quoted and JSON-formatted credential values", () => {
    const error = new ClientOperationError({
      category: "transport_error",
      phase: "transport_connecting",
      retryable: true,
      message:
        'payload={"password":"two words","token":"abc123"} secret=\'still hidden\'',
    });

    expect(error.message).not.toContain("two words");
    expect(error.message).not.toContain("abc123");
    expect(error.message).not.toContain("still hidden");
    expect(error.message.match(/\[REDACTED\]/g)).toHaveLength(3);
  });
});
