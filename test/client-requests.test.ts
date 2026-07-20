import { describe, expect, it } from "vitest";
import type { BaseAdapter } from "../src/adapters/base-adapter.js";
import { Client } from "../src/index.js";

function replaceAdapter(client: Client, methods: Partial<BaseAdapter>): void {
  Object.assign(
    (client as unknown as { adapter: BaseAdapter }).adapter,
    methods,
  );
}

describe("Client request/response methods", () => {
  it.each([
    {
      name: "joinRoom",
      event: "join_room" as const,
      response: { room: 100, users: [] },
      install(client: Client) {
        replaceAdapter(client, {
          joinRoom: () => client.emit("join_room", this.response),
        });
      },
      invoke: (client: Client) => client.joinRoom(100),
    },
    {
      name: "joinIgloo",
      event: "join_igloo" as const,
      response: {
        igloo: 7,
        users: [],
        type: 1,
        flooring: 0,
        music: 0,
        location: 1,
        furniture: [],
      },
      install(client: Client) {
        replaceAdapter(client, {
          joinIgloo: () => client.emit("join_igloo", this.response),
        });
      },
      invoke: (client: Client) => client.joinIgloo(7),
    },
    {
      name: "getIgloos",
      event: "get_igloos" as const,
      response: { igloos: [], myIglooLikes: 0 },
      install(client: Client) {
        replaceAdapter(client, {
          getIgloos: () => client.emit("get_igloos", this.response),
        });
      },
      invoke: (client: Client) => client.getIgloos(),
    },
    {
      name: "getIglooLikes",
      event: "get_igloo_likes" as const,
      response: { likes: 12 },
      install(client: Client) {
        replaceAdapter(client, {
          getIglooLikes: () => client.emit("get_igloo_likes", this.response),
        });
      },
      invoke: (client: Client) => client.getIglooLikes(),
    },
    {
      name: "getPuffles",
      event: "get_puffles" as const,
      response: { userId: 7, puffles: [] },
      install(client: Client) {
        replaceAdapter(client, {
          getPuffles: () => client.emit("get_puffles", this.response),
        });
      },
      invoke: (client: Client) => client.getPuffles(7),
    },
    {
      name: "getAllPuffles",
      event: "get_all_puffles" as const,
      response: { puffles: [] },
      install(client: Client) {
        replaceAdapter(client, {
          getAllPuffles: () => client.emit("get_all_puffles", this.response),
        });
      },
      invoke: (client: Client) => client.getAllPuffles(),
    },
    {
      name: "getPuffleWellbeing",
      event: "get_wellbeing" as const,
      response: {
        puffleId: 11,
        energy: 95,
        health: 100,
        rest: 90,
        name: "Test Puffle",
        type: 0,
        level: 1,
        experience: 50,
      },
      install(client: Client) {
        replaceAdapter(client, {
          getPuffleWellbeing: () => client.emit("get_wellbeing", this.response),
        });
      },
      invoke: (client: Client) => client.getPuffleWellbeing(11),
    },
    {
      name: "buyPuffleItem",
      event: "buy_puffle_item" as const,
      response: {
        puffleId: 11,
        item: 4,
        coins: 200,
        puffleInventory: {},
      },
      install(client: Client) {
        replaceAdapter(client, {
          buyPuffleItem: () => client.emit("buy_puffle_item", this.response),
        });
      },
      invoke: (client: Client) => client.buyPuffleItem(11, 4),
    },
    {
      name: "walkPuffle",
      event: "get_walking_puffle" as const,
      response: { puffle: { id: 11, type: 0, walking: false } },
      install(client: Client) {
        replaceAdapter(client, {
          walkPuffle: () => client.emit("get_walking_puffle", this.response),
        });
      },
      invoke: (client: Client) => client.walkPuffle(11),
    },
    {
      name: "getIglooStoreItems",
      event: "get_igloostore_items" as const,
      response: { furniture: [], flooring: [], igloo: [], location: [] },
      install(client: Client) {
        replaceAdapter(client, {
          getIglooStoreItems: () =>
            client.emit("get_igloostore_items", this.response),
        });
      },
      invoke: (client: Client) => client.getIglooStoreItems(),
    },
    {
      name: "buyFurniture",
      event: "add_furniture" as const,
      response: { furniture: "1", coins: 200, amount: 1 },
      install(client: Client) {
        replaceAdapter(client, {
          buyFurniture: () => client.emit("add_furniture", this.response),
        });
      },
      invoke: (client: Client) => client.buyFurniture("1"),
    },
    {
      name: "updateIglooMusic",
      event: "update_music" as const,
      response: { music: "1" },
      install(client: Client) {
        replaceAdapter(client, {
          updateIglooMusic: () => client.emit("update_music", this.response),
        });
      },
      invoke: (client: Client) => client.updateIglooMusic("1"),
    },
    {
      name: "openIgloo",
      event: "igloo_open_status" as const,
      response: { status: 1 },
      install(client: Client) {
        replaceAdapter(client, {
          openIgloo: () => client.emit("igloo_open_status", this.response),
        });
      },
      invoke: (client: Client) => client.openIgloo(),
    },
    {
      name: "closeIglooBounds",
      event: "igloo_bounds_status" as const,
      response: { status: 1 },
      install(client: Client) {
        replaceAdapter(client, {
          closeIglooBounds: () =>
            client.emit("igloo_bounds_status", this.response),
        });
      },
      invoke: (client: Client) => client.closeIglooBounds(),
    },
    {
      name: "likeIgloo",
      event: "igloo_liked" as const,
      response: {},
      install(client: Client) {
        replaceAdapter(client, {
          likeIgloo: () => client.emit("igloo_liked", this.response),
        });
      },
      invoke: (client: Client) => client.likeIgloo(),
    },
  ])("installs the $event listener before $name sends", async (scenario) => {
    const client = new Client("CPJourney");
    scenario.install(client);

    await expect(scenario.invoke(client)).resolves.toEqual(scenario.response);
    expect(client.listenerCount(scenario.event)).toBe(0);
    expect(client.listenerCount("disconnect")).toBe(0);
  });

  it("cleans listeners when the send callback throws", async () => {
    const client = new Client("CPJourney");
    replaceAdapter(client, {
      getIgloos: () => {
        throw new Error("not connected");
      },
    });

    await expect(client.getIgloos()).rejects.toMatchObject({
      category: "transport_error",
      retryable: true,
    });
    expect(client.listenerCount("get_igloos")).toBe(0);
    expect(client.listenerCount("disconnect")).toBe(0);
  });

  it("preserves non-retryable unsupported-operation errors", async () => {
    const client = new Client("CPLegacy");

    await expect(client.getAllPuffles()).rejects.toMatchObject({
      category: "unsupported_operation",
      phase: "ready",
      retryable: false,
      message: "CPLegacy does not support getAllPuffles",
    });
  });

  it("ignores same-action responses that do not match the request", async () => {
    const client = new Client("CPJourney");
    replaceAdapter(client, {
      getPuffles: () => {},
    });
    const promise = client.getPuffles(7);

    client.emit("get_puffles", { userId: 8, puffles: [] });
    expect(client.listenerCount("get_puffles")).toBe(1);

    client.emit("get_puffles", { userId: 7, puffles: [] });
    await expect(promise).resolves.toEqual({ userId: 7, puffles: [] });
  });

  it("serializes concurrent requests that wait for the same action", async () => {
    const client = new Client("CPJourney");
    const sent: number[] = [];
    replaceAdapter(client, {
      getPuffles: (userId) => {
        sent.push(userId);
      },
    });

    const first = client.getPuffles(7);
    const second = client.getPuffles(8);
    await Promise.resolve();
    expect(sent).toEqual([7]);

    client.emit("get_puffles", { userId: 7, puffles: [] });
    await expect(first).resolves.toEqual({ userId: 7, puffles: [] });
    await Promise.resolve();
    expect(sent).toEqual([7, 8]);

    client.emit("get_puffles", { userId: 8, puffles: [] });
    await expect(second).resolves.toEqual({ userId: 8, puffles: [] });
  });

  it("rejects queued same-action requests when the client disconnects", async () => {
    const client = new Client("CPJourney");
    let sends = 0;
    replaceAdapter(client, {
      getIgloos: () => {
        sends += 1;
      },
    });

    const first = client.getIgloos();
    const second = client.getIgloos();
    const firstAssertion = expect(first).rejects.toMatchObject({
      category: "disconnected",
    });
    const secondAssertion = expect(second).rejects.toMatchObject({
      category: "disconnected",
    });
    expect(sends).toBe(1);

    (
      client as unknown as {
        handleAdapterDisconnect(reason: string | null): void;
      }
    ).handleAdapterDisconnect("transport close");

    await Promise.all([firstAssertion, secondAssertion]);
    expect(sends).toBe(1);
  });

  it("installs Card-Jitsu response listeners before sending", async () => {
    const client = new Client("CPJourney");
    const response = {
      rank: 1,
      progress: 2,
      fire: { rank: 0, progress: 0 },
      water: { rank: 0, progress: 0 },
      cards: [],
    };
    replaceAdapter(client, {
      getNinja: () => client.emit("get_ninja", response),
    });

    await expect(client.cardJitsu.getNinja()).resolves.toEqual(response);
    expect(client.listenerCount("get_ninja")).toBe(0);
    expect(client.listenerCount("disconnect")).toBe(0);
  });
});
