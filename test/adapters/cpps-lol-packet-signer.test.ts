import { describe, expect, it } from "vitest";
import {
  CppslolPacketSigner,
  canonicalizeCppslolPacketValue,
} from "../../src/adapters/cpps-lol-packet-signer.js";

describe("CPPS.lol packet signing", () => {
  it("canonicalizes nested values and signs increasing server-time sequences", () => {
    let now = 1_000;
    const signer = new CppslolPacketSigner(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      1_700_000_000_000,
      () => now,
    );

    expect(
      canonicalizeCppslolPacketValue({
        nested: { z: 2, a: 1 },
        message: "hello",
      }),
    ).toBe('{"message":"hello","nested":{"a":1,"z":2}}');

    now = 1_005;
    expect(
      signer.sign("send_message", {
        nested: { z: 2, a: 1 },
        message: "hello",
      }),
    ).toEqual({
      action: "send_message",
      args: { nested: { z: 2, a: 1 }, message: "hello" },
      seq: 1,
      ts: 1_700_000_000_005,
      mac: "e84790efad04f1d5016b4b893222eb21edd5aaa1270bccfaf091da3de654d362",
    });

    now = 1_010;
    expect(signer.sign("send_position", { y: 300, x: 400 })).toMatchObject({
      seq: 2,
      ts: 1_700_000_000_010,
      mac: "d3d60ab842f568cb358843a84f73bcf057802cd6a73301340269f021b0ecd28d",
    });
  });
});
