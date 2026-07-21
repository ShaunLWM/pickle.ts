import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CppslolAdapter } from "../../src/adapters/cpps-lol-adapter.js";
import type { LoginResult } from "../../src/index.js";
import { FakeSocket } from "../helpers/fake-socket.js";

const loginResult: LoginResult = {
  servers: [{ name: "LOL", population: 1, users: 22 }],
  key: "safe-test-login-key",
  username: "Test Bot",
  moderator: false,
  buddyWorlds: [],
};

class TestCppslolAdapter extends CppslolAdapter {
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

describe("CPPS.lol login and signed connection", () => {
  it("returns browser bars and exact users, then signs post-auth actions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const adapter = new TestCppslolAdapter();

    const login = adapter.login({ username: "Test Bot", password: "safe" });
    const loginSocket = adapter.sockets[0];
    loginSocket?.serverEmit("connect");
    expect(loginSocket?.sent.at(-1)?.args[0]).toEqual({
      action: "login",
      args: { username: "Test Bot", password: "safe" },
    });
    loginSocket?.serverEmit("message", {
      action: "login",
      args: {
        success: true,
        username: "Test Bot",
        key: "safe-test-login-key",
        populations: { LOL: { bars: 1, users: 22 } },
      },
    });
    await expect(login).resolves.toEqual(loginResult);

    const connection = adapter.connect("LOL", loginResult);
    const gameSocket = adapter.sockets[1];
    gameSocket?.serverEmit("connect");
    expect(gameSocket?.sent.at(-1)?.args[0]).toEqual({
      action: "game_auth",
      args: {
        username: "Test Bot",
        key: "safe-test-login-key",
        createToken: true,
        token: "",
      },
    });
    gameSocket?.serverEmit("message", {
      action: "game_auth",
      args: {
        success: true,
        packetKey:
          "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        serverTime: 1_700_000_000_000,
      },
    });
    await connection;

    expect(gameSocket?.sent.at(-1)?.args[0]).toEqual({
      action: "join_server",
      args: {},
    });

    adapter.walk(400, 300);
    expect(gameSocket?.sent.at(-1)?.args[0]).toMatchObject({
      action: "send_position",
      args: { x: 400, y: 300 },
      seq: 1,
      ts: 1_700_000_000_000,
      mac: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    gameSocket?.serverEmit("disconnect", "transport close");
    expect(() => adapter.walk(400, 300)).toThrow(
      "Not connected or authenticated",
    );
  });

  it("passes a token login token to game auth and clears it on disconnect", async () => {
    const adapter = new TestCppslolAdapter();
    const login = adapter.login({ username: "Test Bot", token: "test-token" });
    const loginSocket = adapter.sockets[0];
    loginSocket?.serverEmit("connect");
    expect(loginSocket?.sent.at(-1)?.args[0]).toEqual({
      action: "token_login",
      args: { username: "Test Bot", token: "test-token" },
    });
    loginSocket?.serverEmit("message", {
      action: "login",
      args: {
        success: true,
        username: "Test Bot",
        key: "safe-test-login-key",
        populations: { LOL: { bars: 1, users: 22 } },
      },
    });
    await login;

    const firstConnection = adapter.connect("LOL", loginResult);
    const firstGameSocket = adapter.sockets[1];
    firstGameSocket?.serverEmit("connect");
    expect(firstGameSocket?.sent.at(-1)?.args[0]).toMatchObject({
      action: "game_auth",
      args: { token: "test-token" },
    });
    firstGameSocket?.serverEmit("message", {
      action: "game_auth",
      args: {
        success: true,
        packetKey:
          "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        serverTime: Date.now(),
      },
    });
    await firstConnection;
    adapter.disconnect();

    const secondConnection = adapter.connect("LOL", loginResult);
    const secondGameSocket = adapter.sockets[2];
    secondGameSocket?.serverEmit("connect");
    expect(secondGameSocket?.sent.at(-1)?.args[0]).toMatchObject({
      action: "game_auth",
      args: { token: "" },
    });
    secondGameSocket?.serverEmit("message", {
      action: "game_auth",
      args: {
        success: true,
        packetKey:
          "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        serverTime: Date.now(),
      },
    });
    await secondConnection;
    adapter.disconnect();
  });
});

describe("CPPS.lol captured actions", () => {
  it("maps shared and CPPS.lol-only methods to their captured packets", () => {
    const adapter = new CppslolAdapter();
    const send = vi.spyOn(adapter, "send").mockImplementation(() => {});

    adapter.sendEmote(36);
    adapter.joinRoom(100, 640, 480);
    adapter.addItem(3032);
    adapter.updateLayeredPlayer(413);
    adapter.acceptMature();
    adapter.removeInventory(3032);
    adapter.getSnowflakeState();
    adapter.getPets(7);
    adapter.getIglooContest();
    adapter.getIglooLikesFor(7);
    adapter.likeIglooById(7);
    adapter.openIglooRaw();
    adapter.sendMail(8, 123);
    adapter.marryRequest(8);

    expect(() => adapter.openIgloo()).toThrow(
      "CPPS.lol does not support openIgloo",
    );

    expect(send.mock.calls).toEqual([
      ["send_emote", { pack: 1, emote: 36 }],
      ["leave_waddle", {}],
      ["join_room", { room: 100, x: 640, y: 480 }],
      ["add_item", { item: "3032" }],
      ["update_player", { item: 413, layer: true }],
      ["accept_mature", {}],
      ["remove_inventory", { item: 3032 }],
      ["get_snowflake_state", {}],
      ["get_pets", { userId: 7 }],
      ["get_igloo_contest", {}],
      ["get_igloo_likes", { iglooId: 7 }],
      ["like_igloo", { iglooId: 7 }],
      ["open_igloo", {}],
      ["send_mail", { recipient: 8, postcardId: 123 }],
      ["marry_request", { id: 8 }],
    ]);
  });
});
