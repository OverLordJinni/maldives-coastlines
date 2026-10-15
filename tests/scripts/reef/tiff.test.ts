// The traced reef's GeoTIFF reader (scripts/reef/tiff.ts), on TIFFs this test writes itself: tiled, Deflate, horizontal
// differencing, 16-bit, exactly the shape Element84's Sentinel-2 COGs have, and the shapes it must refuse.
// Seen red (L49): with the predictor's undo removed from `tile`, the window read back as the stored differences.
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readTiff, readWindow, TiffError } from "../../../scripts/reef/tiff.ts";

interface Spec {
  readonly width: number;
  readonly height: number;
  readonly tile: number;
  readonly pixel: (x: number, y: number) => number;
  readonly compression?: number;
  readonly predictor?: 1 | 2;
  readonly bits?: 8 | 16;
}

/** A classic little-endian tiled TIFF with a georeference (pixel 10 m, top-left corner at 199980, 800040). */
function writeTiff(s: Spec): Uint8Array {
  const bits = s.bits ?? 16;
  const predictor = s.predictor ?? 2;
  const across = Math.ceil(s.width / s.tile);
  const down = Math.ceil(s.height / s.tile);
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < down; ty++)
    for (let tx = 0; tx < across; tx++) {
      const raw = new Uint8Array(s.tile * s.tile * (bits / 8));
      const v = new DataView(raw.buffer);
      for (let y = 0; y < s.tile; y++) {
        let prev = 0;
        for (let x = 0; x < s.tile; x++) {
          const px = tx * s.tile + x;
          const py = ty * s.tile + y;
          const value = px < s.width && py < s.height ? s.pixel(px, py) : 0;
          const stored = predictor === 2 ? (value - prev) & (bits === 16 ? 0xffff : 0xff) : value;
          prev = value;
          if (bits === 16) v.setUint16((y * s.tile + x) * 2, stored, true);
          else raw[y * s.tile + x] = stored;
        }
      }
      tiles.push((s.compression ?? 8) === 1 ? raw : new Uint8Array(deflateSync(raw)));
    }
  // Layout: header (8) | IFD | out-of-line values | tiles.
  const entries: [number, number, number[]][] = [
    [256, 3, [s.width]],
    [257, 3, [s.height]],
    [258, 3, [bits]],
    [259, 3, [s.compression ?? 8]],
    [277, 3, [1]],
    [317, 3, [predictor]],
    [322, 3, [s.tile]],
    [323, 3, [s.tile]],
    [324, 4, tiles.map(() => 0)],
    [325, 4, tiles.map((t) => t.length)],
    [339, 3, [1]],
    [33550, 12, [10, 10, 0]],
    [33922, 12, [0, 0, 0, 199980, 800040, 0]],
  ];
  const size = (type: number): number => (type === 3 ? 2 : type === 4 ? 4 : 8);
  const ifdLen = 2 + entries.length * 12 + 4;
  let extra = 8 + ifdLen;
  const placed = entries.map(([tag, type, values]) => {
    const n = values.length * size(type);
    const at = n > 4 ? extra : -1;
    if (n > 4) extra += n;
    return { tag, type, values, at };
  });
  let tileAt = extra;
  const offsets = tiles.map((t) => {
    const o = tileAt;
    tileAt += t.length;
    return o;
  });
  (placed.find((p) => p.tag === 324) as { values: number[] }).values = offsets;
  const out = new Uint8Array(tileAt);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49], 0);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, entries.length, true);
  const write = (type: number, values: number[], at: number): void => {
    values.forEach((x, i) => {
      if (type === 3) v.setUint16(at + i * 2, x, true);
      else if (type === 4) v.setUint32(at + i * 4, x, true);
      else v.setFloat64(at + i * 8, x, true);
    });
  };
  placed.forEach((p, i) => {
    const e = 10 + i * 12;
    v.setUint16(e, p.tag, true);
    v.setUint16(e + 2, p.type, true);
    v.setUint32(e + 4, p.values.length, true);
    if (p.at < 0) write(p.type, p.values, e + 8);
    else {
      v.setUint32(e + 8, p.at, true);
      write(p.type, p.values, p.at);
    }
  });
  tiles.forEach((t, i) => out.set(t, offsets[i] as number));
  return out;
}

const pattern = (x: number, y: number): number => (x * 37 + y * 101 + ((x * y) % 13) * 500) % 65536;

describe("readTiff / readWindow", () => {
  it("reads a tiled Deflate + predictor-2 16-bit image across tile boundaries, with its georeference", () => {
    const bytes = writeTiff({ width: 50, height: 40, tile: 16, pixel: pattern });
    const im = readTiff(bytes);
    expect([im.width, im.height, im.tileWidth, im.bits, im.predictor]).toEqual([50, 40, 16, 16, 2]);
    expect([im.originX, im.originY, im.pixelX, im.pixelY]).toEqual([199980, 800040, 10, 10]);
    const w = readWindow(bytes, im, 10, 7, 30, 25);
    for (let y = 0; y < 25; y++) for (let x = 0; x < 30; x++) expect(w.values[y * 30 + x], `${x},${y}`).toBe(pattern(10 + x, 7 + y));
  });

  it("reads uncompressed 8-bit tiles with no predictor", () => {
    const bytes = writeTiff({ width: 20, height: 20, tile: 16, pixel: (x, y) => (x + y) % 256, compression: 1, predictor: 1, bits: 8 });
    const im = readTiff(bytes);
    const w = readWindow(bytes, im, 0, 0, 20, 20);
    expect(w.values[19 * 20 + 19]).toBe(38);
  });

  it("refuses what it does not read: LZW, BigTIFF, big-endian, and a window outside the image", () => {
    expect(() => readTiff(writeTiff({ width: 16, height: 16, tile: 16, pixel: pattern, compression: 5 }))).toThrow(TiffError);
    const big = writeTiff({ width: 16, height: 16, tile: 16, pixel: pattern });
    big[2] = 43;
    expect(() => readTiff(big)).toThrow(/BigTIFF/);
    const be = writeTiff({ width: 16, height: 16, tile: 16, pixel: pattern });
    be[0] = 0x4d;
    be[1] = 0x4d;
    expect(() => readTiff(be)).toThrow(TiffError);
    const ok = writeTiff({ width: 16, height: 16, tile: 16, pixel: pattern });
    expect(() => readWindow(ok, readTiff(ok), 10, 10, 10, 10)).toThrow(/not inside/);
  });
});
