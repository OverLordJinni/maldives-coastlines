// A PNG writer for the reefs' review figure (D389; scripts/reef/review-sheet.ts), by hand for the reason tiff.ts gives:
// every dependency is a reviewed row (AC36), and the figure must be re-makeable from the record. Truecolour, 8 bits a
// channel, no filter (filter type 0 on every row), one zlib stream: the simplest file every viewer reads. Rejected: a
// filter per row chosen by heuristic (smaller files, and nothing here is kept for its size).
//
// The figure holds imagery, so it is written only outside the repository (review-sheet.ts refuses a path inside it); this
// file holds no pixel, only the encoder. Pure: pixels in, bytes out.
import { deflateSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 as PNG uses it (ISO 3309, the same as zlib's). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A truecolour PNG from `rgb`, row by row from the top-left, three bytes a pixel. */
export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) throw new RangeError(`a ${width} × ${height} image`);
  if (rgb.length !== width * height * 3) throw new RangeError(`${rgb.length} bytes for a ${width} × ${height} truecolour image (${width * height * 3} expected)`);
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
