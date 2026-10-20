// A tiled GeoTIFF writer for the reef tests: uncompressed, one sample of 8 or 16 bits, any pixel size and origin, in the
// layout scripts/reef/tiff.ts reads. Not a test itself (no `.test.ts`); tests/scripts/reef/tiff.test.ts keeps its own
// writer for the codec cases (Deflate, the predictor) this one never writes.

export interface TiffSpec {
  readonly width: number;
  readonly height: number;
  readonly tile: number;
  /** Metres per pixel, both axes. */
  readonly pixelM: number;
  /** Pixel (0, 0)'s top-left corner in the projected CRS. */
  readonly originX: number;
  readonly originY: number;
  readonly bits?: 8 | 16;
  readonly pixel: (x: number, y: number) => number;
}

export function writeTiff(s: TiffSpec): Uint8Array {
  const bits = s.bits ?? 8;
  const across = Math.ceil(s.width / s.tile);
  const down = Math.ceil(s.height / s.tile);
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < down; ty++)
    for (let tx = 0; tx < across; tx++) {
      const raw = new Uint8Array(s.tile * s.tile * (bits / 8));
      const v = new DataView(raw.buffer);
      for (let y = 0; y < s.tile; y++)
        for (let x = 0; x < s.tile; x++) {
          const px = tx * s.tile + x;
          const py = ty * s.tile + y;
          const value = px < s.width && py < s.height ? s.pixel(px, py) : 0;
          if (bits === 16) v.setUint16((y * s.tile + x) * 2, value, true);
          else raw[y * s.tile + x] = value;
        }
      tiles.push(raw);
    }
  const entries: [number, number, number[]][] = [
    [256, 3, [s.width]],
    [257, 3, [s.height]],
    [258, 3, [bits]],
    [259, 3, [1]],
    [277, 3, [1]],
    [317, 3, [1]],
    [322, 3, [s.tile]],
    [323, 3, [s.tile]],
    [324, 4, tiles.map(() => 0)],
    [325, 4, tiles.map((t) => t.length)],
    [339, 3, [1]],
    [33550, 12, [s.pixelM, s.pixelM, 0]],
    [33922, 12, [0, 0, 0, s.originX, s.originY, 0]],
  ];
  const size = (type: number): number => (type === 3 ? 2 : type === 4 ? 4 : 8);
  const ifdLen = 2 + entries.length * 12 + 4;
  let extra = 8 + ifdLen;
  const placed = entries.map(([tag, type, vals]) => {
    const len = size(type) * vals.length;
    const at = len > 4 ? extra : -1;
    if (len > 4) extra += len;
    return { tag, type, vals, at };
  });
  const tileStart = extra;
  const offsets: number[] = [];
  let o = tileStart;
  for (const t of tiles) {
    offsets.push(o);
    o += t.length;
  }
  const out = new Uint8Array(o);
  const view = new DataView(out.buffer);
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, placed.length, true);
  const put = (type: number, at: number, vals: readonly number[]): void => {
    vals.forEach((v, i) => {
      if (type === 3) view.setUint16(at + i * 2, v, true);
      else if (type === 4) view.setUint32(at + i * 4, v, true);
      else view.setFloat64(at + i * 8, v, true);
    });
  };
  placed.forEach((e, i) => {
    const p = 10 + i * 12;
    const vals = e.tag === 324 ? offsets : e.vals;
    view.setUint16(p, e.tag, true);
    view.setUint16(p + 2, e.type, true);
    view.setUint32(p + 4, vals.length, true);
    if (e.at < 0) put(e.type, p + 8, vals);
    else {
      view.setUint32(p + 8, e.at, true);
      put(e.type, e.at, vals);
    }
  });
  tiles.forEach((t, i) => out.set(t, offsets[i] as number));
  return out;
}
