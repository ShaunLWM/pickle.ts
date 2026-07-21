import { createHmac } from "node:crypto";

export type CppslolSignedPacket = {
  action: string;
  args: Record<string, unknown>;
  seq: number;
  ts: number;
  mac: string;
};

/** Canonical JSON encoding used by CPPS.lol before calculating a packet MAC. */
export function canonicalizeCppslolPacketValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeCppslolPacketValue).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalizeCppslolPacketValue(object[key])}`,
    )
    .join(",")}}`;
}

export class CppslolPacketSigner {
  private sequence = 0;
  private readonly clockOffsetMs: number;
  private readonly key: Buffer;

  constructor(
    packetKey: string,
    serverTime: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!/^(?:[0-9a-fA-F]{2})+$/.test(packetKey)) {
      throw new Error("CPPS.lol returned an invalid packet key");
    }
    if (!Number.isFinite(serverTime)) {
      throw new Error("CPPS.lol returned an invalid server time");
    }

    this.key = Buffer.from(packetKey, "hex");
    this.clockOffsetMs = serverTime - this.now();
  }

  sign(action: string, args: Record<string, unknown>): CppslolSignedPacket {
    const seq = ++this.sequence;
    const ts = this.now() + this.clockOffsetMs;
    const input = `${seq}.${ts}.${action}.${canonicalizeCppslolPacketValue(args)}`;
    const mac = createHmac("sha256", this.key).update(input).digest("hex");

    return { action, args, seq, ts, mac };
  }
}
