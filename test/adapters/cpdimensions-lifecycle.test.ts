import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CpdimensionsAdapter } from "../../src/adapters/cpdimensions-adapter.js";
import { env, RNDK, useFakeHoudini } from "../helpers/fake-houdini-tcp.js";

useFakeHoudini();

describe("CPDimensions adapter", () => {
  it("logs in and joins a world over raw TCP using servers.xml hosts", async () => {
    const adapter = new CpdimensionsAdapter();
    const result = await adapter.login({ username: "testbot", password: "pw" });

    expect(result.key).toBe("safekey");
    expect(result.servers).toEqual([
      { name: "Server 3103", population: 8 },
      { name: "Gravações Dimensionais", population: 8 },
      { name: "Dimensão Primária", population: 1 },
    ]);

    const messages: { action: string; args: Record<string, unknown> }[] = [];
    await adapter.connect("dimensão primária", result, {
      timeouts: { authenticationMs: 1000 },
      onMessage: (m) => messages.push(m),
    });
    await vi.waitFor(() =>
      expect(messages.map((m) => m.action)).toContain("send_message"),
    );
    adapter.disconnect();

    expect(messages.map((m) => m.action)).toEqual([
      "load_player",
      "join_room",
      "send_message",
    ]);
    expect(messages[2].args).toEqual({ id: 101, message: "olá" });

    const [loginConn, gameConn] = env.received;
    expect(loginConn.server).toBe("login");
    expect(loginConn.frames[2]).toContain("<nick><![CDATA[testbot]]></nick>");
    // Hashes use the XML-unescaped key: "&amp;" on the wire is "&" in the hash.
    const key = RNDK.replaceAll("&amp;", "&");
    const md5 = (v: string) => createHash("md5").update(v).digest("hex");
    const swap = (h: string) => h.slice(16) + h.slice(0, 16);
    const loginHash = swap(
      md5(`${swap(md5("pw").toUpperCase())}${key}Y(02.>'H}t":E1`),
    );
    expect(loginConn.frames[2]).toContain(`<pword><![CDATA[${loginHash}]]>`);
    expect(gameConn.server).toBe("game");
    expect(gameConn.frames[2]).toContain("101|101|testbot|safekey|houdini|3|0");
    expect(gameConn.frames[2]).toContain(
      `${swap(md5(`safekey${key}`))}safekey#confhash`,
    );
    expect(gameConn.frames[3]).toBe("%xt%s%j#js%-1%101%safekey%pt%");
  });

  it("filters servers by language", async () => {
    const adapter = new CpdimensionsAdapter();
    const result = await adapter.login({
      username: "testbot",
      password: "pw",
      language: "pt",
    });
    expect(result.servers.map((s) => s.name)).toEqual([
      "Gravações Dimensionais",
      "Dimensão Primária",
    ]);
  });

  it("rejects unknown server names as not retryable", async () => {
    const adapter = new CpdimensionsAdapter();
    const result = await adapter.login({ username: "testbot", password: "pw" });
    await expect(adapter.connect("Nowhere", result)).rejects.toMatchObject({
      category: "transport_error",
      retryable: false,
    });
  });

  it("falls back to the captured server list when Cloudflare blocks servers.xml", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<title>Just a moment...</title>", { status: 403 }),
      ),
    );
    class LocalLogin extends CpdimensionsAdapter {
      protected override readonly loginUrl = `tcp://127.0.0.1:${env.loginPort}`;
      gameUrl(name: string): Promise<string> {
        return this.resolveGameUrl(name);
      }
    }
    const adapter = new LocalLogin();
    const result = await adapter.login({ username: "testbot", password: "pw" });

    expect(result.servers.map((s) => s.name)).toEqual([
      "Server 3103",
      "Gravações Dimensionais",
      "Dimensão Primária",
    ]);
    await expect(adapter.gameUrl("Security Dimension")).resolves.toBe(
      "tcp://38.242.207.218:9876",
    );
  });
});
