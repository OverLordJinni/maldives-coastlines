// The traced reefs of the islands he can land on (R75 as draft 18.1 extends it; D375, D380, D387; PLAN v2.6 "The reefs
// of every island, traced"): their binary format and the pure decoder. The home island's reef is not here: it ships as
// src/assets/reef/reef.json, byte for byte as the owner's slot stands on it, and nothing in this file reads it.
//
// Pure (D43): it takes a `Uint8Array` and never fetches, so the same decoder runs in WKWebView, in vitest and in
// scripts/check-reefs.ts. Where the bytes come from (inlined into the bundle, read from disk) is the caller's business.
//
// **The format, version 1** (written by scripts/reef/encode-reefs.ts, the only writer):
//
//   "KFRF"                 4 bytes, the magic
//   format                 u8, = 1
//   reefsId                string        the build's id (scripts/reef/build-reefs.ts says what it names)
//   islands                varint n, then n × island, in ascending order of the id's number, each id once
//   (nothing after)
//
//   island                 id     varint, the chart's island id (src/rules/chartData.ts: osm id × 2 + kind)
//                          kind   u8: 0 = traced from imagery (R75), 1 = a drawn band where it could not be (D387)
//                          edge   ring: where the reef drops to open water (R71's boundary)
//                          crest  ring: the rim of the reef flat
//                          marsh  varint m, then m × ring: open marsh inside the island (the kulhi, D380); 0 for most
//   string                 varint byte length, then that many bytes of printable ASCII
//   ring                   varint point count (≥ 3), then per point the zigzag varint delta of lon and of lat in 1e-5
//                          degrees from the previous point (the first point from 0, 0). Open: the closing edge is implied.
//
// **The chart's own encoding** (D390, chartData.ts says why it is hand-rolled and why 1e-5 degrees), so a reef ring and a
// coastline ring are read by the same rule, and a reef is placed by the same projection as its island (each island's own
// transform, done by the reader: degrees carry no frame). Rejected: JSON as reef.json is (about 210 KB for every island,
// each parsed at start, PLAN v2.6); a file per island (134 imports); scene metres (each island's transform frozen into
// the data, so a change of scale or centroid would mean re-tracing).
//
// **Traced or drawn is in the data, not only in the record** (D387): an island whose reef could not be traced gets a
// drawn band and stays landable, and the game can say which it is drawing without reading reefs-manifest.json, which it
// never imports. A kind this build does not know is refused, never read as traced.

import { islandIdOf, QUANTUM, type IslandId, type LonLat } from "./chartData.ts";

export const REEFS_MAGIC = "KFRF";
export const REEFS_FORMAT = 1;

/** How an island's reef was made (D387). */
export type ReefKind = "traced" | "drawn";
const KINDS: readonly ReefKind[] = ["traced", "drawn"];

export interface IslandReef {
  readonly id: IslandId;
  readonly kind: ReefKind;
  /** Where the reef drops to open water, open (the closing edge implied), at least three points. */
  readonly edge: readonly LonLat[];
  /** The rim of the reef flat, open, at least three points. */
  readonly crest: readonly LonLat[];
  /** Open marsh inside the island (the kulhi, D380), each ring open; empty for an island with none. */
  readonly marsh: readonly (readonly LonLat[])[];
}

export interface ReefData {
  readonly id: string;
  readonly islands: ReadonlyMap<IslandId, IslandReef>;
}

export class ReefDataError extends Error {
  override name = "ReefDataError";
}

/**
 * An island's reef, or null when the data holds none for it. Null is a state of its own, not "no reef": under D375 an
 * island with no reef in the data is sighted and never landed, and the drawn band (D387) is a reef the data does hold
 * (`kind: "drawn"`), so the caller can never take the one for the other.
 */
export function reefFor(data: ReefData, id: IslandId): IslandReef | null {
  return data.islands.get(id) ?? null;
}

/**
 * A cursor that refuses to read past the end, so a truncated file is an error, never a short list of reefs. The same rules
 * as chartData.ts's reader, written again here because that one is private to the chart's file, which another slice owns
 * (L58): exporting it is a one-line change to chartData.ts for whoever next holds it, and this copy is then deleted (L6).
 */
class Cursor {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  u8(): number {
    const b = this.bytes[this.pos];
    if (b === undefined) throw new ReefDataError(`truncated at byte ${this.pos}`);
    this.pos++;
    return b;
  }

  varint(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.u8();
      result += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) {
        if (!Number.isSafeInteger(result)) throw new ReefDataError(`varint past 2^53 at byte ${this.pos}`);
        return result;
      }
      scale *= 128;
    }
    throw new ReefDataError(`varint longer than 8 bytes at byte ${this.pos}`);
  }

  zigzag(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  /** A count, refused when it could not possibly fit in what is left (each item is at least one byte). */
  count(what: string): number {
    const n = this.varint();
    if (n > this.bytes.length - this.pos) throw new ReefDataError(`${what}: a count of ${n} with ${this.bytes.length - this.pos} bytes left`);
    return n;
  }

  /** Printable ASCII only: the one string is the build's id, and a reader that took anything else would need UTF-8. */
  ascii(): string {
    const len = this.count("the reefs id");
    let s = "";
    for (let i = 0; i < len; i++) {
      const c = this.u8();
      if (c < 0x20 || c > 0x7e) throw new ReefDataError(`the reefs id holds byte ${c} at ${this.pos - 1}: not printable ASCII`);
      s += String.fromCharCode(c);
    }
    return s;
  }
}

function ring(c: Cursor, what: string): LonLat[] {
  const n = c.count(what);
  if (n < 3) throw new ReefDataError(`${what}: a ring of ${n} points`);
  const out: LonLat[] = [];
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < n; i++) {
    lon += c.zigzag();
    lat += c.zigzag();
    if (Math.abs(lon) > 180 * QUANTUM || Math.abs(lat) > 90 * QUANTUM) throw new ReefDataError(`${what}: point ${i} is off the Earth`);
    out.push([lon / QUANTUM, lat / QUANTUM]);
  }
  return out;
}

/**
 * Decodes the reefs' binary (see the header). Throws `ReefDataError` naming the fault for anything that is not exactly a
 * version-1 file: a wrong magic or version, an empty id, a truncated or over-long file, an island out of order or twice,
 * a kind this build does not know, or a ring of fewer than three points.
 */
export function decodeReefs(bytes: Uint8Array): ReefData {
  const c = new Cursor(bytes);
  const magic = String.fromCharCode(c.u8(), c.u8(), c.u8(), c.u8());
  if (magic !== REEFS_MAGIC) throw new ReefDataError(`not a reefs file: magic "${magic}"`);
  const format = c.u8();
  if (format !== REEFS_FORMAT) throw new ReefDataError(`reefs format ${format}; this build reads ${REEFS_FORMAT}`);
  const id = c.ascii();
  if (id === "") throw new ReefDataError("empty reefs id");
  const islands = new Map<IslandId, IslandReef>();
  const n = c.count("islands");
  let last = -1;
  for (let i = 0; i < n; i++) {
    const num = c.varint();
    const iid = islandIdOf(num);
    if (num <= last) throw new ReefDataError(islands.has(iid) ? `island ${iid} appears twice` : `island ${iid} is out of order`);
    last = num;
    const k = c.u8();
    const kind = KINDS[k];
    if (kind === undefined) throw new ReefDataError(`island ${iid}: reef kind ${k} is not one this build knows`);
    const edge = ring(c, `island ${iid} edge`);
    const crest = ring(c, `island ${iid} crest`);
    const marsh: LonLat[][] = [];
    const m = c.count(`island ${iid} marsh`);
    for (let j = 0; j < m; j++) marsh.push(ring(c, `island ${iid} marsh ${j}`));
    islands.set(iid, { id: iid, kind, edge, crest, marsh });
  }
  if (c.pos !== bytes.length) throw new ReefDataError(`${bytes.length - c.pos} bytes after the end of the reefs`);
  return { id, islands };
}
