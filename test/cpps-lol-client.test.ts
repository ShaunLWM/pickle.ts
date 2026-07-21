import { describe, expect, it, vi } from "vitest";
import type { BaseAdapter } from "../src/adapters/base-adapter.js";
import type { CppslolAdapter } from "../src/adapters/cpps-lol-adapter.js";
import { Client } from "../src/client.js";

type ClientInternals = {
  adapter: BaseAdapter;
  handleMessage(message: {
    action: string;
    args: Record<string, unknown>;
  }): void;
};

function internals(client: Client): ClientInternals {
  return client as unknown as ClientInternals;
}

describe("CPPS.lol client capability", () => {
  it("routes raw igloo opening through the CPPS.lol facade", async () => {
    const client = new Client("CPPSlol");
    const adapter = internals(client).adapter as CppslolAdapter;
    const send = vi.spyOn(adapter, "send").mockImplementation(() => {});

    client.cppslol.openIgloo();

    expect(send).toHaveBeenCalledWith("open_igloo", {});
    await expect(client.openIgloo()).rejects.toMatchObject({
      category: "unsupported_operation",
    });
  });

  it("rejects CPPS.lol-only actions on another adapter", () => {
    const client = new Client("CPJourney");

    expect(() => client.cppslol.acceptMature()).toThrowError(
      expect.objectContaining({
        category: "unsupported_operation",
        retryable: false,
      }),
    );
  });
});

describe("CPPS.lol normalized state", () => {
  it("synchronizes layered appearance, inventory, and coins", () => {
    const client = new Client("CPPSlol");
    const { handleMessage } = internals(client);
    const rawUser = {
      id: 7,
      username: "Test Bot",
      color: 1,
      headLayer: 0,
    };

    handleMessage.call(internals(client), {
      action: "load_player",
      args: {
        user: rawUser,
        coins: 500,
        rank: 1,
        inventory: [100, 200],
      },
    });
    handleMessage.call(internals(client), {
      action: "join_room",
      args: { room: 100, users: [rawUser] },
    });
    handleMessage.call(internals(client), {
      action: "update_player",
      args: { id: 7, item: 413, slot: "headLayer" },
    });

    expect(client.player?.meta.headLayer).toBe(413);
    expect(client.users.get(7)?.meta.headLayer).toBe(413);

    handleMessage.call(internals(client), {
      action: "add_item",
      args: { item: "3032", coins: 450 },
    });
    expect(client.player).toMatchObject({
      coins: 450,
      inventory: [100, 200, 3032],
    });

    handleMessage.call(internals(client), {
      action: "remove_inventory",
      args: { id: "200" },
    });
    expect(client.player?.inventory).toEqual([100, 3032]);
  });
});
