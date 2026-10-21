// The traced reef (R75; D269, D283): builds the reef the game draws round the home island, and records how.
//
//   pnpm reef <osm extract dir> <sentinel-2 dir>
//   e.g. pnpm reef ../assets-raw/osm-2026-10-14 ../assets-raw/sentinel2-2026-04-20     (from game/)
//
// **Where each part comes from** (D269: "traced from real open data"; D283: "OSM relation 7124282 exists for Maavaidhoo,
// Sentinel-2 refines its shape"):
//   - **OpenStreetMap** relation 7124282 (`natural=reef`, `reef=coral`, a multipolygon): its outer way 484029944 is the
//     reef's edge as mapped, and its inner way 19879672 is the island's coastline, the same way the island was made from
//     (D182). It gives the reef's AREA, which the game must match within 10 % (AC162, Q71), and the placement check. Its
//     outer way has 14 points: a coarse polygon round the reef, which cuts across the real edge in places by 50 m and more.
//   - **Sentinel-2** L2A (Copernicus; one cloud-free scene, PROVENANCE.md beside it) gives the SHAPE: the edge and the
//     crest traced from its green and near-infrared bands (trace.ts says how, and why that method). **Only derived
//     outlines leave this script**: no pixel, tile or image is written to the repository or the app (D269).
// So the shipped edge is the imagery's, and OSM is what it is held to: its area (AC162), and where the two disagree by
// more than two pixels (20 m at true scale), which is listed in the manifest for the owner's review (AC163).
//
// **Rejected: shipping OSM's outer way as it is.** It is the source R75 names, but at 14 points it draws the reef as a
// polygon whose straight sides run up to 70 m (12 scene metres) outside or inside the reef the imagery shows; D283 took
// Sentinel-2 as the refinement for exactly that. **Rejected: shipping the imagery's edge without OSM.** Then nothing would
// tie the drawn reef to the source R75 names, and AC162's area check would have nothing to check against.
//
// Writes `src/assets/reef/reef.json` (what the game imports: the edge and the crest in scene metres) and
// `src/assets/reef/reef-manifest.json` (the record R75 and AC165 ask for). Deterministic: no clock, no locale, no Map
// order; the same inputs give the same bytes (tests/scripts/reef/buildReef.test.ts rebuilds and compares wherever the
// inputs are present).
//
// Exit codes (testing-policy "A check that could not run"):
//   0  built
//   1  ran and refused: the relation's members changed, the scene is not the one recorded, no closed edge round the
//      island, or the traced reef's area is more than 10 % from OSM's (AC162 would fail: nothing is written)
//   2  could not run: a directory or file missing, or a SHA256SUMS that disagrees. Nothing was written.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { readPbf } from "../chart/pbf.ts";
import { areaM2 } from "../chart/geometry.ts";
import { ISLAND_SOURCE } from "../../src/rules/islandSource.ts";
import { readTiff, readWindow, type TiffImage } from "./tiff.ts";
import { fromUtm, toUtm } from "./utm.ts";
import { blur, contours, frameValues, inside, loopAround, otsu, ringArea, robust, simplify, type Px } from "./trace.ts";
import { toScene, METRES_PER_DEG_LAT, METRES_PER_DEG_LON_AT_EQUATOR, type Scene } from "./transform.ts";

export const RELATION = 7124282;
export const OUTER_WAY = 484029944;
export const INNER_WAY = 19879672;
export const EXTRACT_FILE = "maldives-latest.osm.pbf";
/** The bands read (B03 green, B08 near-infrared, both 10 m), and the scene's record. */
export const BANDS = ["B03.tif", "B08.tif"] as const;
export const ITEM = "item.json";
/** The window round the island, pixels (1.6 km at 10 m): the island and its reef, with open sea all round. */
export const WINDOW_PX = 160;
/** The open-sea frame the edge's threshold is measured on, pixels. */
export const FRAME_PX = 8;
/** The green band's smoothing before the contours, pixels (trace.ts `blur` says why one). */
export const BLUR_SIGMA_PX = 1;
/** The edge's threshold: the open sea's median plus this many robust standard deviations (trace.ts). */
export const EDGE_SIGMAS = 6;
/**
 * The most the open-sea frame may spread (robust sigma, B03 reflectance) and still be open sea (RF2). The method stands on
 * the frame being open water (trace.ts): one water, a spread of waves and glint. Measured 2026-10-21 on RF2's first scenes:
 * every frame over open water spread 0.0009–0.0059 (the home 0.0018, RF1's three 0.0018–0.0021), and every frame that
 * spread more, 0.011–0.058, lay partly on a flat, which put the edge's threshold at 0.11–0.45 in B03, above the reef itself,
 * so the "reef" traced was a ring of sand. 0.01 sits in that gap. Over it the window is taken as too small (`NotClosed`)
 * and widened until its frame reaches open water. Rejected: a cap on the frame's median (the brightest good frame, 0.034,
 * and the darkest bad one, 0.033, overlap: a bright frame can be clear deep water on a hazy day; a mixed one cannot be
 * one water); a cap on the threshold (that would be the reef's own brightness deciding where its edge is).
 */
export const FRAME_SIGMA_MAX = 0.01;
/** Douglas–Peucker tolerance at true scale, metres: half a pixel. */
export const TOLERANCE_TRUE_M = 5;
/** AC162's tolerance (Q71): the traced reef's area within 10 % of OSM's. */
export const AREA_TOLERANCE = 0.1;
/** AC163's: two 10 m pixels at true scale. */
export const DISAGREE_TRUE_M = 20;
/** Bearings the edge is compared on (every 5°). */
export const BEARINGS = 72;
/** The reef's id: the extract, the relation, the scene and this method's version. Bump the version with the method. */
export const METHOD_VERSION = 1;

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, "../..");
export const OUT_DIR = join(REPO, "src/assets/reef");
export const DATA = "reef.json";
export const MANIFEST = "reef-manifest.json";

export class CouldNotRun extends Error {
  override name = "CouldNotRun";
}
export class Refused extends Error {
  override name = "Refused";
}
/**
 * A refusal about the scene, not the reef: the window holds pixels with no data. RF's many-island build passes such a
 * scene over for the next clearest (build-reefs.ts); for the home island it is a refusal like any other.
 */
export class NoData extends Refused {
  override name = "NoData";
}
/**
 * A refusal about the window, not the scene or the reef: the edge or the crest found no closed loop round the island in it,
 * because the reef runs on to the window's border. RF2's build (build-reefs.ts) widens the window and traces again; for the
 * home island, whose 160 px window closes, it is a refusal like any other.
 */
export class NotClosed extends Refused {
  override name = "NotClosed";
}

/** A directory's `SHA256SUMS`, checked against the files it names; the files this build needs must be among them. */
export function checkedFiles(dir: string, need: readonly string[]): Map<string, { bytes: Uint8Array; sha256: string }> {
  const sums = join(dir, "SHA256SUMS");
  if (!existsSync(dir)) throw new CouldNotRun(`${dir}: no such directory`);
  if (!existsSync(sums)) throw new CouldNotRun(`${sums}: missing (the record of which bytes the reef was built from)`);
  const listed = new Map<string, string>();
  for (const line of readFileSync(sums, "utf8").split("\n")) {
    const m = /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(line.trim());
    if (m) listed.set(m[2] as string, m[1] as string);
  }
  const out = new Map<string, { bytes: Uint8Array; sha256: string }>();
  for (const name of need) {
    const want = listed.get(name);
    if (want === undefined) throw new CouldNotRun(`${sums} does not name ${name}`);
    const file = join(dir, name);
    if (!existsSync(file)) throw new CouldNotRun(`${file}: missing`);
    const bytes = new Uint8Array(readFileSync(file));
    const got = createHash("sha256").update(bytes).digest("hex");
    if (got !== want) throw new CouldNotRun(`${file}: sha256 ${got} is not the ${want} SHA256SUMS records`);
    out.set(name, { bytes, sha256: got });
  }
  return out;
}

type LonLat = readonly [lon: number, lat: number];

/** The relation's two rings from the extract, refusing if its members are not the recorded outer and inner ways. */
export function osmReef(pbf: Uint8Array): { outer: LonLat[]; inner: LonLat[]; tags: Readonly<Record<string, string>> } {
  let rel: { members: readonly { type: string; ref: number; role: string }[]; tags: Readonly<Record<string, string>> } | null = null;
  const ways = new Map<number, readonly number[]>();
  readPbf(pbf, {
    relation(r) {
      if (r.id === RELATION) rel = r;
    },
    way(w) {
      if (w.id === OUTER_WAY || w.id === INNER_WAY) ways.set(w.id, w.refs);
    },
  });
  const r = rel as { members: readonly { type: string; ref: number; role: string }[]; tags: Readonly<Record<string, string>> } | null;
  if (r === null) throw new Refused(`relation ${RELATION} is not in the extract`);
  const members = r.members.map((m) => `${m.type}:${m.ref}:${m.role}`).sort();
  const expected = [`way:${INNER_WAY}:inner`, `way:${OUTER_WAY}:outer`];
  if (members.join(",") !== expected.join(",")) throw new Refused(`relation ${RELATION}'s members are ${members.join(", ")}, not ${expected.join(", ")}: re-read the source before rebuilding`);
  if (r.tags.natural !== "reef") throw new Refused(`relation ${RELATION} is not tagged natural=reef`);
  const need = new Set<number>([...(ways.get(OUTER_WAY) ?? []), ...(ways.get(INNER_WAY) ?? [])]);
  const nodes = new Map<number, LonLat>();
  readPbf(pbf, {
    node(n) {
      if (need.has(n.id)) nodes.set(n.id, [n.lonE9 / 1e9, n.latE9 / 1e9]);
    },
  });
  const ring = (id: number): LonLat[] => {
    const refs = ways.get(id);
    if (refs === undefined) throw new Refused(`way ${id} is not in the extract`);
    if (refs[0] !== refs[refs.length - 1]) throw new Refused(`way ${id} is not closed`);
    return refs.slice(0, -1).map((ref) => {
      const p = nodes.get(ref);
      if (p === undefined) throw new Refused(`node ${ref} of way ${id} is not in the extract`);
      return p;
    });
  };
  return { outer: ring(OUTER_WAY), inner: ring(INNER_WAY), tags: r.tags };
}

const itemSchema = z.object({
  id: z.string(),
  properties: z.object({ datetime: z.string(), "proj:epsg": z.int(), "eo:cloud_cover": z.number(), "s2:product_uri": z.string(), "earthsearch:boa_offset_applied": z.boolean() }),
  assets: z.object({ green: z.object({ href: z.string(), "proj:transform": z.array(z.number()).min(6) }), nir: z.object({ href: z.string() }) }),
});

/** Reflectance from a digital number. Element84 has removed L2A's +1000 offset (`boa_offset_applied`), so it is DN / 10,000. */
const reflectance = (dn: number): number => dn / 10_000;

export interface Traced {
  /** The loops at true scale, as UTM metres (closed, no repeated point). */
  readonly edgeUtm: readonly Scene[];
  readonly crestUtm: readonly Scene[];
  readonly zone: number;
  readonly edgeThreshold: number;
  readonly crestThreshold: number;
  readonly sea: { readonly median: number; readonly sigma: number };
  readonly window: { readonly x0: number; readonly y0: number; readonly size: number };
}

/**
 * Which pixel centres of a `width × height` grid lie inside `ring`, by trace.ts `inside`'s own even–odd rule, a row at a
 * time (RF2). The same test per edge and the same arithmetic in the same order, so every pixel's answer is `inside`'s bit
 * for bit (tests/scripts/reef/traceScene.test.ts compares them, and the home's byte-for-byte rebuild holds it); only the
 * work changes: `inside` per pixel costs every edge point for every pixel, which on RF2's widest windows (up to 2,000 px,
 * an edge of thousands of points) is billions of tests. Here each row's crossings are found once.
 */
export function insideMask(ring: readonly Px[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const xs: number[] = [];
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as Px;
      const [xj, yj] = ring[j] as Px;
      if (yi > py !== yj > py) xs.push(((xj - xi) * (py - yi)) / (yj - yi) + xi);
    }
    if (xs.length === 0) continue;
    xs.sort((a, b) => a - b);
    // A pixel is inside when an odd number of crossings lie strictly to its right (`x < crossing`, as `inside` tests).
    let k = 0;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      while (k < xs.length && (xs[k] as number) <= px) k++;
      if ((xs.length - k) % 2 === 1) out[y * width + x] = 1;
    }
  }
  return out;
}

/**
 * Traces the edge and the crest from the two bands (trace.ts's method). Refuses if either is not a loop round the island.
 *
 * **One function for every island** (RF, D375): the home island by default (its coastline's centroid, the 160 px window
 * it was traced in), and each other island with its own centroid and a window sized to it (build-reefs.ts). Generalised
 * here rather than copied into the many-island build, so the method has one body and the home reef's byte-for-byte
 * rebuild (tests/scripts/reef/buildReef.test.ts) is the regression test of the generalised code itself, as PLAN v2.6
 * asks. Rejected: a second trace function in build-reefs.ts with the home's test pointed at it; two bodies of one method
 * is how a fix lands in the copy nobody runs (L6).
 *
 * `others` is what else the edge's contour run found: the loops at the edge's threshold that do not enclose the island
 * (another reef, a boat, a cloud the scene classification missed), in UTM metres, for the review's "bright near the edge"
 * flag. Reading it changes nothing traced.
 */
export function traceScene(green: Uint8Array, nir: Uint8Array, epsg: number, centreLonLat: LonLat = [ISLAND_SOURCE.lon0, ISLAND_SOURCE.lat0], windowPx: number = WINDOW_PX): Traced & { readonly others: readonly (readonly Scene[])[] } {
  if (!(epsg >= 32601 && epsg <= 32660)) throw new Refused(`EPSG ${epsg} is not a northern UTM zone`);
  if (!(Number.isInteger(windowPx) && windowPx > 2 * FRAME_PX && windowPx % 2 === 0)) throw new Refused(`a window of ${windowPx} px is not an even number of pixels wider than its frame`);
  const zone = epsg - 32600;
  const gi = readTiff(green);
  const ni = readTiff(nir);
  const same = (a: TiffImage, b: TiffImage): boolean => a.originX === b.originX && a.originY === b.originY && a.pixelX === b.pixelX && a.width === b.width;
  if (!same(gi, ni) || gi.pixelX !== 10) throw new Refused("the green and near-infrared bands are not on one 10 m grid");
  const c = toUtm(centreLonLat[0], centreLonLat[1], zone);
  const x0 = Math.floor((c.x - gi.originX) / gi.pixelX) - windowPx / 2;
  const y0 = Math.floor((gi.originY - c.y) / gi.pixelY) - windowPx / 2;
  // A window that runs off the image is a scene that cannot show the island, as a window holding no-data is (RF2: an
  // island near a tile's edge whose reef needs a wider window than the tile has room for; the neighbouring tile's scene
  // holds it whole). Refused as NoData so the many-island build passes the scene over; before this, readWindow threw a
  // TiffError here, which no window that ever traced reached.
  if (x0 < 0 || y0 < 0 || x0 + windowPx > gi.width || y0 + windowPx > gi.height) throw new NoData(`the window runs off the scene's ${gi.width}×${gi.height} image: the island is at the tile's edge`);
  const g = readWindow(green, gi, x0, y0, windowPx, windowPx).values;
  const n = readWindow(nir, ni, x0, y0, windowPx, windowPx).values;
  for (const v of g) if (v === 0) throw new NoData("the window holds no-data pixels: the island is at the scene's edge");
  const sea = robust(frameValues(Array.from(g, reflectance), windowPx, windowPx, FRAME_PX));
  // A frame with no spread at all gives no threshold: six sigmas of nothing is the median itself, and every pixel a grain
  // brighter is "reef". It is water the atmospheric correction has clipped to one value (RF2, 2025-12-26 over Vaikaradhoo:
  // median 0.0001), a scene that cannot show the reef, so it is passed over as no-data is.
  if (sea.sigma === 0) throw new NoData(`the open sea's frame has no spread (every pixel ${sea.median.toFixed(4)} in B03): no threshold can be set by it`);
  if (sea.sigma > FRAME_SIGMA_MAX) throw new NotClosed(`the window's frame is not open sea: it spreads ${sea.sigma.toFixed(4)} in B03, over ${FRAME_SIGMA_MAX}`);
  const edgeThreshold = sea.median + EDGE_SIGMAS * sea.sigma;
  // The green band smoothed (trace.ts `blur`), then land (NIR above green) held above every threshold, so the island is
  // always inside the loops. Land is set after the blur: blurred, the beach's brightness would push the crest outwards.
  const field = blur(Array.from(g, reflectance), windowPx, windowPx, BLUR_SIGMA_PX);
  for (let k = 0; k < field.length; k++) if ((n[k] as number) > (g[k] as number)) field[k] = 1;
  const centre: Px = [(c.x - gi.originX) / gi.pixelX - x0, (gi.originY - c.y) / gi.pixelY - y0];
  const edgeLoops = contours(field, windowPx, windowPx, edgeThreshold);
  const edge = loopAround(edgeLoops, centre);
  if (edge === null) throw new NotClosed("no closed edge round the island at the open-sea threshold");
  const water: number[] = [];
  const inEdge = insideMask(edge, windowPx, windowPx);
  for (let y = 0; y < windowPx; y++)
    for (let x = 0; x < windowPx; x++) {
      const k = y * windowPx + x;
      if ((n[k] as number) <= (g[k] as number) && inEdge[k] === 1) water.push(Math.log(field[k] as number));
    }
  // No water inside the edge: the edge hugs the land, because the window's frame is not open sea but a flat as bright as
  // the reef (RF2: an islet on a wide flat), so the edge's threshold sits above the reef itself. That is the window being
  // too small, as a reef running past it is; before RF2 Otsu threw a plain Error here, which no window that traced reached.
  if (water.length < 2) throw new NotClosed("no reef flat inside the edge: the window's frame lies on the flat, not open sea");
  const crestThreshold = Math.exp(otsu(water));
  const crest = loopAround(contours(field, windowPx, windowPx, crestThreshold), centre);
  if (crest === null) throw new NotClosed("no closed crest round the island at the flat's threshold");
  // Pixel coordinates are at pixel centres (trace.ts), measured from the window's top-left pixel's corner.
  const utm = (p: Px): Scene => [gi.originX + (x0 + p[0]) * gi.pixelX, gi.originY - (y0 + p[1]) * gi.pixelY];
  // The loops outside the island's own: neither the edge itself nor a hole inside it.
  const others = edgeLoops.filter((l) => l !== edge && !inside(l[0] as Px, edge)).map((l) => l.map(utm));
  return { edgeUtm: edge.map(utm), crestUtm: crest.map(utm), zone, edgeThreshold, crestThreshold, sea, window: { x0, y0, size: windowPx }, others };
}

/** Scene metres, rounded to a centimetre: the shipped precision. */
const cm = (v: number): number => Math.round(v * 100) / 100;

/** Distance from the origin to a ring along a bearing (radians from +x towards +z), the farthest crossing; null if none. */
export function rayDistance(ring: readonly Scene[], theta: number): number | null {
  const dx = Math.cos(theta);
  const dz = Math.sin(theta);
  let best: number | null = null;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j] as Scene;
    const [bx, bz] = ring[i] as Scene;
    const ex = bx - ax;
    const ez = bz - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = (ax * ez - az * ex) / den;
    const u = (ax * dz - az * dx) / den;
    if (t > 0 && u >= 0 && u <= 1 && (best === null || t > best)) best = t;
  }
  return best;
}

/** Absolute shoelace area of a ring in its own units squared. */
const area = (ring: readonly Scene[]): number => ringArea(ring as Px[]);

export interface Built {
  readonly data: string;
  readonly manifest: string;
  readonly summary: string;
}

export function build(osmDir: string, s2Dir: string): Built {
  const osm = checkedFiles(osmDir, [EXTRACT_FILE]);
  const s2 = checkedFiles(s2Dir, [...BANDS, ITEM]);
  const pbf = osm.get(EXTRACT_FILE) as { bytes: Uint8Array; sha256: string };
  const item = itemSchema.parse(JSON.parse(new TextDecoder().decode((s2.get(ITEM) as { bytes: Uint8Array }).bytes)));
  if (!item.properties["earthsearch:boa_offset_applied"]) throw new Refused("the scene's L2A offset is not removed; reflectance would be DN/10,000 − 0.1 and every threshold here would be wrong");
  const reef = osmReef(pbf.bytes);
  const traced = traceScene((s2.get("B03.tif") as { bytes: Uint8Array }).bytes, (s2.get("B08.tif") as { bytes: Uint8Array }).bytes, item.properties["proj:epsg"]);
  const toSceneUtm = (p: Scene): Scene => {
    const ll = fromUtm(p[0], p[1], traced.zone);
    return toScene(ll.lon, ll.lat);
  };
  const tolerance = TOLERANCE_TRUE_M * ISLAND_SOURCE.scale;
  const edge = simplify(traced.edgeUtm.map(toSceneUtm) as Px[], tolerance).map((p): Scene => [cm(p[0]), cm(p[1])]);
  const crest = simplify(traced.crestUtm.map(toSceneUtm) as Px[], tolerance).map((p): Scene => [cm(p[0]), cm(p[1])]);
  // Areas at true scale (m²): OSM's in local metres (scripts/chart/geometry.ts, as the chart measures islands), the
  // traced reef's from the shipped edge scaled back by the transform's own factor, less OSM's island.
  const osmOuter = areaM2(reef.outer as [number, number][]);
  const osmIsland = areaM2(reef.inner as [number, number][]);
  const osmReefArea = osmOuter - osmIsland;
  const k2 = ISLAND_SOURCE.scale ** 2;
  const shippedReefArea = area(edge) / k2 - osmIsland;
  const off = shippedReefArea / osmReefArea - 1;
  if (Math.abs(off) > AREA_TOLERANCE) throw new Refused(`the traced reef's area ${Math.round(shippedReefArea)} m² is ${(off * 100).toFixed(1)} % from OSM's ${Math.round(osmReefArea)} m² (AC162 allows ${AREA_TOLERANCE * 100} %)`);
  // AC163's list: bearings where the shipped edge and OSM's outer way are more than 20 m apart at true scale.
  const osmEdge = reef.outer.map((p) => toScene(p[0], p[1]));
  const bearings: { deg: number; shippedM: number; osmM: number }[] = [];
  for (let b = 0; b < BEARINGS; b++) {
    const theta = (b / BEARINGS) * Math.PI * 2;
    const s = rayDistance(edge, theta);
    const o = rayDistance(osmEdge, theta);
    if (s === null || o === null) throw new Refused(`no edge on bearing ${b * (360 / BEARINGS)}°`);
    bearings.push({ deg: b * (360 / BEARINGS), shippedM: Math.round(s / ISLAND_SOURCE.scale), osmM: Math.round(o / ISLAND_SOURCE.scale) });
  }
  const disagree = bearings.filter((r) => Math.abs(r.shippedM - r.osmM) > DISAGREE_TRUE_M);
  const id = `osm-${pbf.sha256.slice(0, 8)}.r${RELATION}+${item.id}.m${METHOD_VERSION}`;
  // One point to a line: the file is read in review (AC165) and diffed when it is rebuilt.
  const ring = (r: readonly Scene[]): string => `[\n${r.map((p) => `  [${p[0]}, ${p[1]}]`).join(",\n")}\n ]`;
  const head = {
    why: "The traced reef round the home island (R75; D269, D283), in scene metres: x east, z south, the island's own transform. Made by scripts/reef/build-reef.ts; recorded in reef-manifest.json. Contains modified Copernicus Sentinel data 2026, and data © OpenStreetMap contributors (ODbL 1.0).",
    format: "kaabafain-reef",
    version: 1,
    id,
  };
  const data = `{\n${Object.entries(head)
    .map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join("\n")}\n "edge": ${ring(edge)},\n "crest": ${ring(crest)}\n}\n`;
  const sha = createHash("sha256").update(data).digest("hex");
  const manifest = {
    why: "The record of the traced reef (R75, AC162, AC163, AC165). Written by scripts/reef/build-reef.ts; tests/scene/reef.test.ts holds reef.json to it. Never imported by the app.",
    id,
    data: { file: `src/assets/reef/${DATA}`, sha256: sha, edgePoints: edge.length, crestPoints: crest.length },
    licence: [
      "Reef relation and coastline: © OpenStreetMap contributors, under the Open Database Licence (ODbL) 1.0, https://opendatacommons.org/licenses/odbl/1-0/",
      "Edge and crest shapes: Contains modified Copernicus Sentinel data 2026 (Copernicus Sentinel data and service information are free and open, Regulation (EU) No 1159/2013 and the Sentinel data legal notice). Outlines only: no pixel or image is in the repository or the app (D269).",
    ],
    osm: {
      extract: { file: EXTRACT_FILE, sha256: pbf.sha256, dir: "projects/kaabafain/assets-raw/osm-2026-10-14" },
      relation: RELATION,
      tags: reef.tags,
      outerWay: OUTER_WAY,
      innerWay: INNER_WAY,
      outerPoints: reef.outer.length,
      // The outer way itself (ODbL, credited as the coastlines are): what tests/scene/reef.test.ts holds the shipped edge
      // to bearing by bearing, in CI too, where the extract is absent.
      outer: reef.outer.map((p) => [p[0], p[1]]),
      innerPoints: reef.inner.length,
      areaM2: { outer: Math.round(osmOuter), island: Math.round(osmIsland), reef: Math.round(osmReefArea) },
      areaMethod: "scripts/chart/geometry.ts areaM2: shoelace in local equirectangular metres at the ring's mean latitude",
    },
    sentinel2: {
      scene: item.id,
      product: item.properties["s2:product_uri"],
      sensed: item.properties.datetime,
      sceneCloudCover: item.properties["eo:cloud_cover"],
      stac: `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${item.id}`,
      bands: Object.fromEntries(BANDS.map((b) => [b, (s2.get(b) as { sha256: string }).sha256])),
      item: (s2.get(ITEM) as { sha256: string }).sha256,
      dir: "projects/kaabafain/assets-raw/sentinel2-2026-04-20 (PROVENANCE.md)",
      utmZone: traced.zone,
      window: { ...traced.window, pixelM: 10 },
    },
    method: {
      version: METHOD_VERSION,
      code: "scripts/reef/trace.ts (the method and why), scripts/reef/tiff.ts, scripts/reef/utm.ts, scripts/reef/transform.ts",
      reflectance: "DN / 10,000 (Element84 has removed the L2A offset: earthsearch:boa_offset_applied)",
      land: "B08 > B03 (NDWI < 0)",
      openSea: { framePx: FRAME_PX, median: Number(traced.sea.median.toFixed(5)), robustSigma: Number(traced.sea.sigma.toFixed(5)) },
      edge: { rule: `open sea median + ${EDGE_SIGMAS} robust sigma, in B03 reflectance`, threshold: Number(traced.edgeThreshold.toFixed(5)) },
      crest: { rule: "Otsu (256 bins) on ln(smoothed B03) over the water inside the edge", threshold: Number(traced.crestThreshold.toFixed(5)) },
      smoothing: `B03 reflectance blurred by a Gaussian of sigma ${BLUR_SIGMA_PX} px before both contours; land set after`,
      contour: "marching squares at pixel centres, land held above every threshold; the largest loop round the island's centroid",
      simplification: `Douglas–Peucker at ${TOLERANCE_TRUE_M} m true (${tolerance.toFixed(3)} scene m), then rounded to 1 cm`,
    },
    // Depth is not in this record, on purpose: OSM and Sentinel-2 give outlines, and the depth the game draws on them is
    // a rule of its own (Q70, D283, D293) that changes without the outline changing. Recording its numbers here would put
    // game tuning into the published record (D294) and make it go stale with every retune; the line below says where it
    // lives instead. Rejected: a copy of the profile's numbers with a test holding them equal: a second place to edit.
    depth: "Not traced: no open source gives this reef's depth. The game draws a depth profile from the shore on these outlines (kaabafain src/scene/reef.ts; D283, D293), which is game tuning, not data derived from OpenStreetMap or Sentinel-2.",
    transform: {
      what: "the home island's (src/rules/tuning.ts ISLAND_SOURCE; D182, D186): equirectangular round the coastline's area centroid, north to -z, scaled",
      lon0: ISLAND_SOURCE.lon0,
      lat0: ISLAND_SOURCE.lat0,
      metresPerDegLon: `${METRES_PER_DEG_LON_AT_EQUATOR} × cos(lat0)`,
      metresPerDegLat: METRES_PER_DEG_LAT,
      scale: ISLAND_SOURCE.scale,
    },
    result: {
      reefAreaM2: { shipped: Math.round(shippedReefArea), osm: Math.round(osmReefArea), offPercent: Number((off * 100).toFixed(2)), tolerancePercent: AREA_TOLERANCE * 100 },
      sceneAreaM2: { edge: Number(area(edge).toFixed(1)), crest: Number(area(crest).toFixed(1)) },
      bearings: { count: BEARINGS, from: "the coastline's centroid (the scene's origin), degrees from east towards south", disagreeOverM: DISAGREE_TRUE_M, disagree },
    },
  };
  const summary = `reef ${id}: edge ${edge.length} points, crest ${crest.length}; area ${Math.round(shippedReefArea)} m² against OSM's ${Math.round(osmReefArea)} (${(off * 100).toFixed(1)} %); ${disagree.length} of ${BEARINGS} bearings more than ${DISAGREE_TRUE_M} m from OSM's outer way`;
  return { data, manifest: `${JSON.stringify(manifest, null, 2)}\n`, summary };
}

function main(argv: readonly string[]): number {
  const [osmDir, s2Dir] = argv;
  try {
    if (osmDir === undefined || s2Dir === undefined) throw new CouldNotRun("usage: pnpm reef <osm extract dir> <sentinel-2 dir>");
    const built = build(resolve(osmDir), resolve(s2Dir));
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, DATA), built.data);
    writeFileSync(join(OUT_DIR, MANIFEST), built.manifest);
    console.log(built.summary);
    return 0;
  } catch (e) {
    if (e instanceof CouldNotRun) {
      console.error(`build-reef: could not run, not a pass: ${e.message}`);
      return 2;
    }
    if (e instanceof Refused) {
      console.error(`build-reef: refused: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
