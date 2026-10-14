// A reader for OpenStreetMap's PBF format, written by hand for CH0 (PLAN Phase E).
//
// Why by hand, and not a package from npm (`osm-pbf-parser`, `osmium`, `pbf` + a schema):
// - **AC36's allow-list.** Every dependency is a reviewed row in `scripts/check-deps.ts`, and a
//   dev-only one still enters `pnpm install` and the 24 h release-age guard. The format is small:
//   two message kinds around a zlib stream, and the four entity messages below. About two hundred
//   lines is cheaper than a dependency we would have to vet and pin.
// - **The pipeline must be rebuildable from the record** (R57, the public repository): the method
//   is easier to state, and to re-run in ten years, when every step is in this directory.
// - `osmium` (the C++ tool) would make the result depend on what is installed on one Mac.
//
// The format (https://wiki.openstreetmap.org/wiki/PBF_Format), only the parts this needs:
//   file      = repeated { int32 big-endian length; BlobHeader; Blob }
//   BlobHeader: 1 type (string, "OSMHeader" | "OSMData"), 3 datasize (int32)
//   Blob      : 1 raw (bytes), 2 raw_size (int32), 3 zlib_data (bytes); 4/6/7 are lzma/lz4/zstd
//   HeaderBlock:   4 required_features (repeated string)
//   PrimitiveBlock: 1 stringtable { 1 repeated bytes }, 2 primitivegroup (repeated),
//                   17 granularity (default 100), 19 lat_offset, 20 lon_offset (default 0)
//   PrimitiveGroup: 1 nodes, 2 dense, 3 ways, 4 relations, 5 changesets
//   Node      : 1 id (sint64), 2 keys, 3 vals (packed uint32), 8 lat, 9 lon (sint64)
//   DenseNodes: 1 id, 8 lat, 9 lon (packed sint64, delta-coded), 10 keys_vals (packed int32,
//               each node's pairs ended by a 0)
//   Way       : 1 id (int64), 2 keys, 3 vals, 8 refs (packed sint64, delta-coded)
//   Relation  : 1 id (int64), 2 keys, 3 vals, 8 roles_sid (packed int32), 9 memids (packed sint64,
//               delta-coded), 10 types (packed enum: 0 node, 1 way, 2 relation)
//
// **Anything this reader does not understand is refused, not skipped**: an lzma, lz4 or zstd blob,
// a required feature other than the two below, a truncated block. A skipped block would be islands
// silently missing from the chart, which no later check could tell from islands that do not exist.
//
// Numbers: OSM ids pass 2^32 (node ids are near 1.3e10 in 2026), so varints are decoded with
// arithmetic, not 32-bit bit operations, and stay exact below 2^53. Coordinates are returned as
// integer nanodegrees (`lat_offset + granularity * lat`), exactly as stored, so no rounding happens
// here; the pipeline quantises once, later (PLAN Data model).
import { inflateSync } from "node:zlib";

export type Tags = Readonly<Record<string, string>>;

export interface PbfNode {
  readonly id: number;
  /** Integer nanodegrees, as stored. */
  readonly latE9: number;
  readonly lonE9: number;
  readonly tags: Tags;
}

export interface PbfWay {
  readonly id: number;
  readonly refs: readonly number[];
  readonly tags: Tags;
}

export type MemberType = "node" | "way" | "relation";

export interface PbfMember {
  readonly type: MemberType;
  readonly ref: number;
  readonly role: string;
}

export interface PbfRelation {
  readonly id: number;
  readonly members: readonly PbfMember[];
  readonly tags: Tags;
}

export interface PbfVisitor {
  node?(n: PbfNode): void;
  way?(w: PbfWay): void;
  relation?(r: PbfRelation): void;
}

/** The required features this reader implements. Anything else in a header is refused. */
export const SUPPORTED_FEATURES: readonly string[] = ["OsmSchema-V0.6", "DenseNodes"];

export class PbfError extends Error {
  override name = "PbfError";
}

/** A cursor over one protobuf message. */
class Reader {
  pos: number;
  readonly end: number;
  readonly buf: Uint8Array;

  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  varint(): number {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new PbfError("truncated varint");
      const b = this.buf[this.pos++] as number;
      result += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) {
        // A plain int64 that is negative is encoded as ten bytes and lands here too: none of the
        // fields read as plain int64 (ids, offsets, sizes) is negative in a valid extract.
        if (result > Number.MAX_SAFE_INTEGER) throw new PbfError(`varint ${result} is past 2^53 (or a negative int64): a number this reader cannot hold exactly`);
        return result;
      }
      scale *= 128;
    }
    throw new PbfError("varint longer than 10 bytes");
  }

  /** A sint64: zigzag-decoded, in plain arithmetic (see the header on 2^32). */
  svarint(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  bytes(): Uint8Array {
    const len = this.varint();
    const start = this.pos;
    if (start + len > this.end) throw new PbfError(`length-delimited field of ${len} bytes runs past its message`);
    this.pos += len;
    return this.buf.subarray(start, start + len);
  }

  /** A nested reader over a length-delimited field, without copying. */
  sub(): Reader {
    const len = this.varint();
    if (this.pos + len > this.end) throw new PbfError(`nested message of ${len} bytes runs past its parent`);
    const r = new Reader(this.buf, this.pos, this.pos + len);
    this.pos += len;
    return r;
  }

  skip(wire: number): void {
    switch (wire) {
      case 0:
        this.varint();
        return;
      case 1:
        this.pos += 8;
        break;
      case 2: {
        // Not `this.pos += this.varint()`: that reads `pos` before `varint()` moves it past the
        // length prefix, and lands short by the prefix's own bytes.
        const len = this.varint();
        this.pos += len;
        break;
      }
      case 5:
        this.pos += 4;
        break;
      default:
        throw new PbfError(`wire type ${wire} is not one protobuf uses here`);
    }
    if (this.pos > this.end) throw new PbfError("field runs past its message");
  }

  /** A packed repeated varint field, decoded with `each`. Also accepts one unpacked element. */
  packed(wire: number, each: (r: Reader) => number): number[] {
    if (wire === 0) return [each(this)];
    const r = this.sub();
    const out: number[] = [];
    while (!r.done) out.push(each(r));
    return out;
  }
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function key(r: Reader): [field: number, wire: number] {
  const k = r.varint();
  return [Math.floor(k / 8), k % 8];
}

function tagsOf(keys: readonly number[], vals: readonly number[], strings: readonly string[]): Tags {
  if (keys.length !== vals.length) throw new PbfError(`${keys.length} keys and ${vals.length} values`);
  const out: Record<string, string> = {};
  keys.forEach((k, i) => {
    out[str(strings, k)] = str(strings, vals[i] as number);
  });
  return out;
}

function str(strings: readonly string[], i: number): string {
  const s = strings[i];
  if (s === undefined) throw new PbfError(`string index ${i} is past the block's table of ${strings.length}`);
  return s;
}

/** Decompresses one Blob. Only raw and zlib are implemented; see the header for why others refuse. */
function blobData(r: Reader): Uint8Array {
  let raw: Uint8Array | null = null;
  let zlib: Uint8Array | null = null;
  let rawSize: number | null = null;
  while (!r.done) {
    const [f, w] = key(r);
    if (f === 1) raw = r.bytes();
    else if (f === 2) rawSize = r.varint();
    else if (f === 3) zlib = r.bytes();
    else if (f === 4 || f === 6 || f === 7) throw new PbfError(`blob compressed with ${f === 4 ? "lzma" : f === 6 ? "lz4" : "zstd"}, which this reader does not implement`);
    else r.skip(w);
  }
  if (raw !== null) return raw;
  if (zlib === null) throw new PbfError("blob with no data");
  const out = new Uint8Array(inflateSync(zlib));
  if (rawSize !== null && out.length !== rawSize) throw new PbfError(`blob inflated to ${out.length} bytes, its header says ${rawSize}`);
  return out;
}

function header(data: Uint8Array): void {
  const r = new Reader(data);
  while (!r.done) {
    const [f, w] = key(r);
    if (f === 4) {
      const feature = utf8.decode(r.bytes());
      if (!SUPPORTED_FEATURES.includes(feature)) throw new PbfError(`the file requires "${feature}", which this reader does not implement`);
    } else r.skip(w);
  }
}

function primitiveBlock(data: Uint8Array, visit: PbfVisitor): void {
  // The string table and the scale come before or after the groups depending on the writer, so the
  // groups are collected first and decoded once the whole block has been read.
  const r = new Reader(data);
  let strings: string[] = [];
  const groups: Reader[] = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  while (!r.done) {
    const [f, w] = key(r);
    if (f === 1) {
      const t = r.sub();
      strings = [];
      while (!t.done) {
        const [tf, tw] = key(t);
        if (tf === 1) strings.push(utf8.decode(t.bytes()));
        else t.skip(tw);
      }
    } else if (f === 2) groups.push(r.sub());
    else if (f === 17) granularity = r.varint();
    // int64, not sint64. A negative offset is a 10-byte varint, which `varint` refuses as past 2^53:
    // no extract seen sets one, and a refusal is better than a chart shifted by 2^64 nanodegrees.
    else if (f === 19) latOffset = r.varint();
    else if (f === 20) lonOffset = r.varint();
    else r.skip(w);
  }
  const lat = (raw: number): number => latOffset + granularity * raw;
  const lon = (raw: number): number => lonOffset + granularity * raw;

  for (const g of groups) {
    while (!g.done) {
      const [f, w] = key(g);
      if (f === 1) {
        const n = plainNode(g.sub(), strings);
        visit.node?.({ id: n.id, latE9: lat(n.lat), lonE9: lon(n.lon), tags: n.tags });
      } else if (f === 2) dense(g.sub(), strings, (id, la, lo, tags) => visit.node?.({ id, latE9: lat(la), lonE9: lon(lo), tags }));
      else if (f === 3) {
        const way = wayOf(g.sub(), strings);
        visit.way?.(way);
      } else if (f === 4) {
        const rel = relationOf(g.sub(), strings);
        visit.relation?.(rel);
      } else g.skip(w);
    }
  }
}

function plainNode(r: Reader, strings: readonly string[]): { id: number; lat: number; lon: number; tags: Tags } {
  let id = 0;
  let la = 0;
  let lo = 0;
  let keys: number[] = [];
  let vals: number[] = [];
  while (!r.done) {
    const [f, w] = key(r);
    if (f === 1) id = r.svarint();
    else if (f === 2) keys = r.packed(w, (x) => x.varint());
    else if (f === 3) vals = r.packed(w, (x) => x.varint());
    else if (f === 8) la = r.svarint();
    else if (f === 9) lo = r.svarint();
    else r.skip(w);
  }
  return { id, lat: la, lon: lo, tags: tagsOf(keys, vals, strings) };
}

function dense(r: Reader, strings: readonly string[], each: (id: number, lat: number, lon: number, tags: Tags) => void): void {
  let ids: number[] = [];
  let lats: number[] = [];
  let lons: number[] = [];
  let kv: number[] = [];
  while (!r.done) {
    const [f, w] = key(r);
    if (f === 1) ids = r.packed(w, (x) => x.svarint());
    else if (f === 8) lats = r.packed(w, (x) => x.svarint());
    else if (f === 9) lons = r.packed(w, (x) => x.svarint());
    else if (f === 10) kv = r.packed(w, (x) => x.varint());
    else r.skip(w);
  }
  if (lats.length !== ids.length || lons.length !== ids.length) throw new PbfError(`dense nodes with ${ids.length} ids, ${lats.length} lats and ${lons.length} lons`);
  let id = 0;
  let la = 0;
  let lo = 0;
  let k = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i] as number;
    la += lats[i] as number;
    lo += lons[i] as number;
    const tags: Record<string, string> = {};
    // keys_vals is empty when no node in the block has a tag; otherwise every node has a 0-ended run.
    if (kv.length > 0) {
      while (true) {
        if (k >= kv.length) throw new PbfError("dense keys_vals ended inside a node");
        const kk = kv[k++] as number;
        if (kk === 0) break;
        const vv = kv[k++];
        if (vv === undefined) throw new PbfError("dense keys_vals has a key with no value");
        tags[str(strings, kk)] = str(strings, vv);
      }
    }
    each(id, la, lo, tags);
  }
}

function wayOf(r: Reader, strings: readonly string[]): PbfWay {
  let id = 0;
  let keys: number[] = [];
  let vals: number[] = [];
  let deltas: number[] = [];
  while (!r.done) {
    const [f, w] = key(r);
    if (f === 1) id = r.varint();
    else if (f === 2) keys = r.packed(w, (x) => x.varint());
    else if (f === 3) vals = r.packed(w, (x) => x.varint());
    else if (f === 8) deltas = r.packed(w, (x) => x.svarint());
    else r.skip(w);
  }
  let ref = 0;
  const refs = deltas.map((d) => (ref += d));
  return { id, refs, tags: tagsOf(keys, vals, strings) };
}

const MEMBER_TYPES: readonly MemberType[] = ["node", "way", "relation"];

function relationOf(r: Reader, strings: readonly string[]): PbfRelation {
  let id = 0;
  let keys: number[] = [];
  let vals: number[] = [];
  let roles: number[] = [];
  let memids: number[] = [];
  let types: number[] = [];
  while (!r.done) {
    const [f, w] = key(r);
    if (f === 1) id = r.varint();
    else if (f === 2) keys = r.packed(w, (x) => x.varint());
    else if (f === 3) vals = r.packed(w, (x) => x.varint());
    else if (f === 8) roles = r.packed(w, (x) => x.varint());
    else if (f === 9) memids = r.packed(w, (x) => x.svarint());
    else if (f === 10) types = r.packed(w, (x) => x.varint());
    else r.skip(w);
  }
  if (roles.length !== memids.length || types.length !== memids.length) throw new PbfError(`relation ${id}: ${memids.length} members, ${roles.length} roles, ${types.length} types`);
  let ref = 0;
  const members = memids.map((d, i) => {
    ref += d;
    const type = MEMBER_TYPES[types[i] as number];
    if (type === undefined) throw new PbfError(`relation ${id}: member type ${types[i]}`);
    return { type, ref, role: str(strings, roles[i] as number) };
  });
  return { id, members, tags: tagsOf(keys, vals, strings) };
}

/**
 * Reads a whole PBF file and calls the visitor for every node, way and relation, in file order.
 * Throws `PbfError` on anything it does not understand (see the header).
 */
export function readPbf(file: Uint8Array, visit: PbfVisitor): { blocks: number } {
  let pos = 0;
  let blocks = 0;
  let sawHeader = false;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  while (pos < file.length) {
    if (pos + 4 > file.length) throw new PbfError(`truncated: ${file.length - pos} bytes where a block length should be`);
    const headerLen = view.getInt32(pos, false);
    pos += 4;
    if (headerLen <= 0 || pos + headerLen > file.length) throw new PbfError(`truncated: a blob header of ${headerLen} bytes at ${pos}`);
    const h = new Reader(file, pos, pos + headerLen);
    pos += headerLen;
    let type = "";
    let size = -1;
    while (!h.done) {
      const [f, w] = key(h);
      if (f === 1) type = utf8.decode(h.bytes());
      else if (f === 3) size = h.varint();
      else h.skip(w);
    }
    if (size < 0 || pos + size > file.length) throw new PbfError(`truncated: a ${type || "?"} blob of ${size} bytes at ${pos}, file is ${file.length}`);
    const data = blobData(new Reader(file, pos, pos + size));
    pos += size;
    if (type === "OSMHeader") {
      header(data);
      sawHeader = true;
    } else if (type === "OSMData") {
      if (!sawHeader) throw new PbfError("an OSMData block before the OSMHeader");
      primitiveBlock(data, visit);
      blocks++;
    } else throw new PbfError(`unknown block type "${type}"`);
  }
  if (!sawHeader) throw new PbfError("no OSMHeader block: not an OSM PBF file");
  return { blocks };
}
