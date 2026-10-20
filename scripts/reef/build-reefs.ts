// The traced reefs of the islands he lands on (R75 as draft 18.1 extends it; D375, D380, D387, D388, D390; PLAN v2.6 "The
// reefs of every island, traced", slice RF): builds src/assets/reef/reefs.bin and its record, reefs-manifest.json.
//
//   node scripts/reef/build-reefs.ts <assets-raw dir> [--out <dir>]
//   e.g. node scripts/reef/build-reefs.ts ../../assets-raw            (from a worktree; ../assets-raw from game/)
//
// **The home island's method, generalised from one island to many** (PLAN v2.6). For each island in reef-islands.ts:
//   1. **Its outline** is the shipped chart's ring (src/assets/chart/maldives.bin): what the game draws and places by.
//   2. **Its own transform**: the outline's area centroid, north to −z, at the home scale (transform.ts `frameAt`).
//   3. **Its window**: square on the centroid, 340 m beyond its farthest point, the margin that gives the home island its
//      own 160 px window (scenes.ts `islandWindow` says why the window is part of the method).
//   4. **Its scene**: of every candidate in the year, the one with the least cloud over the window's water by the scene
//      classification, bright ground set aside, ties to the least cloudy tile (scenes.ts says why each part).
//   5. **The trace**: build-reef.ts `traceScene`, the home's own function with the island's centre and window, so one body
//      traces every reef and the home's byte-for-byte rebuild is its regression test.
//   6. **To the data**: UTM to degrees to the island's true metres, Douglas–Peucker at 5 m true (the home's tolerance),
//      quantised once to 1e-5 degrees (the chart's quantum, D390).
//   7. **Held to OpenStreetMap** where it maps the island's reef (osm-reefs.ts): AC162's area within 10 % (the traced and
//      the mapped reef each less the island's charted area), and AC163's list of bearings, every 5° from the centroid,
//      where the two edges differ by more than 20 m.
//   8. **Flags for the review** (D389, doubtful first): no OSM reef, any cloud SCL found over the window's water,
//      something bright at the edge's threshold within 100 m of the traced edge, a reef shared with another island, the
//      charted coast outside the traced crest.
// And Kulhudhuffushi's **kulhi** (D380, D388), from the earliest clear Landsat scene before the island's works (kulhi.ts
// says how it was found that no Sentinel-2 image will do, which this build re-checks from the kept files every run).
//
// **Refusals** (exit 1, nothing written): no closed edge or crest round an island; the crest outside the edge; a traced
// reef's area more than 10 % from OSM's (AC162), unless the owner accepted that very gap for this very batch (D392,
// reef-islands.ts VERDICTS: then it is recorded as his and ships); a Sentinel-2 scene before 2020 that sees Kulhudhuffushi (D388's
// premise would be wrong); cloud on the kulhi; no enclosed water for it. **Could not run** (exit 2): an input directory,
// file or SHA256SUMS line missing or disagreeing, or the clearest scene not fetched. **No pixel leaves this script**
// (D269): only outlines and numbers.
//
// **Not built here: D387's drawn band.** An island with no usable scene or no closed edge is refused, not drawn, until a
// slice needs one (none of RF1's three does); the format already carries the kind (src/rules/reefData.ts).
//
// Deterministic: no clock, no locale, a fixed order everywhere; the same inputs give the same bytes
// (tests/scripts/reef/buildReefs.test.ts rebuilds and compares wherever the inputs are present).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { decodeChart, QUANTUM, type ChartIsland, type LonLat } from "../../src/rules/chartData.ts";
import { ISLAND_SOURCE } from "../../src/rules/islandSource.ts";
import { areaM2, inRing } from "../chart/geometry.ts";
import { AREA_TOLERANCE, BEARINGS, checkedFiles, CouldNotRun, DISAGREE_TRUE_M, EXTRACT_FILE, NoData, rayDistance, Refused, TOLERANCE_TRUE_M, traceScene } from "./build-reef.ts";
import { encodeReefs, type IslandReefToWrite, type QPoint } from "./encode-reefs.ts";
import { enclosedWater, KULHI_TOLERANCE_TRUE_M, kulhiLoops, MIN_PX, mndwi, WATER_MNDWI } from "./kulhi.ts";
import { osmReefs, reefOf, type FoundReef } from "./osm-reefs.ts";
import { CANDIDATES, EARLY_DIR, EXTRACT_DIR, LANDSAT_CANDIDATES, LANDSAT_DIRS, REEF_ISLANDS, SCENE_DIRS, VERDICTS, type ReefIsland } from "./reef-islands.ts";
import { byClearness, islandWindow, windowCloud, WINDOW_MARGIN_M, type Candidate, type IslandWindow } from "./scenes.ts";
import { readTiff, readWindow, TiffError } from "./tiff.ts";
import { simplify, type Px } from "./trace.ts";
import { frameAt, METRES_PER_DEG_LAT, METRES_PER_DEG_LON_AT_EQUATOR, type Frame, type Scene } from "./transform.ts";
import { fromUtm, toUtm } from "./utm.ts";

/** The reefs' method version: the trace's (build-reef.ts METHOD_VERSION 1) with RF's window, scene and kulhi rules. */
export const REEFS_METHOD_VERSION = 1;
/** D390: 256 KB for reefs.bin as base64 in the bundle, read as 256,000 bytes (the stricter reading, as check:chart reads 1 MB). */
export const REEFS_BUDGET_BYTES = 256_000;
/** Something bright this close to a traced edge is a flag for the review, metres at true scale. */
export const NEAR_EDGE_M = 100;
/** A Landsat scene is clear over an island when its quality band flags under this share of the island's pixels. */
export const LANDSAT_CLEAR_SHARE = 0.005;
/**
 * Open sea darker than this in B03 is a flag for the review, not a refusal. Clear tropical ocean reads about 0.01–0.03 in
 * Sentinel-2 L2A green; well below it, the atmospheric correction has removed most of the water's own light, and the
 * edge's threshold (the sea's median plus six sigma) falls with it: Kandoodhoo on 2026-01-10 (0.0028) traces 58 % wider
 * than OSM's reef and, on its other clear scenes, 26–70 %.
 */
export const DARK_SEA = 0.005;

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, "../..");
export const OUT_DIR = join(REPO, "src/assets/reef");
export const DATA = "reefs.bin";
export const MANIFEST = "reefs-manifest.json";
export const CHART_FILE = "src/assets/chart/maldives.bin";
export const CHART_MANIFEST = "src/assets/chart/chart-manifest.json";

const s2ItemSchema = z.object({
  id: z.string(),
  properties: z.object({ datetime: z.string(), "proj:epsg": z.int(), "eo:cloud_cover": z.number(), "s2:product_uri": z.string(), "earthsearch:boa_offset_applied": z.boolean().optional() }),
});
const landsatBand = z.object({ href: z.string(), "raster:bands": z.array(z.object({ scale: z.number().optional(), offset: z.number().optional() })).min(1) });
const landsatItemSchema = z.object({
  id: z.string(),
  properties: z.object({ datetime: z.string(), platform: z.string(), "proj:epsg": z.int(), "eo:cloud_cover": z.number(), "landsat:scene_id": z.string(), "landsat:collection_category": z.string() }),
  assets: z.object({ blue: landsatBand, green: landsatBand, red: landsatBand, swir16: landsatBand, qa_pixel: landsatBand }),
});

/** The names a directory's SHA256SUMS lists, in its order. */
function listed(dir: string): string[] {
  const sums = join(dir, "SHA256SUMS");
  if (!existsSync(sums)) throw new CouldNotRun(`${sums}: missing`);
  return readFileSync(sums, "utf8")
    .split("\n")
    .map((l) => /^[0-9a-f]{64} [ *]?(\S+)$/.exec(l.trim())?.[1])
    .filter((n): n is string => n !== undefined);
}

const sha256 = (b: Uint8Array | string): string => createHash("sha256").update(b).digest("hex");
const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const round = (v: number, d: number): number => Number(v.toFixed(d));

/** A ring of true metres in `frame` to the data's quantised degrees, dropping points the quantum merges. */
function quantise(ring: readonly Scene[], frame: Frame, what: string): QPoint[] {
  const out: QPoint[] = [];
  for (const [x, z] of ring) {
    const [lon, lat] = frame.fromTrue(x, z);
    const q: QPoint = [Math.round(lon * QUANTUM), Math.round(lat * QUANTUM)];
    const last = out[out.length - 1];
    if (last === undefined || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]) out.pop();
  if (out.length < 3) throw new Refused(`${what}: fewer than three points after quantising`);
  return out;
}
const degrees = (q: readonly QPoint[]): LonLat[] => q.map(([x, y]) => [x / QUANTUM, y / QUANTUM]);

function segmentDistance(p: Scene, a: Scene, b: Scene): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}
/** The least distance from any point of `loop` to the ring `ring` (both in one frame's metres). */
function nearest(loop: readonly Scene[], ring: readonly Scene[]): number {
  let best = Infinity;
  for (const p of loop) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, segmentDistance(p, ring[j] as Scene, ring[i] as Scene));
  return best;
}
const ringAreaTrue = (r: readonly Scene[]): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j] as Scene)[0] * (r[i] as Scene)[1] - (r[i] as Scene)[0] * (r[j] as Scene)[1];
  return Math.abs(a / 2);
};

export interface ReviewIsland {
  readonly id: string;
  readonly name: string;
  readonly flags: readonly string[];
  readonly sceneDir: string;
  readonly window: IslandWindow & { readonly x0: number; readonly y0: number };
  readonly coast: readonly LonLat[];
  readonly edge: readonly LonLat[];
  readonly crest: readonly LonLat[];
  readonly osm: readonly LonLat[] | null;
  readonly disagree: readonly { readonly deg: number; readonly tracedM: number; readonly osmM: number }[];
  readonly others: readonly (readonly LonLat[])[];
  readonly kulhi: { readonly dir: string; readonly files: { readonly red: string; readonly green: string; readonly blue: string }; readonly window: IslandWindow & { readonly x0: number; readonly y0: number }; readonly rings: readonly (readonly LonLat[])[] } | null;
}

export interface Built {
  /** Islands the build refuses (AC162), each with its reason. While any is listed, `main` writes nothing. */
  readonly refusals: readonly string[];
  readonly data: Uint8Array;
  readonly manifest: string;
  readonly summary: string;
  readonly review: readonly ReviewIsland[];
}

interface CandidateScene {
  readonly scene: string;
  readonly sensed: string;
  readonly tileCloud: number;
  readonly epsg: number;
  readonly scl: Uint8Array;
}

/** Every candidate the rule may choose from (reef-islands.ts CANDIDATES), each checked against SHA256SUMS. */
function readCandidates(rawDir: string): { scenes: CandidateScene[]; sums: string } {
  const dir = join(rawDir, CANDIDATES.dir);
  const files = checkedFiles(dir, listed(dir));
  const scenes: CandidateScene[] = [];
  for (const [name, f] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.endsWith(".item.json")) continue;
    const item = s2ItemSchema.parse(JSON.parse(text(f.bytes)));
    const sensed = item.properties.datetime.slice(0, 10);
    if (sensed < CANDIDATES.sensedFrom || sensed > CANDIDATES.sensedTo || item.properties["eo:cloud_cover"] >= CANDIDATES.maxTileCloud) continue;
    const scl = files.get(`${item.id}.SCL.tif`);
    if (scl === undefined) throw new CouldNotRun(`${dir}: ${item.id}'s SCL.tif is not listed in SHA256SUMS`);
    scenes.push({ scene: item.id, sensed, tileCloud: item.properties["eo:cloud_cover"], epsg: item.properties["proj:epsg"], scl: scl.bytes });
  }
  return { scenes, sums: sha256(readFileSync(join(dir, "SHA256SUMS"))) };
}

/** Pixels of a window over the island's charted outline, and a test for one window pixel's centre. */
function islandMask(coast: readonly LonLat[], zone: number, originX: number, originY: number, pixel: number, x0: number, y0: number, w: number, h: number): Uint8Array {
  const utm = coast.map(([lon, lat]) => toUtm(lon, lat, zone));
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ux = originX + (x0 + x + 0.5) * pixel;
      const uy = originY - (y0 + y + 0.5) * pixel;
      let c = false;
      for (let i = 0, j = utm.length - 1; i < utm.length; j = i++) {
        const a = utm[i] as { x: number; y: number };
        const b = utm[j] as { x: number; y: number };
        if (a.y > uy !== b.y > uy && ux < ((b.x - a.x) * (uy - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      if (c) mask[y * w + x] = 1;
    }
  return mask;
}

/** Landsat Collection 2 QA_PIXEL bits: fill (0), dilated cloud (1), cirrus (2), cloud (3), cloud shadow (4). */
const QA_BAD = 0b11111;

/** Kulhudhuffushi's kulhi (kulhi.ts): the Landsat scene by rule, then the enclosed water, outlined. */
function kulhiOf(rawDir: string, island: ChartIsland, frame: Frame) {
  const coast = island.ring as readonly LonLat[];
  // 1. D388's premise, re-checked: no Sentinel-2 scene before 2020 holds a pixel over the island's window.
  const early = join(rawDir, EARLY_DIR);
  const earlyFiles = checkedFiles(early, listed(early));
  let earlyScenes = 0;
  let earlyWithScl = 0;
  for (const [name, f] of [...earlyFiles].sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.endsWith(".item.json")) continue;
    earlyScenes++;
    const item = s2ItemSchema.parse(JSON.parse(text(f.bytes)));
    const scl = earlyFiles.get(`${item.id}.SCL.tif`);
    if (scl === undefined) continue;
    earlyWithScl++;
    const zone = item.properties["proj:epsg"] - 32600;
    const win = islandWindow(coast, zone);
    const cloud = windowCloud(scl.bytes, coast, win, zone);
    if (cloud.unusable !== cloud.pixels) throw new Refused(`${item.id} (${item.properties.datetime.slice(0, 10)}) sees Kulhudhuffushi: D388's premise, that no Sentinel-2 image shows the kulhi before the works, needs re-reading`);
  }
  // 2. The earliest Landsat scene whose quality band is clear over the island (LANDSAT_CLEAR_SHARE), by rule.
  const cands = join(rawDir, LANDSAT_CANDIDATES);
  const candFiles = checkedFiles(cands, listed(cands));
  const screened: { scene: string; sensed: string; platform: string; islandPx: number; flagged: number; fill: number }[] = [];
  for (const [name, f] of [...candFiles].sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.endsWith(".item.json")) continue;
    const item = landsatItemSchema.parse(JSON.parse(text(f.bytes)));
    const qaName = item.assets.qa_pixel.href.split("/").pop() as string;
    const qa = candFiles.get(qaName);
    if (qa === undefined) throw new CouldNotRun(`${cands}: ${qaName} is not listed in SHA256SUMS`);
    const zone = item.properties["proj:epsg"] - 32600;
    const win = islandWindow(coast, zone, 30);
    const img = readTiff(qa.bytes);
    const c = toUtm(win.centre[0], win.centre[1], zone);
    const x0 = Math.floor((c.x - img.originX) / 30) - win.sizePx / 2;
    const y0 = Math.floor((img.originY - c.y) / 30) - win.sizePx / 2;
    const v = readWindow(qa.bytes, img, x0, y0, win.sizePx, win.sizePx).values;
    const mask = islandMask(coast, zone, img.originX, img.originY, 30, x0, y0, win.sizePx, win.sizePx);
    let islandPx = 0;
    let flagged = 0;
    let fill = 0;
    for (let k = 0; k < v.length; k++) {
      if (((v[k] as number) & 1) !== 0) fill++;
      if (mask[k] !== 1) continue;
      islandPx++;
      if (((v[k] as number) & QA_BAD) !== 0) flagged++;
    }
    screened.push({ scene: item.id, sensed: item.properties.datetime.slice(0, 10), platform: item.properties.platform, islandPx, flagged, fill });
  }
  screened.sort((a, b) => a.sensed.localeCompare(b.sensed) || a.scene.localeCompare(b.scene));
  const chosen = screened.find((s) => s.fill === 0 && s.flagged < s.islandPx * LANDSAT_CLEAR_SHARE);
  if (chosen === undefined) throw new Refused("no Landsat candidate is clear over Kulhudhuffushi");
  const dirName = LANDSAT_DIRS[chosen.scene];
  if (dirName === undefined) throw new CouldNotRun(`the kulhi's Landsat scene is ${chosen.scene}: fetch it whole into assets-raw and list it in reef-islands.ts LANDSAT_DIRS`);
  const dir = join(rawDir, dirName);
  const item = landsatItemSchema.parse(JSON.parse(text((checkedFiles(dir, ["item.json"]).get("item.json") as { bytes: Uint8Array }).bytes)));
  if (item.id !== chosen.scene) throw new CouldNotRun(`${dir}/item.json is ${item.id}, not ${chosen.scene}`);
  const base = (a: { href: string }): string => a.href.split("/").pop() as string;
  const names = { blue: base(item.assets.blue), red: base(item.assets.red), green: item.assets.green.href.split("/").pop() as string, swir1: item.assets.swir16.href.split("/").pop() as string, qa: item.assets.qa_pixel.href.split("/").pop() as string };
  const files = checkedFiles(dir, [names.green, names.swir1, names.qa, "item.json"]);
  for (const b of [item.assets.green, item.assets.swir16]) {
    const rb = b["raster:bands"][0];
    if (rb?.scale !== 0.0000275 || rb.offset !== -0.2) throw new Refused(`${item.id}: a band's scale and offset are not Collection 2 Level-2's 0.0000275 and −0.2`);
  }
  const zone = item.properties["proj:epsg"] - 32600;
  const win = islandWindow(coast, zone, 30);
  const read = (name: string) => {
    const bytes = (files.get(name) as { bytes: Uint8Array }).bytes;
    const img = readTiff(bytes);
    if (img.pixelX !== 30) throw new Refused(`${name}: ${img.pixelX} m pixels, not 30`);
    const c = toUtm(win.centre[0], win.centre[1], zone);
    const x0 = Math.floor((c.x - img.originX) / 30) - win.sizePx / 2;
    const y0 = Math.floor((img.originY - c.y) / 30) - win.sizePx / 2;
    return { img, x0, y0, values: readWindow(bytes, img, x0, y0, win.sizePx, win.sizePx).values };
  };
  const g = read(names.green);
  const s = read(names.swir1);
  const q = read(names.qa);
  const W = win.sizePx;
  const refl = (dn: number): number => dn * 0.0000275 - 0.2;
  const index = new Float64Array(W * W);
  const water = new Uint8Array(W * W);
  for (let k = 0; k < W * W; k++) {
    if (g.values[k] === 0 || s.values[k] === 0) throw new Refused(`${item.id}: no-data in the kulhi's window`);
    index[k] = mndwi(refl(g.values[k] as number), refl(s.values[k] as number));
    if ((index[k] as number) >= WATER_MNDWI) water[k] = 1;
  }
  const { regions } = enclosedWater(water, W, W);
  const centreOf = (r: readonly number[]): LonLat => {
    let sx = 0;
    let sy = 0;
    for (const k of r) {
      sx += g.img.originX + (g.x0 + (k % W) + 0.5) * 30;
      sy += g.img.originY - (g.y0 + Math.floor(k / W) + 0.5) * 30;
    }
    const ll = fromUtm(sx / r.length, sy / r.length, zone);
    return [ll.lon, ll.lat];
  };
  // The largest enclosed region inside the island is the kulhi (kulhi.ts, step 3); ties go to the first in pixel order.
  const inside = regions.filter((r) => inRing(centreOf(r), coast));
  const largest = inside.reduce<readonly number[] | null>((best, r) => (best === null || r.length > best.length ? r : best), null);
  if (largest === null || largest.length < MIN_PX) throw new Refused(`${item.id}: no enclosed water of ${MIN_PX} pixels or more inside Kulhudhuffushi`);
  const keep: number[][] = [[...largest]];
  const dropped = regions
    .filter((r) => r !== largest)
    .map((r) => {
      const c = centreOf(r);
      return { pixels: r.length, centre: [round(c[0], 5), round(c[1], 5)], why: inRing(c, coast) ? "other enclosed water inside the island: not the kulhi (D380 names one)" : "not inside the island's charted outline" };
    });
  // Cloud, shadow or fill on the kulhi or the pixels round it: refused, not drawn.
  let flaggedNear = 0;
  for (const r of keep)
    for (const k of r)
      for (const d of [0, -1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1]) {
        const n = k + d;
        if (n >= 0 && n < W * W && ((q.values[n] as number) & QA_BAD) !== 0) flaggedNear++;
      }
  if (flaggedNear > 0) throw new Refused(`${item.id}: the quality band flags cloud, shadow or fill on or beside the kulhi (${flaggedNear})`);
  const loops = kulhiLoops(index, keep, W, W);
  const toTrue = (p: Px): Scene => {
    const ll = fromUtm(g.img.originX + (g.x0 + p[0]) * 30, g.img.originY - (g.y0 + p[1]) * 30, zone);
    return frame.toTrue(ll.lon, ll.lat);
  };
  const rings = loops.map((l, i) => {
    if (l === null) throw new Refused(`${item.id}: kulhi region ${i} has no closed outline`);
    return quantise(simplify(l.map(toTrue) as Px[], KULHI_TOLERANCE_TRUE_M) as Scene[], frame, `the kulhi's ring ${i}`);
  });
  const record = {
    why: "Kulhudhuffushi's kulhi, the island's wetland, as open marsh before the island's modern works (D362, D380, D388; H50 holds the claim, unchecked until the owner signs it). Traced by scripts/reef/kulhi.ts, which says how and why.",
    sentinel2: { rule: "no Sentinel-2 scene before 2020 holds a pixel over the island's window (re-checked from these files every build); the first Sentinel-2 images of the island are from June 2021, after the airport", dir: `projects/kaabafain/assets-raw/${EARLY_DIR}`, scenes: earlyScenes, withSceneClassification: earlyWithScl, seeingTheIsland: 0, sums: sha256(readFileSync(join(early, "SHA256SUMS"))) },
    landsat: {
      rule: `the earliest Landsat Collection 2 Level-2 scene (30 m) whose quality band flags no fill in the island's window and under ${LANDSAT_CLEAR_SHARE * 100} % of the island's charted pixels as cloud, dilated cloud, cirrus or shadow`,
      candidates: { dir: `projects/kaabafain/assets-raw/${LANDSAT_CANDIDATES}`, screened: screened.length, sums: sha256(readFileSync(join(cands, "SHA256SUMS"))), earlierThanChosen: screened.filter((x) => x.sensed < chosen.sensed).map((x) => ({ scene: x.scene, sensed: x.sensed, flagged: x.flagged, fill: x.fill })) },
      scene: item.id,
      sceneId: item.properties["landsat:scene_id"],
      platform: item.properties.platform,
      sensed: item.properties.datetime,
      sceneCloudCover: item.properties["eo:cloud_cover"],
      collection: `Collection 2 Level-2, Tier ${item.properties["landsat:collection_category"].replace(/^T/, "")}`,
      islandPixelsFlagged: { flagged: chosen.flagged, of: chosen.islandPx },
      stac: `https://planetarycomputer.microsoft.com/api/stac/v1/collections/landsat-c2-l2/items/${item.id}`,
      dir: `projects/kaabafain/assets-raw/${dirName} (PROVENANCE.md)`,
      bands: { [names.green]: (files.get(names.green) as { sha256: string }).sha256, [names.swir1]: (files.get(names.swir1) as { sha256: string }).sha256, [names.qa]: (files.get(names.qa) as { sha256: string }).sha256 },
      item: (files.get("item.json") as { sha256: string }).sha256,
    },
    method: {
      water: `MNDWI = (green − SWIR1) / (green + SWIR1) ≥ ${WATER_MNDWI}, TM bands 2 and 5, reflectance DN × 0.0000275 − 0.2`,
      enclosed: "water a 4-connected flood from the window's border does not reach",
      kept: `the largest enclosed region whose centre is inside the charted outline, at least ${MIN_PX} pixels; every other enclosed region listed in dropped`,
      outline: `marching squares at MNDWI ${WATER_MNDWI}, other water held at −1; Douglas–Peucker at ${KULHI_TOLERANCE_TRUE_M} m true; quantised to 1e-5 degrees`,
      window: { centre: [win.centre[0], win.centre[1]], sizePx: W, pixelM: 30, x0: g.x0, y0: g.y0 },
    },
    regions: keep.map((r, i) => ({ pixels: r.length, pixelAreaM2: r.length * 900, outlinePoints: (rings[i] as QPoint[]).length, outlineAreaM2: Math.round(areaM2(degrees(rings[i] as QPoint[]))) })),
    dropped,
    cannotSee: "the marsh's mangrove margin (land at 30 m), the water's extent in another season (1997-04-15 is the end of the dry season), anything under about a pixel, and whether 1997 is the island as it was before 1153 (H50, the owner's to sign)",
    outlines: rings.map((r) => degrees(r)),
  };
  const review = { dir: dirName, files: { red: names.red, green: names.green, blue: names.blue }, window: { ...win, x0: g.x0, y0: g.y0 }, rings: rings.map(degrees) };
  return { rings, record, review, sensedYear: item.properties.datetime.slice(0, 4), platform: item.properties.platform };
}

export function build(rawDir: string, repo: string = REPO): Built {
  const osm = checkedFiles(join(rawDir, EXTRACT_DIR), [EXTRACT_FILE]);
  const pbf = osm.get(EXTRACT_FILE) as { bytes: Uint8Array; sha256: string };
  for (const p of [CHART_FILE, CHART_MANIFEST]) if (!existsSync(join(repo, p))) throw new CouldNotRun(`${join(repo, p)}: missing (the islands' outlines are the shipped chart's)`);
  const chartBytes = new Uint8Array(readFileSync(join(repo, CHART_FILE)));
  const chart = decodeChart(chartBytes);
  const { scenes: candidates, sums: candidateSums } = readCandidates(rawDir);
  const reefRings = osmReefs(pbf.bytes);
  const islands: IslandReefToWrite[] = [];
  const records: unknown[] = [];
  const review: ReviewIsland[] = [];
  const years = new Set<string>();
  const refusals: string[] = [];
  const gaps: { id: string; name: string; offPercent: number; why: string; flags: string[]; area: { judged: unknown } }[] = [];
  let landsatPlatform: string | null = null;
  const sceneIds: string[] = [];
  for (const spec of REEF_ISLANDS) {
    const island = chart.islands.find((i) => i.id === spec.id);
    if (island === undefined) throw new Refused(`${spec.name} (${spec.id}) is not an island in chart ${chart.id}`);
    const coast = island.ring as readonly LonLat[];
    const traced = traceIsland(rawDir, spec, coast, candidates);
    const frame = frameAt({ lon0: traced.win.centre[0], lat0: traced.win.centre[1], scale: ISLAND_SOURCE.scale });
    const toTrueUtm = (p: Scene): Scene => {
      const ll = fromUtm(p[0], p[1], traced.zone);
      return frame.toTrue(ll.lon, ll.lat);
    };
    const edgeQ = quantise(simplify(traced.t.edgeUtm.map(toTrueUtm) as Px[], TOLERANCE_TRUE_M) as Scene[], frame, `${spec.name}'s edge`);
    const crestQ = quantise(simplify(traced.t.crestUtm.map(toTrueUtm) as Px[], TOLERANCE_TRUE_M) as Scene[], frame, `${spec.name}'s crest`);
    const edge = degrees(edgeQ);
    const crest = degrees(crestQ);
    if (!crest.every((p) => inRing(p, edge))) throw new Refused(`${spec.name}: the traced crest crosses the traced edge`);
    const islandArea = areaM2(coast);
    const tracedReef = areaM2(edge) - islandArea;
    const found: FoundReef | null = reefOf(island, reefRings, chart.islands);
    const edgeTrue = edge.map(([lon, lat]) => frame.toTrue(lon, lat));
    const flags: string[] = [];
    let osmRecord: unknown = null;
    let off: number | null = null;
    // The record's AC162 line, filled once the batch is known (the judgement, if the owner gave one for this batch).
    const area: { traced: number; osm: number | null; offPercent: number | null; tolerancePercent: number; judged: unknown } = { traced: 0, osm: null, offPercent: null, tolerancePercent: AREA_TOLERANCE * 100, judged: null };
    let disagree: { deg: number; tracedM: number; osmM: number }[] = [];
    if (found === null) flags.push("no OSM reef: the trace stands alone");
    else {
      const osmReef = found.reef.areaM2 - islandArea;
      off = tracedReef / osmReef - 1;
      // AC162: settled after every island is traced (below), because whether the owner has accepted the gap depends on the
      // batch's id, which names every island's scene.
      if (Math.abs(off) > AREA_TOLERANCE) gaps.push({ id: spec.id, name: spec.name, offPercent: round(off * 100, 2), why: `the traced reef's area ${Math.round(tracedReef)} m² is ${(off * 100).toFixed(1)} % from OSM's ${Math.round(osmReef)} m² (AC162 allows ${AREA_TOLERANCE * 100} %)`, flags, area });
      const osmTrue = found.reef.outer.map(([lon, lat]) => frame.toTrue(lon, lat));
      const all: { deg: number; tracedM: number; osmM: number }[] = [];
      for (let b = 0; b < BEARINGS; b++) {
        const theta = (b / BEARINGS) * Math.PI * 2;
        const s = rayDistance(edgeTrue, theta);
        const o = rayDistance(osmTrue, theta);
        if (s === null || o === null) throw new Refused(`${spec.name}: no edge on bearing ${b * (360 / BEARINGS)}°`);
        all.push({ deg: b * (360 / BEARINGS), tracedM: Math.round(s), osmM: Math.round(o) });
      }
      disagree = all.filter((r) => Math.abs(r.tracedM - r.osmM) > DISAGREE_TRUE_M);
      if (found.sharedWith.length > 0) flags.push(`a shared reef: OSM's reef also holds ${found.sharedWith.join(", ")}`);
      osmRecord = {
        element: found.reef.element,
        tags: found.reef.tags,
        outerWays: found.reef.outerWays,
        innerWays: found.reef.innerWays,
        outerPoints: found.reef.outer.length,
        // The outer ring itself (ODbL, credited as the coastlines are): what the review and the check hold the trace to
        // where the extract is absent.
        outer: found.reef.outer.map((p) => [p[0], p[1]]),
        areaM2: { outer: Math.round(found.reef.areaM2), island: Math.round(islandArea), reef: Math.round(osmReef) },
        areaMethod: "scripts/chart/geometry.ts areaM2 on the outer ring, less the island's charted outline (the same subtraction from the traced edge)",
        sharedWith: found.sharedWith,
      };
    }
    if (traced.t.sea.median < DARK_SEA) flags.push(`a dark open sea: median ${traced.t.sea.median.toFixed(4)} in B03, under ${DARK_SEA} (the atmospheric correction may have taken most of the water's light, which lowers the edge's threshold and widens the reef)`);
    const cloudOverWater = traced.chosen.window.score ?? 0;
    if (cloudOverWater > 0) flags.push(`cloud over the window's water: ${cloudOverWater} SCL pixels`);
    const others = traced.t.others.map((l) => l.map(toTrueUtm));
    const near = others.map((l) => ({ m: nearest(l, edgeTrue), areaM2: ringAreaTrue(l), loop: l })).filter((o) => o.m <= NEAR_EDGE_M);
    if (near.length > 0) flags.push(`bright near the edge: ${near.length} loop(s) at the edge's threshold within ${NEAR_EDGE_M} m`);
    const coastOutside = coast.filter((p) => !inRing(p, crest)).length;
    if (coastOutside > 0) flags.push(`the charted coast outside the traced crest at ${coastOutside} of ${coast.length} points`);
    let marsh: QPoint[][] = [];
    let kulhiRecord: unknown;
    let kulhiReview: ReviewIsland["kulhi"] = null;
    if (spec.kulhi === true) {
      const k = kulhiOf(rawDir, island, frame);
      marsh = k.rings;
      kulhiRecord = k.record;
      kulhiReview = k.review;
      landsatPlatform = k.platform;
    }
    years.add(traced.item.properties.datetime.slice(0, 4));
    sceneIds.push(`${spec.id}:${traced.item.id}`);
    islands.push({ id: spec.id, kind: "traced", edge: edgeQ, crest: crestQ, marsh });
    records.push({
      id: spec.id,
      name: spec.name,
      part: spec.part,
      atoll: island.atoll,
      kind: "traced",
      transform: {
        what: "the island's own (PLAN v2.6): equirectangular round the area centroid of its shipped chart outline, north to -z, at the home scale (scripts/reef/transform.ts frameAt)",
        lon0: frame.origin.lon0,
        lat0: frame.origin.lat0,
        metresPerDegLon: `${METRES_PER_DEG_LON_AT_EQUATOR} × cos(lat0)`,
        metresPerDegLat: METRES_PER_DEG_LAT,
        scale: frame.origin.scale,
      },
      window: { rule: `square on the centroid, ${WINDOW_MARGIN_M} m beyond the outline's farthest point on either axis, the home island's own 160 px window generalised (scripts/reef/scenes.ts islandWindow)`, sizePx: traced.win.sizePx, pixelM: 10, x0: traced.t.window.x0, y0: traced.t.window.y0 },
      sentinel2: {
        scene: traced.item.id,
        product: traced.item.properties["s2:product_uri"],
        sensed: traced.item.properties.datetime,
        sceneCloudCover: traced.item.properties["eo:cloud_cover"],
        stac: `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${traced.item.id}`,
        dir: `projects/kaabafain/assets-raw/${traced.sceneDir} (PROVENANCE.md)`,
        bands: traced.bands,
        item: traced.itemSha,
        utmZone: traced.zone,
      },
      choice: {
        rule: "the least cloud over the window's water by SCL (shadow, cloud, cirrus), cloud flags on land or within 40 m of the coast set aside as bright ground; no-data rules a scene out; ties to the least cloudy tile, then the earlier date (scripts/reef/scenes.ts)",
        candidates: traced.table,
      },
      osm: osmRecord,
      method: {
        openSea: { framePx: 8, median: round(traced.t.sea.median, 5), robustSigma: round(traced.t.sea.sigma, 5) },
        edge: { threshold: round(traced.t.edgeThreshold, 5) },
        crest: { threshold: round(traced.t.crestThreshold, 5) },
      },
      result: {
        points: { edge: edgeQ.length, crest: crestQ.length, marsh: marsh.map((m) => m.length) },
        reefAreaM2: Object.assign(area, { traced: Math.round(tracedReef), osm: found === null ? null : Math.round(found.reef.areaM2 - islandArea), offPercent: off === null ? null : round(off * 100, 2) }),
        bearings: { count: BEARINGS, from: "the island's centroid, degrees from east towards south", disagreeOverM: DISAGREE_TRUE_M, disagree },
        brightNearEdge: near.map((o) => ({ nearestM: Math.round(o.m), areaM2: Math.round(o.areaM2) })),
        coastOutsideCrest: coastOutside,
      },
      flags,
      ...(kulhiRecord === undefined ? {} : { kulhi: kulhiRecord }),
    });
    review.push({
      id: spec.id,
      name: spec.name,
      flags,
      sceneDir: traced.sceneDir,
      window: { ...traced.win, x0: traced.t.window.x0, y0: traced.t.window.y0 },
      coast,
      edge,
      crest,
      osm: found === null ? null : found.reef.outer,
      disagree,
      others: near.map((o) => o.loop.map(([x, z]) => frame.fromTrue(x, z))),
      kulhi: kulhiReview,
    });
  }
  const id = `osm-${pbf.sha256.slice(0, 8)}.s2-${sha256(sceneIds.join(",")).slice(0, 8)}.m${REEFS_METHOD_VERSION}`;
  // AC162 (D392): a gap over 10 % is refused, recorded rather than thrown so the review figure can still show what was
  // traced; unless the owner has accepted that gap for this very batch (reef-islands.ts VERDICTS: the batch's id and the
  // gap he saw, to the hundredth of a percent), when it is recorded as his and ships. Nothing is written while any island
  // is refused (`main`).
  const verdict = VERDICTS.find((v) => v.reefsId === id) ?? null;
  for (const g of gaps) {
    const seen = verdict?.acceptsAreaGap[g.id];
    if (verdict !== null && seen !== undefined && Math.abs(seen - g.offPercent) < 0.005) {
      g.area.judged = { decision: verdict.decision, date: verdict.date, offPercentSeen: seen, by: "the owner" };
      g.flags.push(`OSM's reef differs by more than AC162's 10 %, accepted by the owner (${verdict.decision}, ${verdict.date}): ${g.why}`);
    } else {
      refusals.push(`${g.name}: ${g.why}`);
      g.flags.push(`refused by AC162: ${g.why}`);
    }
  }
  const data = encodeReefs({ id, islands });
  const base64 = 4 * Math.ceil(data.length / 3);
  const yearList = [...years].sort();
  const copernicus = `Contains modified Copernicus Sentinel data ${yearList.join(" and ")}`;
  const order = [...review].sort((a, b) => b.flags.length - a.flags.length || REEF_ISLANDS.findIndex((s) => s.id === a.id) - REEF_ISLANDS.findIndex((s) => s.id === b.id)).map((r) => r.id);
  const manifest = {
    why: "The record of the traced reefs of the islands he can land on (R75 as draft 18.1 extends it, AC162, AC163, AC165; D375, D380, D387, D388). Written by scripts/reef/build-reefs.ts; scripts/check-reefs.ts holds reefs.bin to it. Never imported by the app. The home island's reef is not here: src/assets/reef/reef.json and reef-manifest.json.",
    id,
    data: { file: `src/assets/reef/${DATA}`, sha256: sha256(data), bytes: data.length, base64Bytes: base64, islands: islands.length, points: islands.reduce((s, i) => s + i.edge.length + i.crest.length + i.marsh.reduce((t, m) => t + m.length, 0), 0) },
    budget: { base64Bytes: REEFS_BUDGET_BYTES, what: "D390: 256 KB as base64 in the bundle, read as 256,000 bytes" },
    licence: [
      "Reef polygons and coastlines: © OpenStreetMap contributors, under the Open Database Licence (ODbL) 1.0, https://opendatacommons.org/licenses/odbl/1-0/",
      `Edge and crest shapes: ${copernicus} (Copernicus Sentinel data and service information are free and open, Regulation (EU) No 1159/2013 and the Sentinel data legal notice). Outlines only: no pixel or image is in the repository or the app (D269).`,
      ...(landsatPlatform === null ? [] : [`Kulhudhuffushi's kulhi: ${landsatPlatform === "landsat-5" ? "Landsat-5" : landsatPlatform} image courtesy of the U.S. Geological Survey (Landsat data are in the public domain). Outlines only: no pixel or image is in the repository or the app.`]),
    ],
    copernicusYears: yearList,
    sources: {
      osm: { extract: { file: EXTRACT_FILE, sha256: pbf.sha256, dir: `projects/kaabafain/assets-raw/${EXTRACT_DIR}` } },
      chart: { file: CHART_FILE, sha256: sha256(chartBytes), chartId: chart.id },
      candidates: { dir: `projects/kaabafain/assets-raw/${CANDIDATES.dir} (PROVENANCE.md)`, sensedFrom: CANDIDATES.sensedFrom, sensedTo: CANDIDATES.sensedTo, maxTileCloudPercent: CANDIDATES.maxTileCloud, scenes: candidates.length, sums: candidateSums },
    },
    method: {
      version: REEFS_METHOD_VERSION,
      code: "scripts/reef/build-reefs.ts (the steps and why), scripts/reef/build-reef.ts traceScene (the home's trace, one body for every island), scripts/reef/trace.ts (the method and why), scripts/reef/scenes.ts, scripts/reef/osm-reefs.ts, scripts/reef/kulhi.ts, scripts/reef/transform.ts, scripts/reef/tiff.ts, scripts/reef/utm.ts, scripts/reef/encode-reefs.ts",
      reflectance: "Sentinel-2 L2A DN / 10,000 (Element84 has removed the L2A offset)",
      land: "B08 > B03 (NDWI < 0), held above every threshold",
      edge: "the open sea's median + 6 robust sigma in B03 reflectance, on the window's 8-pixel frame",
      crest: "Otsu (256 bins) on ln(smoothed B03) over the water inside the edge",
      smoothing: "B03 blurred by a Gaussian of sigma 1 px before both contours; land set after",
      contour: "marching squares at pixel centres; the largest loop round the island's centroid",
      simplification: `Douglas–Peucker at ${TOLERANCE_TRUE_M} m true in the island's own frame, then quantised once to 1e-5 degrees`,
    },
    depth: "Not traced: no open source gives these reefs' depth. The game draws a depth profile from the shore on these outlines, as it does at home (kaabafain src/scene/reef.ts; D283, D293), which is game tuning, not data derived from OpenStreetMap, Sentinel-2 or Landsat.",
    review: {
      order,
      rule: "D389: the owner judges these on a contact sheet on the Mac, the doubtful first (most flags first, then the list's order); AC163's verdict is recorded with the batch",
      verdict: verdict === null ? null : { by: "the owner", decision: verdict.decision, date: verdict.date, verdict: verdict.verdict, seenOn: verdict.seenOn },
    },
    islands: records,
  };
  const summary = `reefs ${id}: ${islands.length} islands, ${data.length.toLocaleString("en")} bytes (${base64.toLocaleString("en")} as base64, ${((100 * base64) / REEFS_BUDGET_BYTES).toFixed(1)} % of ${REEFS_BUDGET_BYTES.toLocaleString("en")}); ${review
    .map((r) => {
      const rec = (records as { id: string; result: { reefAreaM2: { offPercent: number | null }; bearings: { disagree: unknown[] } } }[]).find((x) => x.id === r.id);
      return `${r.name} ${rec?.result.reefAreaM2.offPercent ?? "no OSM"} % area, ${rec?.result.bearings.disagree.length ?? 0} of ${BEARINGS} bearings over ${DISAGREE_TRUE_M} m, ${r.flags.length} flag(s)`;
    })
    .join("; ")}`;
  return { refusals, data, manifest: `${JSON.stringify(manifest, null, 2)}\n`, summary, review };
}

/** Steps 3–5 for one island: its window, its scene by rule, and the trace. */
function traceIsland(rawDir: string, spec: ReefIsland, coast: readonly LonLat[], candidates: readonly CandidateScene[]) {
  const zones = new Set(candidates.map((c) => c.epsg));
  if (zones.size !== 1) throw new Refused(`the candidates span ${zones.size} UTM zones; this build reads one`);
  const epsg = candidates[0]?.epsg ?? 0;
  const zone = epsg - 32600;
  const win = islandWindow(coast, zone);
  const scored: Candidate[] = [];
  let notOver = 0;
  for (const c of candidates) {
    try {
      scored.push({ scene: c.scene, sensed: c.sensed, tileCloud: c.tileCloud, window: windowCloud(c.scl, coast, win, zone) });
    } catch (e) {
      // A candidate from another tile: the island's window is not inside its image.
      if (!(e instanceof TiffError)) throw e;
      notOver++;
    }
  }
  // Clearest first; a scene the trace cannot read (no data in the window, the trace's own NoData refusal) is passed over for
  // the next, and the record says so. Only that: a reef that will not close is a finding about the reef, not the scene.
  const order = byClearness(scored);
  if (order.length === 0) throw new Refused(`${spec.name}: no candidate scene is usable over its window (D387's drawn band is not built here)`);
  const passedOver: { scene: string; why: string }[] = [];
  let found: { chosen: Candidate; sceneDir: string; s2: Map<string, { bytes: Uint8Array; sha256: string }>; item: z.infer<typeof s2ItemSchema>; t: ReturnType<typeof traceScene> } | null = null;
  for (const c of order) {
    const dir = SCENE_DIRS[c.scene];
    if (dir === undefined) throw new CouldNotRun(`${spec.name}'s clearest readable scene may be ${c.scene}: fetch it whole into assets-raw and list it in reef-islands.ts SCENE_DIRS`);
    const s2 = checkedFiles(join(rawDir, dir), ["B03.tif", "B08.tif", "SCL.tif", "item.json"]);
    const item = s2ItemSchema.parse(JSON.parse(text((s2.get("item.json") as { bytes: Uint8Array }).bytes)));
    if (item.id !== c.scene) throw new CouldNotRun(`${dir}/item.json is ${item.id}, not ${c.scene}`);
    if (item.properties["earthsearch:boa_offset_applied"] !== true) throw new Refused(`${item.id}: the L2A offset is not removed; reflectance would be DN/10,000 − 0.1`);
    try {
      const t = traceScene((s2.get("B03.tif") as { bytes: Uint8Array }).bytes, (s2.get("B08.tif") as { bytes: Uint8Array }).bytes, item.properties["proj:epsg"], win.centre, win.sizePx);
      found = { chosen: c, sceneDir: dir, s2, item, t };
      break;
    } catch (e) {
      if (!(e instanceof NoData)) throw e;
      passedOver.push({ scene: c.scene, why: `the trace cannot read it: ${e.message}` });
    }
  }
  if (found === null) throw new Refused(`${spec.name}: every usable candidate holds no-data in the window`);
  const { chosen, sceneDir, s2, item, t } = found;
  const table = [...scored]
    .sort((a, b) => a.sensed.localeCompare(b.sensed) || a.scene.localeCompare(b.scene))
    .map((c) => ({ scene: c.scene, sensed: c.sensed, tileCloudPercent: c.tileCloud, ...c.window, chosen: c.scene === chosen.scene }));
  return {
    win,
    zone,
    t,
    chosen,
    item,
    sceneDir,
    itemSha: (s2.get("item.json") as { sha256: string }).sha256,
    bands: { "B03.tif": (s2.get("B03.tif") as { sha256: string }).sha256, "B08.tif": (s2.get("B08.tif") as { sha256: string }).sha256 },
    table: { considered: scored.length, fromOtherTiles: notOver, passedOver, scenes: table },
  };
}

function main(argv: readonly string[]): number {
  const args = [...argv];
  const at = args.indexOf("--out");
  let out = OUT_DIR;
  if (at >= 0) {
    const dir = args[at + 1];
    if (dir === undefined) {
      console.error("build-reefs: could not run, not a pass: --out needs a directory");
      return 2;
    }
    out = resolve(dir);
    args.splice(at, 2);
  }
  const [rawDir] = args;
  try {
    if (rawDir === undefined) throw new CouldNotRun("usage: node scripts/reef/build-reefs.ts <assets-raw dir> [--out <dir>]");
    const built = build(resolve(rawDir));
    if (built.refusals.length > 0) {
      for (const r of built.refusals) console.error(`build-reefs: refused: ${r}`);
      console.error(`build-reefs: nothing written (${built.refusals.length} island(s) refused). ${built.summary}`);
      return 1;
    }
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, DATA), built.data);
    writeFileSync(join(out, MANIFEST), built.manifest);
    console.log(built.summary);
    return 0;
  } catch (e) {
    if (e instanceof CouldNotRun) {
      console.error(`build-reefs: could not run, not a pass: ${e.message}`);
      return 2;
    }
    if (e instanceof Refused) {
      console.error(`build-reefs: refused: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
