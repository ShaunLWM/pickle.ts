import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";
import { openTcpConnection } from "../proxy-tunnel.js";

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

/** A server that never sends a NUL would otherwise grow the buffer without bound. */
const MAX_PENDING_CHARS = 1 << 20;

/**
 * NUL-delimited Houdini connection over raw TCP, exposing the subset of the `ws`
 * WebSocket API the Houdini adapters use (`open`, `message`, `error`, `close`,
 * `send`, `close()`, `readyState`). TCP splits and merges frames freely, so each
 * `message` carries only whole frames; a partial frame waits for its NUL.
 */
export class TcpFrameSocket extends EventEmitter {
  readyState = CONNECTING;
  private socket: Socket | null = null;
  private pending = "";
  private readonly decoder = new StringDecoder("utf8");
  private readonly dial = new AbortController();

  constructor(host: string, port: number, proxy?: string) {
    super();
    openTcpConnection(host, port, proxy, this.dial.signal).then(
      (socket) => this.attach(socket),
      (error: Error) => this.fail(error),
    );
  }

  /** Parses `tcp://host:port`. */
  static fromUrl(url: string, proxy?: string): TcpFrameSocket {
    const parsed = new URL(url);
    if (parsed.protocol !== "tcp:" || !parsed.port) {
      throw new Error(`Expected tcp://host:port, got ${url}`);
    }
    return new TcpFrameSocket(
      parsed.hostname.replace(/^\[|\]$/g, ""),
      Number(parsed.port),
      proxy,
    );
  }

  send(data: string): void {
    if (this.readyState !== OPEN || !this.socket) {
      throw new Error("TCP connection is not open");
    }
    this.socket.write(data, "utf8");
  }

  close(): void {
    switch (this.readyState) {
      case CONNECTING:
        this.dial.abort();
        this.finish(1006);
        break;
      case OPEN:
        this.readyState = CLOSING;
        this.socket?.destroySoon();
        break;
    }
  }

  private attach(socket: Socket): void {
    if (this.readyState !== CONNECTING) {
      socket.destroy();
      return;
    }
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    socket.on("error", (error) => this.emitError(error));
    socket.on("close", (hadError) => this.finish(hadError ? 1006 : 1000));
    this.readyState = OPEN;
    this.emit("open");
  }

  private receive(chunk: Buffer): void {
    this.pending += this.decoder.write(chunk);
    const end = this.pending.lastIndexOf("\0");
    if (end === -1) {
      if (this.pending.length > MAX_PENDING_CHARS) {
        this.socket?.destroy(new Error("Frame exceeds 1 MiB without NUL"));
      }
      return;
    }
    const frames = this.pending.slice(0, end + 1);
    this.pending = this.pending.slice(end + 1);
    this.emit("message", Buffer.from(frames, "utf8"));
  }

  private fail(error: Error): void {
    if (this.readyState !== CONNECTING) return;
    this.emitError(error);
    this.finish(1006);
  }

  /** Mirrors `ws`: errors go to listeners, but with none attached they must not throw. */
  private emitError(error: Error): void {
    if (this.listenerCount("error") > 0) this.emit("error", error);
  }

  private finish(code: number): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.socket = null;
    this.emit("close", code, Buffer.alloc(0));
  }
}
