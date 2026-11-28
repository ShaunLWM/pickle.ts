import { ClientOperationError } from "../errors.js";
import { CpzeroAdapter } from "./cpzero-adapter.js";

const HOST = "wss://server.cpinfinite.com";
const SERVERS_XML_URL = "https://play.cpinfinite.com/servers.xml";

/**
 * Game WebSocket paths keyed by servers.xml port, from the client's Ruffle
 * `socketProxy` config. Paths are not derived from server names:
 * Marshmallow (3100, port 9875) is served at /blizzard.
 */
const GAME_PATH_BY_PORT: Readonly<Record<number, string>> = {
  9875: "blizzard",
  9876: "glaciar",
  9877: "avalanche",
  9878: "yeti",
};

/** Club Penguin Infinite: Houdini/AS2 over Ruffle WebSockets, same protocol as CPZero. */
export class CpinfiniteAdapter extends CpzeroAdapter {
  override readonly id: string = "CPInfinite";
  protected override readonly loginUrl: string = `${HOST}/login`;
  protected override readonly serversXmlUrl: string = SERVERS_XML_URL;

  protected override async resolveGameUrl(serverName: string): Promise<string> {
    const { port } = await this.findServer(serverName);
    const path = port === undefined ? undefined : GAME_PATH_BY_PORT[port];
    if (!path) {
      throw new ClientOperationError({
        category: "transport_error",
        phase: "transport_connecting",
        retryable: false,
        message: `${this.id}: no game path for server "${serverName}"`,
      });
    }
    return `${HOST}/${path}`;
  }
}
