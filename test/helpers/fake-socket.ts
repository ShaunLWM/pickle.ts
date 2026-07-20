import { EventEmitter } from "node:events";
import type { Socket } from "socket.io-client";

export class FakeSocket extends EventEmitter {
  readonly sent: Array<{ event: string; args: unknown[] }> = [];
  connected = false;
  disconnected = false;

  override emit(event: string, ...args: unknown[]): boolean {
    this.sent.push({ event, args });
    return true;
  }

  serverEmit(event: string, ...args: unknown[]): boolean {
    if (event === "connect") this.connected = true;
    if (event === "disconnect") {
      this.connected = false;
      this.disconnected = true;
    }
    return super.emit(event, ...args);
  }

  disconnect(): this {
    if (this.disconnected) return this;
    this.connected = false;
    this.disconnected = true;
    super.emit("disconnect", "io client disconnect");
    return this;
  }

  asSocket(): Socket {
    return this as unknown as Socket;
  }
}

export async function flushMicrotasks(count = 3): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
