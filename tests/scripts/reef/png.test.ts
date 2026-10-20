// The review figure's PNG writer (scripts/reef/png.ts): what it writes is a PNG a reader takes apart into the pixels it
// was given, every chunk's CRC right.
//
// Seen red (L49): the filter byte written as 1 instead of 0 on every row (the pixels case red); the CRC taken over the
// data without the chunk type (the CRC case red).
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, encodePng } from "../../../scripts/reef/png.ts";

/** The chunks of a PNG: type, data, and whether its CRC is right. */
function chunks(png: Uint8Array): { type: string; data: Uint8Array; crcOk: boolean }[] {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  for (let at = 8; at < png.length; ) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    out.push({ type, data, crcOk: v.getUint32(at + 8 + len) === crc32(png.subarray(at + 4, at + 8 + len)) });
    at += 12 + len;
  }
  return out;
}

describe("the PNG writer", () => {
  const w = 3;
  const h = 2;
  const rgb = Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 37) % 256);
  const png = encodePng(rgb, w, h);

  it("writes the signature, IHDR, one IDAT and IEND, each CRC right", () => {
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const c = chunks(png);
    expect(c.map((x) => x.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(c.every((x) => x.crcOk)).toBe(true);
    expect(crc32(new TextEncoder().encode("IEND"))).toBe(0xae426082);
  });

  it("says its size, 8-bit truecolour, and holds the pixels row by row, unfiltered", () => {
    const [ihdr, idat] = chunks(png);
    const v = new DataView((ihdr as { data: Uint8Array }).data.buffer, (ihdr as { data: Uint8Array }).data.byteOffset);
    expect([v.getUint32(0), v.getUint32(4), v.getUint8(8), v.getUint8(9)]).toEqual([w, h, 8, 2]);
    const raw = new Uint8Array(inflateSync((idat as { data: Uint8Array }).data));
    expect(raw.length).toBe((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      expect(raw[y * (w * 3 + 1)]).toBe(0);
      expect([...raw.subarray(y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1))]).toEqual([...rgb.subarray(y * w * 3, (y + 1) * w * 3)]);
    }
  });

  it("refuses pixels that are not its size", () => {
    expect(() => encodePng(new Uint8Array(5), 2, 1)).toThrow(/6 expected/);
    expect(() => encodePng(new Uint8Array(0), 0, 0)).toThrow(/0 × 0/);
  });
});
