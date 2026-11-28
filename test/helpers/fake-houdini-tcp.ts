import {
  type AddressInfo,
  createServer,
  connect as netConnect,
  type Server,
  type Socket,
} from "node:net";
import { afterEach, beforeEach, vi } from "vitest";

/** Synthetic fixed key; contains "&" so it arrives XML-escaped like the real one. */
export const RNDK = "k3y&amp;Syn7h&amp;etic";
export const PLAYER =
  "101|testbot|3|15|1285|0|0|0|0|0|0|9106|0|0|1|1|259|0|0|0||||||||||||||||||";

export type Received = { server: "login" | "game"; frames: string[] };

/** Live state of the fake servers for the current test. */
export const env = {
  loginPort: 0,
  gamePort: 0,
  received: [] as Received[],
  sockets: new Set<Socket>(),
};
let login: Server;
let game: Server;

function serversXml(): string {
  return `<servers><environment name="live">
<login address="127.0.0.1" port="${env.loginPort}" />
<language locale="pt">
<server id="3101" name="Dimensão Primária" safe="false" address="127.0.0.1" port="${env.gamePort}" />
<server id="3104" name="Gravações Dimensionais" safe="false" address="127.0.0.1" port="${env.gamePort}" />
</language></environment></servers>`;
}

/** Writes `bytes` in two TCP segments split at `at`, so frames straddle reads. */
function writeSplit(socket: Socket, bytes: Buffer, at: number): void {
  socket.write(bytes.subarray(0, at));
  setTimeout(() => socket.write(bytes.subarray(at)), 5);
}

/** Minimal Houdini over TCP: SFS handshake, then login (l) or world auth (l -> js). */
function houdini(kind: Received["server"]): Server {
  return createServer((socket) => {
    env.sockets.add(socket);
    const rec: Received = { server: kind, frames: [] };
    env.received.push(rec);
    const send = (s: string) => socket.write(`${s}\0`);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const frames = buffer.split("\0");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        rec.frames.push(frame);
        switch (true) {
          case frame.includes('action="verChk"'):
            send('<msg t="sys"><body action="apiOK" r="0" /></msg>');
            break;
          case frame.includes('action="rndK"'):
            send(
              `<msg t="sys"><body action="rndK" r="-1"><k>${RNDK}</k></body></msg>`,
            );
            break;
          case frame.includes('action="login"') && kind === "login": {
            const reply = Buffer.from(
              "%xt%l%-1%101|101|testbot|safekey|houdini|3|0%confhash%%3103,8|3104,8|3101,0%%a@b.c%\0",
            );
            writeSplit(socket, reply, 20);
            break;
          }
          case frame.includes('action="login"'):
            send("%xt%l%-1%%");
            break;
          case frame.includes("%j#js%"): {
            const burst = Buffer.from(
              [
                "%xt%js%-1%0%0%0%0%",
                `%xt%lp%-1%${PLAYER}%490%0%1440%0%259%0%`,
                `%xt%jr%-1%10009%${PLAYER}%`,
                "%xt%sm%-1%101%olá%",
                "",
              ].join("\0"),
            );
            writeSplit(socket, burst, burst.indexOf("á") + 1);
            break;
          }
        }
      }
    });
    socket.on("error", () => {});
  });
}

/** No-auth SOCKS5 server that records each CONNECT target and pipes to it. */
export function socks5(tunnels: string[]): Server {
  return createServer((client) => {
    env.sockets.add(client);
    client.once("data", () => {
      client.write(Buffer.from([5, 0]));
      client.once("data", (req) => {
        const atyp = req[3];
        const host =
          atyp === 1
            ? [...req.subarray(4, 8)].join(".")
            : req.subarray(5, 5 + req[4]).toString();
        const port = req.readUInt16BE(req.length - 2);
        tunnels.push(`${host}:${port}`);
        const upstream = netConnect(port, host, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          upstream.pipe(client);
          client.pipe(upstream);
        });
        env.sockets.add(upstream);
        upstream.on("error", () => client.destroy());
      });
    });
    client.on("error", () => {});
  });
}

export function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
}

export function close(server: {
  close(cb: () => void): unknown;
}): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Starts fake login and game servers and stubs servers.xml around each test. */
export function useFakeHoudini(): void {
  beforeEach(async () => {
    env.received.length = 0;
    login = houdini("login");
    game = houdini("game");
    env.loginPort = await listen(login);
    env.gamePort = await listen(game);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(serversXml(), { status: 200 })),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const socket of env.sockets) socket.destroy();
    env.sockets.clear();
    await Promise.all([close(login), close(game)]);
  });
}
