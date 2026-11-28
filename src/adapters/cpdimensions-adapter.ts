import { ClientOperationError } from "../errors.js";
import {
  CpzeroAdapter,
  fetchServersXmlText,
  type GameSocket,
  parseServersXml,
  type ServersXmlEntry,
} from "./cpzero-adapter.js";
import { TcpFrameSocket } from "./tcp-frame-socket.js";

const SERVERS_XML_URL = "https://play.cpdimensions.com/servers.xml";
const HOST = "38.242.207.218";
/** servers.xml `<login>` as captured from the desktop client on 2026-11-28. */
const FALLBACK_LOGIN_URL = `tcp://${HOST}:6112`;
const LOCALE = "pt";

/**
 * servers.xml as captured from the desktop client on 2026-11-28. Cloudflare serves
 * a browser challenge (HTTP 403) to non-browser clients, so this list is the normal
 * path outside a browser; a live servers.xml replaces it whenever one gets through.
 */
const FALLBACK_SERVERS: ReadonlyArray<[number, ServersXmlEntry]> = [
  [3101, { name: "Dimensão Primária", address: HOST, port: 9875 }],
  [3102, { name: "Security Dimension", address: HOST, port: 9876 }],
  [3104, { name: "Gravações Dimensionais", address: HOST, port: 9878 }],
];

/**
 * Club Penguin Dimensions: Houdini behind a Flash (PepperFlash) client, so login
 * and game servers speak NUL-framed SmartFox over raw TCP rather than WebSockets.
 * Hashing matches CPZero; the `rndK` key is a fixed per-server string containing
 * `&`, which arrives XML-escaped.
 */
export class CpdimensionsAdapter extends CpzeroAdapter {
  override readonly id: string = "CPDimensions";
  protected override readonly loginUrl: string = FALLBACK_LOGIN_URL;
  protected override readonly serversXmlUrl: string = SERVERS_XML_URL;
  protected override readonly joinLanguage: string = LOCALE;

  private serversXml?: Promise<string>;

  /** One request per adapter: servers.xml is normally a Cloudflare 403, so repeats only add latency. */
  private loadServersXml(): Promise<string> {
    this.serversXml ??= fetchServersXmlText(this.fetch, this.serversXmlUrl);
    return this.serversXml;
  }

  protected override createSocket(url: string): GameSocket {
    return TcpFrameSocket.fromUrl(url, this.connectionProfile.proxy);
  }

  protected override async loadServers(
    locale?: string,
  ): Promise<Map<number, ServersXmlEntry>> {
    const live = parseServersXml(await this.loadServersXml(), locale);
    if (live.size > 0) return live;
    return new Map(locale && locale !== LOCALE ? [] : FALLBACK_SERVERS);
  }

  protected override async resolveLoginUrl(): Promise<string> {
    const xml = await this.loadServersXml();
    const tag = xml.match(/<login\s([^>]+)>/)?.[1] ?? "";
    const address = tag.match(/address="([^"]+)"/)?.[1];
    const port = tag.match(/port="(\d+)"/)?.[1];
    return address && port ? `tcp://${address}:${port}` : this.loginUrl;
  }

  protected override async resolveGameUrl(serverName: string): Promise<string> {
    const { address, port } = await this.findServer(serverName);
    if (!address || port === undefined) {
      throw new ClientOperationError({
        category: "transport_error",
        phase: "transport_connecting",
        retryable: false,
        message: `${this.id}: server "${serverName}" has no address`,
      });
    }
    return `tcp://${address}:${port}`;
  }
}
