import { createServer as createHttpServer } from "node:http";
import { type AddressInfo, connect as netConnect, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { CpdimensionsAdapter } from "../../src/adapters/cpdimensions-adapter.js";
import { resolveConnectionProfile } from "../../src/connection-profile.js";
import {
  close,
  env,
  listen,
  socks5,
  useFakeHoudini,
} from "../helpers/fake-houdini-tcp.js";

useFakeHoudini();

describe("CPDimensions adapter proxies", () => {
  it("tunnels login and game connections through an HTTP proxy", async () => {
    const tunnels: string[] = [];
    const proxy = createHttpServer();
    proxy.on("connect", (req, client) => {
      tunnels.push(req.url ?? "");
      const [host, port] = (req.url ?? "").split(":");
      const upstream = netConnect(Number(port), host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(client);
        client.pipe(upstream);
      });
      env.sockets.add(upstream);
      env.sockets.add(client as Socket);
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    });
    const proxyPort = await new Promise<number>((resolve) =>
      proxy.listen(0, "127.0.0.1", () =>
        resolve((proxy.address() as AddressInfo).port),
      ),
    );

    const adapter = new CpdimensionsAdapter(
      resolveConnectionProfile({
        preset: "node",
        proxy: `http://user:secret@127.0.0.1:${proxyPort}`,
      }),
    );
    // fetch is stubbed globally; the proxied fetch would bypass the stub.
    Object.defineProperty(adapter, "fetch", { value: globalThis.fetch });

    const result = await adapter.login({ username: "testbot", password: "pw" });
    await adapter.connect("Dimensão Primária", result, {
      timeouts: { authenticationMs: 1000 },
    });
    adapter.disconnect();
    await adapter.closeProxy();
    await close(proxy);

    expect(tunnels).toEqual([
      `127.0.0.1:${env.loginPort}`,
      `127.0.0.1:${env.gamePort}`,
    ]);
  });

  it("tunnels login and game connections through a SOCKS5 proxy", async () => {
    const tunnels: string[] = [];
    const proxy = socks5(tunnels);
    const proxyPort = await listen(proxy);
    const adapter = new CpdimensionsAdapter(
      resolveConnectionProfile({
        preset: "node",
        proxy: `socks5h://127.0.0.1:${proxyPort}`,
      }),
    );
    Object.defineProperty(adapter, "fetch", { value: globalThis.fetch });

    const result = await adapter.login({ username: "testbot", password: "pw" });
    await adapter.connect("Dimensão Primária", result, {
      timeouts: { authenticationMs: 1000 },
    });
    adapter.disconnect();
    await adapter.closeProxy();
    await close(proxy);

    expect(tunnels).toEqual([
      `127.0.0.1:${env.loginPort}`,
      `127.0.0.1:${env.gamePort}`,
    ]);
  });
});
