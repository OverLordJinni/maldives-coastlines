// The chart's data (R56, PLAN Data model "ChartData"): its types, its binary format, the pure
// decoder, and the one projection every distance on the chart is measured in.
//
// Pure (D43): it takes a `Uint8Array` and never fetches. Where the bytes come from (bundled into
// the app as an asset, read from disk by `check:chart`) is the caller's business, which is what
// lets the same decoder run in WKWebView, in vitest and in the pipeline's own check.
//
// **The format, version 1** (written by `scripts/chart/encode.ts`, the only writer):
//
//   "KFCH"                 4 bytes, the magic
//   format                 u8, = 1
//   chartId                string        e.g. "osm-2026-10-14.f1.t5"
//   atolls                 varint n, then n × { id: string, name: string }
//   cloud                  varint n, then n × ring
//   islands                varint n, then n × { id: varint, atoll: varint index into atolls, ring }
//   aliases                varint n, then n × { from: varint id, to: varint id }
//   (nothing after)
//
//   string                 varint byte length, then UTF-8
//   island id              varint (osm id × 2 + kind), kind 0 = way "w…", 1 = relation "r…"
//   ring                   varint point count (≥ 3), then per point the zigzag varint delta of
//                          lon and of lat in 1e-5 degrees from the previous point (the first point
//                          from 0, 0). Open: the closing edge is implied.
//
// Why a hand-rolled binary and not JSON: measured 2026-10-14 (PLAN Phase E), the same 862 islands
// are 59 KB as delta varints and 447 KB as JSON, and D245's 1 MB budget is for the whole chart for
// the life of the format. Why not a general format (FlatBuffers, protobuf): a dependency in the
// shipped bundle, which is AC36's allow-list, for four arrays.
//
// Why 1e-5 degrees (about 1.1 m at the equator): below the 5 m simplification, so quantising adds
// no visible error, and it fits every Maldivian coordinate in four varint bytes and most deltas in
// one or two.
//
// **No island names in the file** (D221, R58, AC138): v1 never shows one, so the app does not carry
// them. The pipeline records them in `chart-manifest.json`, which the app never imports, only so
// AC138's test can search for them. Atolls carry their present-day names (D235), which landing shows.

/** A position as [longitude, latitude] in degrees. */
export type LonLat = readonly [lon: number, lat: number];
/** A position in metres on a local flat plane: x east, y north. */
export type Metres = readonly [x: number, y: number];

/**
 * An island's identity (PLAN Data model): the OSM element tagged place=island/islet if there is one,
 * else the lowest coastline way id in its ring. Stable across re-simplification by construction
 * (R64), unlike an index into the file or a hash of the geometry.
 */
export type IslandId = `w${number}` | `r${number}`;
export type AtollId = string;
export type ChartId = string;

export interface Atoll {
  readonly id: AtollId;
  /** Today's administrative name (D235), e.g. "Haa Dhaalu". */
  readonly name: string;
}

export interface ChartIsland {
  readonly id: IslandId;
  readonly atoll: AtollId;
  /** The coastline, open (the closing edge is implied), at least three points. */
  readonly ring: readonly Point[];
}

/**
 * A point in the chart's frame: [lon, lat] in degrees for real data, or metres [x, y] for the
 * SPEC fixture's invented islands (drawn "on a flat plane in kilometres", SPEC Test fixture). The
 * frame is part of the chart, so a rule can never measure one in the other's units.
 */
export type Point = LonLat | Metres;

export type ChartFrame = "lonlat" | "plane";

export interface ChartData {
  readonly id: ChartId;
  readonly frame: ChartFrame;
  readonly atolls: readonly Atoll[];
  /** Where cloud lies before anything is discovered: the natural atolls' areas (D246), simplified to 200 m. */
  readonly cloud: readonly (readonly Point[])[];
  readonly islands: readonly ChartIsland[];
  /** Old id → new id, when an OSM edit merged or split a coastline between extracts (R64). */
  readonly aliases: ReadonlyMap<IslandId, IslandId>;
}

export const CHART_MAGIC = "KFCH";
export const CHART_FORMAT = 1;
/** 1e-5 degrees per unit (see the header). */
export const QUANTUM = 1e5;

export class ChartDataError extends Error {
  override name = "ChartDataError";
}

/** The mean Earth radius (IUGG), metres. The sphere is the projection's; see `toLocalMetres`. */
export const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

/**
 * Projects [lon, lat] degrees onto a flat plane in metres, by the equirectangular projection with
 * its standard parallel at `lat0` (x = Δlon · cos lat0, y = lat, both in metres along the sphere).
 *
 * Why this and not great-circle (haversine) distance between every pair of points: the sighting rule
 * needs the nearest point of one coastline to another, which is a point-to-SEGMENT distance, and that
 * is plain geometry on a plane and awkward on a sphere. Over 20 km at Maldivian latitudes the plane
 * errs by under 0.1 % (cos varies by under 0.0003 across 20 km of latitude there), about 16 m at the
 * 16 km sighting distance, which is three times finer than the 5 m-simplified coastline's own
 * resolution of interest and has no effect on which islands are sighted except one that sits within
 * 16 m of the line, which the tuning band (15–20 km, AC135) does not care about.
 */
export function toLocalMetres(points: readonly LonLat[], lat0: number): Metres[] {
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  return points.map(([lon, lat]) => [lon * kx, lat * M_PER_DEG] as const);
}

function meanLatOf(points: readonly Point[]): number {
  let s = 0;
  for (const p of points) s += p[1];
  return s / points.length;
}

function pointSegment(p: Metres, a: Metres, b: Metres): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function oneWay(from: readonly Metres[], to: readonly Metres[]): number {
  let best = Infinity;
  for (const p of from) {
    for (let i = 0, j = to.length - 1; i < to.length; j = i++) {
      const d = pointSegment(p, to[j] as Metres, to[i] as Metres);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * The distance in metres between the nearest points of two closed coastlines (R59: "never between
 * centres"). For two outlines that do not cross, the nearest pair always has a vertex at one end, so
 * the minimum of vertex-to-edge distances taken both ways is exact; islands do not cross.
 *
 * For real data the two rings are projected together at the pair's mean latitude (see
 * `toLocalMetres`), so both are measured on one plane.
 */
export function coastDistanceM(frame: ChartFrame, a: readonly Point[], b: readonly Point[]): number {
  let ma: readonly Metres[];
  let mb: readonly Metres[];
  if (frame === "plane") {
    ma = a;
    mb = b;
  } else {
    const lat0 = (meanLatOf(a) + meanLatOf(b)) / 2;
    ma = toLocalMetres(a, lat0);
    mb = toLocalMetres(b, lat0);
  }
  return Math.min(oneWay(ma, mb), oneWay(mb, ma));
}

/** "w123" | "r456" from the file's varint (see the header). */
export function islandIdOf(n: number): IslandId {
  const kind = n % 2;
  const osm = (n - kind) / 2;
  return kind === 0 ? `w${osm}` : `r${osm}`;
}

export function islandIdNumber(id: IslandId): number {
  const osm = Number(id.slice(1));
  return osm * 2 + (id[0] === "r" ? 1 : 0);
}

const ISLAND_ID = /^[wr][1-9][0-9]*$/;
export function isIslandId(s: string): s is IslandId {
  return ISLAND_ID.test(s) && Number.isSafeInteger(Number(s.slice(1)) * 2 + 1);
}

/**
 * Strict UTF-8 to a string. Hand-written because `TextDecoder` is a host API, not ES: pure code has
 * no DOM library (tsconfig.pure.json), and the names it decodes are a few atoll names. Refuses
 * overlong forms, surrogates and truncated sequences, as `TextDecoder`'s `fatal` mode does.
 */
function utf8(b: Uint8Array, at: number): string {
  let out = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i] as number;
    let n: number;
    let cp: number;
    let min: number;
    if (c < 0x80) [n, cp, min] = [0, c, 0];
    else if (c >= 0xc2 && c < 0xe0) [n, cp, min] = [1, c & 0x1f, 0x80];
    else if (c >= 0xe0 && c < 0xf0) [n, cp, min] = [2, c & 0x0f, 0x800];
    else if (c >= 0xf0 && c < 0xf5) [n, cp, min] = [3, c & 0x07, 0x10000];
    else throw new ChartDataError(`invalid UTF-8 at byte ${at + i}`);
    for (let k = 1; k <= n; k++) {
      const d = b[i + k];
      if (d === undefined || (d & 0xc0) !== 0x80) throw new ChartDataError(`invalid UTF-8 at byte ${at + i}`);
      cp = cp * 64 + (d & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new ChartDataError(`invalid UTF-8 at byte ${at + i}`);
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}

/** A cursor that refuses to read past the end, so a truncated file is an error, never a short chart. */
class Cursor {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  u8(): number {
    const b = this.bytes[this.pos];
    if (b === undefined) throw new ChartDataError(`truncated at byte ${this.pos}`);
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
        if (!Number.isSafeInteger(result)) throw new ChartDataError(`varint past 2^53 at byte ${this.pos}`);
        return result;
      }
      scale *= 128;
    }
    throw new ChartDataError(`varint longer than 8 bytes at byte ${this.pos}`);
  }

  zigzag(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  string(): string {
    const len = this.varint();
    if (this.pos + len > this.bytes.length) throw new ChartDataError(`truncated: a string of ${len} bytes at byte ${this.pos}`);
    const s = utf8(this.bytes.subarray(this.pos, this.pos + len), this.pos);
    this.pos += len;
    return s;
  }

  /** A count, refused when it could not possibly fit in what is left (each item is at least one byte). */
  count(what: string): number {
    const n = this.varint();
    if (n > this.bytes.length - this.pos) throw new ChartDataError(`${what}: a count of ${n} with ${this.bytes.length - this.pos} bytes left`);
    return n;
  }
}

function ring(c: Cursor, what: string): LonLat[] {
  const n = c.count(what);
  if (n < 3) throw new ChartDataError(`${what}: a ring of ${n} points`);
  const out: LonLat[] = [];
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < n; i++) {
    lon += c.zigzag();
    lat += c.zigzag();
    if (Math.abs(lon) > 180 * QUANTUM || Math.abs(lat) > 90 * QUANTUM) throw new ChartDataError(`${what}: point ${i} is off the Earth`);
    out.push([lon / QUANTUM, lat / QUANTUM]);
  }
  return out;
}

/**
 * Decodes the chart's binary (see the header). Throws `ChartDataError` naming the fault for anything
 * that is not exactly a version-1 chart: a wrong magic or version, a truncated or over-long file, an
 * island in an atoll that is not listed, a duplicate island, or an alias to an island that is absent.
 */
export function decodeChart(bytes: Uint8Array): ChartData {
  const c = new Cursor(bytes);
  const magic = String.fromCharCode(c.u8(), c.u8(), c.u8(), c.u8());
  if (magic !== CHART_MAGIC) throw new ChartDataError(`not a chart: magic "${magic}"`);
  const format = c.u8();
  if (format !== CHART_FORMAT) throw new ChartDataError(`chart format ${format}; this build reads ${CHART_FORMAT}`);
  const id = c.string();
  if (id === "") throw new ChartDataError("empty chart id");

  const atolls: Atoll[] = [];
  const nAtolls = c.count("atolls");
  for (let i = 0; i < nAtolls; i++) atolls.push({ id: c.string(), name: c.string() });
  if (new Set(atolls.map((a) => a.id)).size !== atolls.length) throw new ChartDataError("two atolls share an id");

  const cloud: LonLat[][] = [];
  const nCloud = c.count("cloud");
  for (let i = 0; i < nCloud; i++) cloud.push(ring(c, `cloud ${i}`));

  const islands: ChartIsland[] = [];
  const seen = new Set<IslandId>();
  const nIslands = c.count("islands");
  for (let i = 0; i < nIslands; i++) {
    const iid = islandIdOf(c.varint());
    if (seen.has(iid)) throw new ChartDataError(`island ${iid} appears twice`);
    seen.add(iid);
    const a = atolls[c.varint()];
    if (a === undefined) throw new ChartDataError(`island ${iid} is in an atoll that is not listed`);
    islands.push({ id: iid, atoll: a.id, ring: ring(c, `island ${iid}`) });
  }

  const aliases = new Map<IslandId, IslandId>();
  const nAliases = c.count("aliases");
  for (let i = 0; i < nAliases; i++) {
    const from = islandIdOf(c.varint());
    const to = islandIdOf(c.varint());
    if (!seen.has(to)) throw new ChartDataError(`alias ${from} → ${to}, which is not in the chart`);
    if (seen.has(from)) throw new ChartDataError(`alias ${from} is itself an island in the chart`);
    aliases.set(from, to);
  }
  if (c.pos !== bytes.length) throw new ChartDataError(`${bytes.length - c.pos} bytes after the end of the chart`);
  return { id, frame: "lonlat", atolls, cloud, islands, aliases };
}
