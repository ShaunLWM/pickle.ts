import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createConnection, type Socket } from "node:net";
import { SocksClient } from "socks";
import { ProxyConfigError, proxyLabel } from "./proxy.js";

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "");
}

function connectDirect(
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port, signal });
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

/** HTTP CONNECT tunnel. Error messages carry the proxy label only, never credentials. */
function connectViaHttpProxy(
  proxy: URL,
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<Socket> {
  const secure = proxy.protocol === "https:";
  const target = `${host}:${port}`;
  const auth = proxy.username
    ? `Basic ${Buffer.from(
        `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
      ).toString("base64")}`
    : undefined;

  return new Promise((resolve, reject) => {
    const req = (secure ? httpsRequest : httpRequest)({
      host: hostOf(proxy),
      port: Number(proxy.port) || (secure ? 443 : 80),
      method: "CONNECT",
      path: target,
      signal,
      headers: {
        host: target,
        ...(auth ? { "proxy-authorization": auth } : {}),
      },
    });
    req.once("connect", (res, socket) => {
      if (res.statusCode === 200) {
        resolve(socket);
        return;
      }
      socket.destroy();
      reject(
        new Error(
          `Proxy ${proxyLabel(proxy.href)} refused CONNECT: HTTP ${res.statusCode}`,
        ),
      );
    });
    req.once("error", (cause) =>
      reject(
        new Error(`Proxy ${proxyLabel(proxy.href)} unreachable`, { cause }),
      ),
    );
    req.end();
  });
}

/** SOCKS5. `socks5` resolves the target locally; `socks5h` lets the proxy resolve it. */
async function connectViaSocks(
  proxy: URL,
  host: string,
  port: number,
): Promise<Socket> {
  const destination =
    proxy.protocol === "socks5:" ? (await lookup(host)).address : host;
  try {
    const { socket } = await SocksClient.createConnection({
      command: "connect",
      destination: { host: destination, port },
      proxy: {
        host: hostOf(proxy),
        port: Number(proxy.port) || 1080,
        type: 5,
        ...(proxy.username
          ? {
              userId: decodeURIComponent(proxy.username),
              password: decodeURIComponent(proxy.password),
            }
          : {}),
      },
    });
    return socket;
  } catch (cause) {
    // SocksClientError keeps the full options, proxy password included, so only its message is kept.
    throw new Error(`Proxy ${proxyLabel(proxy.href)} connection failed`, {
      cause: new Error(cause instanceof Error ? cause.message : String(cause)),
    });
  }
}

/**
 * Opens a raw TCP connection to host:port, tunnelled through `proxy` when one is set.
 * `signal` cancels a direct or HTTP CONNECT dial; SOCKS dials end on the client's own timeout.
 */
export function openTcpConnection(
  host: string,
  port: number,
  proxy?: string,
  signal?: AbortSignal,
): Promise<Socket> {
  if (!proxy) return connectDirect(host, port, signal);
  const url = new URL(proxy);
  switch (url.protocol) {
    case "http:":
    case "https:":
      return connectViaHttpProxy(url, host, port, signal);
    case "socks5:":
    case "socks5h:":
      return connectViaSocks(url, host, port);
    default:
      return Promise.reject(
        new ProxyConfigError(
          `Proxy ${proxyLabel(proxy)} cannot tunnel raw TCP`,
        ),
      );
  }
}
