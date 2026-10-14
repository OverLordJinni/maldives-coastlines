// A minimal OSM PBF WRITER, for tests only: it builds the fixture files `pbf.test.ts` reads, so the
// reader is tested against bytes laid out as the format says, not against the one real extract
// (which is absent in CI and too large to reason about by hand).
//
// It is written from the format's .proto (https://wiki.openstreetmap.org/wiki/PBF_Format), not from
// the reader, so a misreading of the format in one is not silently mirrored in the other. The one
// shared assumption is the field numbers, which are the format.
import { deflateSync } from "node:zlib";

/** Protobuf encoding primitives over plain numbers (exact below 2^53, as OSM ids are). */
export class Proto {
  readonly out: number[] = [];

  varint(n: number): this {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`varint ${n}`);
    while (n >= 0x80) {
      this.out.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.out.push(n);
    return this;
  }

  key(field: number, wire: number): this {
    return this.varint(field * 8 + wire);
  }

  uint(field: number, n: number): this {
    return this.key(field, 0).varint(n);
  }

  sint(field: number, n: number): this {
    return this.key(field, 0).varint(zz(n));
  }

  bytes(field: number, b: Uint8Array | readonly number[]): this {
    this.key(field, 2).varint(b.length);
    for (const x of b) this.out.push(x);
    return this;
  }

  string(field: number, s: string): this {
    return this.bytes(field, new TextEncoder().encode(s));
  }

  message(field: number, m: Proto): this {
    return this.bytes(field, m.out);
  }

  packed(field: number, values: readonly number[], signed: boolean): this {
    const p = new Proto();
    for (const v of values) p.varint(signed ? zz(v) : v);
    return this.bytes(field, p.out);
  }

  done(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

const zz = (n: number): number => (n >= 0 ? n * 2 : -n * 2 - 1);
const deltas = (xs: readonly number[]): number[] => xs.map((x, i) => (i === 0 ? x : x - (xs[i - 1] as number)));

export interface NodeIn {
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
export interface WayIn {
  id: number;
  refs: number[];
  tags?: Record<string, string>;
}
export interface RelationIn {
  id: number;
  members: { type: "node" | "way" | "relation"; ref: number; role: string }[];
  tags?: Record<string, string>;
}

export interface BlockIn {
  dense?: NodeIn[];
  nodes?: NodeIn[];
  ways?: WayIn[];
  relations?: RelationIn[];
  granularity?: number;
}

/** One PrimitiveBlock. Coordinates are given in degrees and stored at the block's granularity. */
export function primitiveBlock(b: BlockIn): Uint8Array {
  const strings = [""];
  const sid = (s: string): number => {
    const i = strings.indexOf(s);
    if (i >= 0) return i;
    strings.push(s);
    return strings.length - 1;
  };
  const gran = b.granularity ?? 100;
  const raw = (deg: number): number => Math.round((deg * 1e9) / gran);
  const groups: Proto[] = [];

  if (b.dense) {
    const d = new Proto();
    const kv: number[] = [];
    const anyTags = b.dense.some((n) => n.tags && Object.keys(n.tags).length > 0);
    for (const n of b.dense) {
      if (!anyTags) continue;
      for (const [k, v] of Object.entries(n.tags ?? {})) kv.push(sid(k), sid(v));
      kv.push(0);
    }
    d.packed(1, deltas(b.dense.map((n) => n.id)), true);
    d.packed(8, deltas(b.dense.map((n) => raw(n.lat))), true);
    d.packed(9, deltas(b.dense.map((n) => raw(n.lon))), true);
    if (anyTags) d.packed(10, kv, false);
    groups.push(new Proto().message(2, d));
  }
  if (b.nodes) {
    const g = new Proto();
    for (const n of b.nodes) {
      const m = new Proto().sint(1, n.id);
      const t = Object.entries(n.tags ?? {});
      if (t.length) m.packed(2, t.map(([k]) => sid(k)), false).packed(3, t.map(([, v]) => sid(v)), false);
      m.sint(8, raw(n.lat)).sint(9, raw(n.lon));
      g.message(1, m);
    }
    groups.push(g);
  }
  if (b.ways) {
    const g = new Proto();
    for (const w of b.ways) {
      const m = new Proto().uint(1, w.id);
      const t = Object.entries(w.tags ?? {});
      if (t.length) m.packed(2, t.map(([k]) => sid(k)), false).packed(3, t.map(([, v]) => sid(v)), false);
      m.packed(8, deltas(w.refs), true);
      g.message(3, m);
    }
    groups.push(g);
  }
  if (b.relations) {
    const g = new Proto();
    for (const r of b.relations) {
      const m = new Proto().uint(1, r.id);
      const t = Object.entries(r.tags ?? {});
      if (t.length) m.packed(2, t.map(([k]) => sid(k)), false).packed(3, t.map(([, v]) => sid(v)), false);
      m.packed(8, r.members.map((x) => sid(x.role)), false);
      m.packed(9, deltas(r.members.map((x) => x.ref)), true);
      m.packed(10, r.members.map((x) => ["node", "way", "relation"].indexOf(x.type)), false);
      g.message(4, m);
    }
    groups.push(g);
  }

  // Groups before the string table, which the format allows and some writers do: the reader must
  // not assume the table comes first.
  const block = new Proto();
  for (const g of groups) block.message(2, g);
  const table = new Proto();
  for (const s of strings) table.string(1, s);
  block.message(1, table);
  if (gran !== 100) block.uint(17, gran);
  return block.done();
}

export function headerBlock(features: readonly string[] = ["OsmSchema-V0.6", "DenseNodes"]): Uint8Array {
  const h = new Proto();
  // A bbox first (field 1, nested sint64s): a length-delimited field the reader has to skip.
  h.message(1, new Proto().sint(1, -1).sint(2, 1).sint(3, 1).sint(4, -1));
  for (const f of features) h.string(4, f);
  h.string(16, "kaabafain test writer");
  return h.done();
}

export type Compression = "raw" | "zlib" | "lzma";

/** One file block: the 4-byte length, the BlobHeader and the Blob. */
export function fileBlock(type: "OSMHeader" | "OSMData", data: Uint8Array, compression: Compression = "zlib"): Uint8Array {
  const blob = new Proto();
  if (compression === "raw") blob.bytes(1, data);
  else if (compression === "zlib") blob.uint(2, data.length).bytes(3, new Uint8Array(deflateSync(data)));
  else blob.uint(2, data.length).bytes(4, [0x5d, 0, 0]);
  const blobBytes = blob.done();
  const header = new Proto().string(1, type).uint(3, blobBytes.length).done();
  const out = new Uint8Array(4 + header.length + blobBytes.length);
  new DataView(out.buffer).setInt32(0, header.length, false);
  out.set(header, 4);
  out.set(blobBytes, 4 + header.length);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
