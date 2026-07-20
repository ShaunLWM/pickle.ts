import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, ClientOperationError } from "../src/index.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("Client.waitFor", () => {
  it("removes response, disconnect, abort, and timer handlers after success", async () => {
    vi.useFakeTimers();
    const client = new Client("CPJourney");
    const controller = new AbortController();
    const baselineDisconnect = client.listenerCount("disconnect");
    const promise = client.waitFor("join_room", {
      signal: controller.signal,
      timeoutMs: 50,
    });

    expect(client.listenerCount("join_room")).toBe(1);
    expect(client.listenerCount("disconnect")).toBe(baselineDisconnect + 1);

    client.emit("join_room", { room: 100, users: [] });

    await expect(promise).resolves.toEqual({ room: 100, users: [] });
    expect(client.listenerCount("join_room")).toBe(0);
    expect(client.listenerCount("disconnect")).toBe(baselineDisconnect);
    expect(vi.getTimerCount()).toBe(0);

    controller.abort();
  });

  it("removes handlers and returns a typed error after timeout", async () => {
    vi.useFakeTimers();
    const client = new Client("CPJourney");
    const promise = client.waitFor("join_room", { timeoutMs: 50 });
    const assertion = expect(promise).rejects.toMatchObject({
      name: "ClientOperationError",
      category: "operation_timeout",
      phase: "ready",
      retryable: true,
    });

    await vi.advanceTimersByTimeAsync(50);
    await assertion;

    expect(client.listenerCount("join_room")).toBe(0);
    expect(client.listenerCount("disconnect")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes handlers and returns a typed error after abort", async () => {
    const client = new Client("CPJourney");
    const controller = new AbortController();
    const promise = client.waitFor("join_room", {
      signal: controller.signal,
      timeoutMs: 50,
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({
      category: "aborted",
      retryable: true,
    });
    expect(client.listenerCount("join_room")).toBe(0);
    expect(client.listenerCount("disconnect")).toBe(0);
  });

  it("removes handlers and returns a typed error after disconnect", async () => {
    const client = new Client("CPJourney");
    const promise = client.waitFor("join_room", { timeoutMs: 50 });

    client.emit("disconnect", {
      intentional: false,
      reason: "transport close",
      occurredAt: Date.now(),
    });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClientOperationError);
    expect(error).toMatchObject({ category: "disconnected", retryable: true });
    expect(client.listenerCount("join_room")).toBe(0);
    expect(client.listenerCount("disconnect")).toBe(0);
  });

  it("keeps the numeric timeout overload for compatibility", async () => {
    vi.useFakeTimers();
    const client = new Client("CPJourney");
    const promise = client.waitFor("join_room", 25);
    const assertion = expect(promise).rejects.toMatchObject({
      category: "operation_timeout",
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });
});
