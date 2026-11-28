import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type WebSocket, WebSocketServer } from "ws";
import { CpinfiniteAdapter } from "../../src/adapters/cpinfinite-adapter.js";

const REAL_HOST = "wss://server.cpinfinite.com";
const SERVERS_XML = `<servers><environment name="live">
<language locale="en"><server id="3100" name="Marshmallow" port="9875" /></language>
<language locale="es"><server id="3101" name="Glaciar" port="9876" /></language>
</environment></servers>`;

const PLAYER =
  "101|testbot|0|15|0|0|0|0|0|0|0|0|0|0|1|1|0|0|0|0||||||L:0,0,0,0,0,0";

type Received = { path: string; frames: string[] };

let server: WebSocketServer;
let localHost = "";
const connections: Received[] = [];

class TestCpinfiniteAdapter extends CpinfiniteAdapter {
  protected override readonly loginUrl: string = `${localHost}/login`;

  protected override async resolveGameUrl(serverName: string): Promise<string> {
    const url = await super.resolveGameUrl(serverName);
    return url.replace(REAL_HOST, localHost);
  }
}

/** Minimal Houdini server: SFS handshake, then login (l) or world auth (l -> js). */
function handle(socket: WebSocket, path: string): void {
  const rec: Received = { path, frames: [] };
  connections.push(rec);
  const send = (s: string) => socket.send(`${s}\0`);
  socket.on("message", (data) => {
    const frame = data.toString().replace(/\0$/, "");
    rec.frames.push(frame);
    switch (true) {
      case frame.includes('action="verChk"'):
        send('<msg t="sys"><body action="apiOK" r="0" /></msg>');
        break;
      case frame.includes('action="rndK"'):
        send(
          '<msg t="sys"><body action="rndK" r="-1"><k>houdini</k></body></msg>',
        );
        break;
      case frame.includes('action="login"') && path === "/login":
        send(
          "%xt%l%-1%101|101|testbot|safekey|houdini|0|0%confhash%%3100,2|3101,0%%%",
        );
        break;
      case frame.includes('action="login"'):
        send("%xt%l%-1%");
        break;
      case frame.includes("%j#js%"):
        send(
          [
            "%xt%pgu%-1%%",
            "%xt%js%-1%0%0%0%0%",
            `%xt%lp%-1%${PLAYER}%500%0%1440%0%0%0%`,
            `%xt%jr%-1%818%${PLAYER}%`,
          ].join("\0"),
        );
        break;
    }
  });
}

beforeEach(async () => {
  connections.length = 0;
  server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  server.on("connection", (socket, req) => handle(socket, req.url ?? ""));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  localHost = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(SERVERS_XML, { status: 200 })),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("CPInfinite adapter", () => {
  it("logs in, lists servers by servers.xml name, and joins Marshmallow via /blizzard", async () => {
    const adapter = new TestCpinfiniteAdapter();
    const result = await adapter.login({ username: "testbot", password: "pw" });

    expect(result.servers).toEqual([
      { name: "Marshmallow", population: 2 },
      { name: "Glaciar", population: 1 },
    ]);
    expect(result.key).toBe("safekey");

    const messages: string[] = [];
    await adapter.connect("Marshmallow", result, {
      timeouts: { authenticationMs: 1000 },
      onMessage: ({ action }) => messages.push(action),
    });
    adapter.disconnect();

    expect(messages.filter((a) => a !== "pgu")).toEqual([
      "load_player",
      "join_room",
    ]);

    const [login, game] = connections;
    expect(login.path).toBe("/login");
    expect(login.frames[0]).toContain('action="verChk"');
    expect(login.frames[1]).toContain('action="rndK"');
    expect(login.frames[2]).toContain("<nick><![CDATA[testbot]]></nick>");
    expect(game.path).toBe("/blizzard");
    expect(game.frames[2]).toContain("101|101|testbot|safekey");
    expect(game.frames[2]).toContain("safekey#confhash");
    expect(game.frames[3]).toBe("%xt%s%j#js%-1%101%safekey%en%");
  });

  it("filters servers by language", async () => {
    const adapter = new TestCpinfiniteAdapter();
    const result = await adapter.login({
      username: "testbot",
      password: "pw",
      language: "en",
    });
    expect(result.servers.map((s) => s.name)).toEqual(["Marshmallow"]);
  });

  it("rejects server names that have no known game path", async () => {
    const adapter = new TestCpinfiniteAdapter();
    const result = await adapter.login({ username: "testbot", password: "pw" });
    await expect(adapter.connect("Blizzard", result)).rejects.toMatchObject({
      category: "transport_error",
      retryable: false,
    });
  });

  it("treats an unavailable server list as retryable", async () => {
    const adapter = new TestCpinfiniteAdapter();
    const result = await adapter.login({ username: "testbot", password: "pw" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    await expect(adapter.connect("Marshmallow", result)).rejects.toMatchObject({
      category: "transport_error",
      retryable: true,
    });
  });
});
