import { createServer, type Server, type Socket } from "node:net";
import { inspect } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { TcpFrameSocket } from "../src/adapters/tcp-frame-socket.js";
import { openTcpConnection } from "../src/proxy-tunnel.js";

const servers: Server[] = [];
const sockets = new Set<Socket>();

function serve(onClient: (client: Socket) => void): Promise<number> {
  const server = createServer((client) => {
    sockets.add(client);
    client.on("error", () => {});
    onClient(client);
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    }),
  );
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.all(
    servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))),
  );
});

describe("openTcpConnection", () => {
  it("keeps SOCKS5 proxy credentials out of the error and its cause", async () => {
    // Refuses every offered auth method.
    const port = await serve((client) =>
      client.once("data", () => client.end(Buffer.from([5, 0xff]))),
    );
    const error = await openTcpConnection(
      "127.0.0.1",
      1,
      `socks5h://user:hunter2@127.0.0.1:${port}`,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(inspect(error, { depth: 10 })).not.toContain("hunter2");
  });
});

describe("TcpFrameSocket", () => {
  it("abandons an unanswered HTTP CONNECT when closed while connecting", async () => {
    let accepted!: (client: Socket) => void;
    const proxied = new Promise<Socket>((resolve) => {
      accepted = resolve;
    });
    // Accepts the tunnel request and never answers it.
    const port = await serve((client) => accepted(client));
    const socket = new TcpFrameSocket(
      "127.0.0.1",
      6112,
      `http://127.0.0.1:${port}`,
    );
    const proxySide = await proxied;
    const proxySideClosed = new Promise((resolve) =>
      proxySide.once("close", resolve),
    );

    socket.close();

    await proxySideClosed;
    expect(socket.readyState).toBe(3);
  });
});
