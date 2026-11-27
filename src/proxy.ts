import type { Agent } from "node:http";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import {
  type Dispatcher,
  ProxyAgent,
  Socks5ProxyAgent,
  fetch as undiciFetch,
} from "undici";

export type ProxyFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type ProxyTransport = {
  agent: Agent;
  fetch: ProxyFetch;
  close(): Promise<void>;
};

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const SOCKS_PROTOCOLS = new Set(["socks5:", "socks5h:"]);

/** Thrown for an unusable proxy URL; the message never carries credentials. */
export class ProxyConfigError extends Error {
  override name = "ProxyConfigError";
}

/** Scheme and host only, safe for logs and error messages. */
export function proxyLabel(proxy: string): string {
  try {
    const url = new URL(proxy);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "<invalid proxy>";
  }
}

/**
 * Validates a proxy URL (http, https, socks5 or socks5h with a host) and
 * returns it unchanged.
 */
export function parseProxyUrl(proxy: string): string {
  let url: URL;
  try {
    url = new URL(proxy);
  } catch {
    throw new ProxyConfigError("Proxy is not a valid URL");
  }

  const supported =
    HTTP_PROTOCOLS.has(url.protocol) || SOCKS_PROTOCOLS.has(url.protocol);
  if (!supported || !url.hostname) {
    throw new ProxyConfigError(
      `Proxy ${proxyLabel(proxy)} must be http, https, socks5 or socks5h with a host`,
    );
  }

  return proxy;
}

function createDispatcher(proxy: string): Dispatcher {
  const url = new URL(proxy);
  switch (url.protocol) {
    case "http:":
    case "https:":
      return new ProxyAgent(proxy);
    default:
      url.protocol = "socks5:";
      return new Socks5ProxyAgent(url.toString());
  }
}

function createAgent(proxy: string): Agent {
  switch (new URL(proxy).protocol) {
    case "http:":
    case "https:":
      return new HttpsProxyAgent(proxy);
    default:
      return new SocksProxyAgent(proxy);
  }
}

/**
 * Builds the socket agent and fetch implementation that route every
 * connection of one client through `proxy`.
 */
export function createProxyTransport(proxy: string): ProxyTransport {
  const url = parseProxyUrl(proxy);
  const agent = createAgent(url);
  const dispatcher = createDispatcher(url);
  // npm undici's Response has the same shape as the global one but its own type.
  const fetch: ProxyFetch = (input, init) =>
    undiciFetch(input, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    }) as unknown as Promise<Response>;

  return {
    agent,
    fetch,
    async close() {
      agent.destroy();
      await dispatcher.close();
    },
  };
}
