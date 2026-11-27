import { createServer, type Server } from "node:http";
import { type AddressInfo, connect as netConnect, type Socket } from "node:net";
import { io } from "socket.io-client";
import { SocksProxyAgent } from "socks-proxy-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { CpjourneyAdapter } from "../src/adapters/cpjourney-adapter.js";
import { Client } from "../src/client.js";
import { resolveConnectionProfile } from "../src/connection-profile.js";
import { ProxyConfigError, parseProxyUrl, proxyLabel } from "../src/proxy.js";

class ProxiedAdapter extends CpjourneyAdapter {
  constructor(proxy?: string) {
    super(resolveConnectionProfile({ preset: "node", proxy }));
  }

  socketOptions(url: string) {
    return this.socketIoOptions(url);
  }

  wsOptions(url: string) {
    return this.webSocketOptions(url);
  }

  request(url: string) {
    return this.fetch(url);
  }

  agent() {
    return this.proxyAgent();
  }
}

type Harness = {
  target: Server;
  targetUrl: string;
  targetHits: number;
  proxy: Server;
  proxyUrl: string;
  tunnels: string[];
  sockets: Set<Socket>;
};

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function startHarness(): Promise<Harness> {
  const sockets = new Set<Socket>();
  const harness = { tunnels: [], sockets, targetHits: 0 } as unknown as Harness;

  const target = createServer((_req, res) => res.end("ok"));
  target.on("connection", (socket) => {
    harness.targetHits += 1;
    sockets.add(socket);
  });
  new WebSocketServer({ server: target });

  const proxy = createServer();
  proxy.on("connect", (req, client) => {
    harness.tunnels.push(req.url ?? "");
    const [host, port] = (req.url ?? "").split(":");
    const upstream = netConnect(Number(port), host, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    sockets.add(client as Socket);
    upstream.on("error", () => client.destroy());
    client.on("error", () => upstream.destroy());
  });

  const targetPort = await listen(target);
  const proxyPort = await listen(proxy);
  return Object.assign(harness, {
    target,
    targetUrl: `127.0.0.1:${targetPort}`,
    proxy,
    proxyUrl: `http://user:secret@127.0.0.1:${proxyPort}`,
  });
}

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  for (const socket of harness.sockets) socket.destroy();
  await Promise.all([close(harness.target), close(harness.proxy)]);
});

describe("proxy routing", () => {
  it("tunnels fetch through the proxy", async () => {
    const adapter = new ProxiedAdapter(harness.proxyUrl);
    const resp = await adapter.request(`http://${harness.targetUrl}/`);

    expect(await resp.text()).toBe("ok");
    expect(harness.tunnels).toEqual([harness.targetUrl]);
    expect(harness.targetHits).toBe(harness.tunnels.length);
    await adapter.closeProxy();
  });

  it("tunnels raw websockets through the proxy", async () => {
    const adapter = new ProxiedAdapter(harness.proxyUrl);
    const url = `ws://${harness.targetUrl}/`;
    const ws = new WebSocket(url, adapter.wsOptions(url));

    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.close();

    expect(harness.tunnels).toEqual([harness.targetUrl]);
    expect(harness.targetHits).toBe(harness.tunnels.length);
    await adapter.closeProxy();
  });

  it.each([
    ["polling"],
    ["websocket"],
  ])("tunnels socket.io %s transport through the proxy", async (transport) => {
    const adapter = new ProxiedAdapter(harness.proxyUrl);
    const url = `http://${harness.targetUrl}`;
    const socket = io(url, {
      ...adapter.socketOptions(url),
      transports: [transport],
      reconnection: false,
    });

    await vi.waitFor(() => expect(harness.targetHits).toBeGreaterThan(0));
    socket.close();

    expect(harness.tunnels.length).toBeGreaterThan(0);
    expect(new Set(harness.tunnels)).toEqual(new Set([harness.targetUrl]));
    expect(harness.targetHits).toBe(harness.tunnels.length);
    await adapter.closeProxy();
  });

  it("fails closed when the proxy is unreachable", async () => {
    const dead = createServer();
    const deadProxy = `http://user:secret@127.0.0.1:${await listen(dead)}`;
    await close(dead);

    const adapter = new ProxiedAdapter(deadProxy);
    const failure = await adapter
      .request(`http://${harness.targetUrl}/`)
      .catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(
      `${(failure as Error).message} ${String((failure as Error).cause)}`,
    ).not.toContain("secret");

    const url = `ws://${harness.targetUrl}/`;
    const ws = new WebSocket(url, adapter.wsOptions(url));
    await new Promise<void>((resolve) => ws.once("error", () => resolve()));

    expect(harness.targetHits).toBe(0);
    await adapter.closeProxy();
  });

  it("builds a socks agent for socks5 proxies", () => {
    const adapter = new ProxiedAdapter("socks5h://127.0.0.1:1080");
    expect(adapter.agent()).toBeInstanceOf(SocksProxyAgent);
  });

  it("leaves connections direct without a proxy", async () => {
    const adapter = new ProxiedAdapter();
    const resp = await adapter.request(`http://${harness.targetUrl}/`);

    expect(await resp.text()).toBe("ok");
    expect(adapter.socketOptions("http://x").agent).toBeUndefined();
    expect(adapter.wsOptions("ws://x").agent).toBeUndefined();
    expect(harness.tunnels).toEqual([]);
  });
});

describe("proxy configuration", () => {
  it.each([
    ["not a url"],
    ["ftp://user:secret@host:21"],
    ["socks4://user:secret@host:1080"],
  ])("rejects %s without leaking credentials", (proxy) => {
    expect(() => parseProxyUrl(proxy)).toThrow(ProxyConfigError);
    try {
      parseProxyUrl(proxy);
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
    }
  });

  it("rejects a bad proxy when the client is constructed", () => {
    expect(
      () =>
        new Client("CPJourney", {
          connectionProfile: { proxy: "ftp://user:secret@host:21" },
        }),
    ).toThrow(ProxyConfigError);
  });

  it("labels proxies without credentials", () => {
    expect(proxyLabel("http://user:secret@host:8080")).toBe("http://host:8080");
  });
});
