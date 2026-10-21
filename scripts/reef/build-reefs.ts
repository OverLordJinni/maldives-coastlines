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
//      own 160 px window (scenes.ts `islandWindow` says why the window is part of the method); **widened where the reef
//      reaches past it** (RF2, below).
//   4. **Its scene**: of every candidate of its part (reef-islands.ts CANDIDATES), the one with the least cloud over the
//      window's water by the scene classification, bright ground set aside, ties to the least cloudy tile (scenes.ts says
//      why each part). A scene that cannot show the window (no-data in it, or the window off its image) is passed over.
//   5. **The trace**: build-reef.ts `traceScene`, the home's own function with the island's centre and window, so one body
//      traces every reef and the home's byte-for-byte rebuild is its regression test.
//   6. **To the data**: UTM to degrees to the island's true metres, Douglas–Peucker at 5 m true (the home's tolerance),
//      quantised once to 1e-5 degrees (the chart's quantum, D390).
//   7. **Held to OpenStreetMap** where it maps the island's reef (osm-reefs.ts): AC162's area within 10 % (the traced and
//      the mapped reef each less the island's charted area), and AC163's list of bearings, every 5° from the centroid,
//      where the two edges differ by more than 20 m.
//   8. **Flags for the review** (D389, doubtful first): no OSM reef, any cloud SCL found over the window's water, a
//      widened window, something bright at the edge's threshold within 100 m of the traced edge, a reef shared with another
//      island, the charted coast outside the traced crest, a dark open sea.
// And Kulhudhuffushi's **kulhi** (D380, D388), from the earliest clear Landsat scene before the island's works (kulhi.ts
// says how it was found that no Sentinel-2 image will do, which this build re-checks from the kept files every run).
//
// **The widened window (RF2).** The PLAN asks for "the window sized to each island with open sea all round". 340 m beyond
// the coast holds the home's reef and RF1's three, and on RF2's first scenes about a third of the islands' reefs ran on to
// its border, so the edge found no loop round the island and the trace refused (an islet on a wide flat, an island near
// one end of a long reef, an islet whose frame lies on the flat: build-reef.ts `FRAME_SIGMA_MAX`). So when the edge or the
// crest does not close, or the frame is not open sea (`NotClosed`), the window grows by a quarter (`windowSizes`: at least
// 20 px, 100 m a side) and the trace runs again, on the same scene, until it closes or the window would pass
// `MAX_WINDOW_PX`; the first window in that sequence that closes is the one traced, and the record says how far it grew.
// By a quarter, not a fixed step: the platform reefs of Shaviyani and Noonu close only at 5–14 km, and in 100 m steps one
// such island took minutes. Every island that closed before (the home, RF1's three) closes at the first window, so their
// traces, records and RF1's batch id are unchanged and the method keeps its version: the growth only ever reaches islands
// version 1 refused outright.
// What it costs: the farther the frame, the darker the sea it reads and the wider the reef (the home's own +2.4 % at 160 px
// is +5.2 % at 192 px), so a grown window is a flag for the review. Rejected: a larger fixed margin for everyone (it would
// move the home's and RF1's judged traces); growing until the area matches OSM's (that would make OSM the method, where
// R75 makes it the check); trying the next scene when the reef will not close (a reef that runs on is a finding about the
// reef, not the scene, as RF1 held).
//
// **An island that will not trace gets D387's drawn band** (drawn-band.ts, kind "drawn" in reefs.bin), its record keeping
// why: the edge did not close round it in the widest window on the clearest scene that shows it (its reef runs on round
// an atoll's rim), or no candidate shows its window at all. D387 names those two cases ("cloud in every scene of the year,
// or no clear edge"); this build reaches no other, and no traced island ever gets a band.
//
// **AC162 (D392): three outcomes for a gap over 10 %, never a default.** Accepted, where the owner's verdict on the island's
// part covers that very gap for that very batch (reef-islands.ts VERDICTS): recorded as his and shipped. **Awaiting**, where
// the part has no verdict yet (RF2 until he judges its contact sheet): recorded as a disagreement for him to judge, shipped
// in the data that nothing reads until N11, and reported by check:reefs. Refused, where the part has a verdict and it does
// not cover the gap (a rebuild that traces differently after he looked): nothing is written.
//
// **Refusals** (exit 1, nothing written): the crest outside the edge; a gap over 10 % refused as above; a Sentinel-2 scene
// before 2020 that sees Kulhudhuffushi (D388's premise would be wrong); cloud on the kulhi; no enclosed water for it.
// **Could not run** (exit 2): an input directory, file or SHA256SUMS line missing or disagreeing, or a scene the rule
// reaches not fetched (every such scene is named in one run). **No pixel leaves this script** (D269): only outlines and
// numbers.
//
// **Why the band is in the data and not left to the game.** SPEC draft 18.2: an island is landable once "its reef, traced
// or drawn, is in the data", and src/rules/reefData.ts `reefFor` reads an island with none as sighted, never landed. Left
// out of reefs.bin, D387's islands would silently become what D387 turned down. Rejected: recording them untraced only and
// leaving the band to IS's `drawnReef` at N11 (the data would then say "never landed"); a band per island typed by hand.
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
import { AREA_TOLERANCE, BEARINGS, checkedFiles, CouldNotRun, DISAGREE_TRUE_M, EXTRACT_FILE, FRAME_SIGMA_MAX, NoData, NotClosed, rayDistance, Refused, TOLERANCE_TRUE_M, traceScene } from "./build-reef.ts";
import { DRAWN_LATTICE_M, DRAWN_TOLERANCE_TRUE_M, drawnBand } from "./drawn-band.ts";
import { encodeReefs, type IslandReefToWrite, type QPoint } from "./encode-reefs.ts";
import { enclosedWater, KULHI_TOLERANCE_TRUE_M, kulhiLoops, MIN_PX, mndwi, WATER_MNDWI } from "./kulhi.ts";
import { osmReefs, reefOf, type FoundReef } from "./osm-reefs.ts";
import { CANDIDATES, EARLY_DIR, EXTRACT_DIR, labelOf, LANDSAT_CANDIDATES, LANDSAT_DIRS, PARTS, REEF_ISLANDS, SCENE_DIRS, VERDICTS, type CandidateSet, type Part, type ReefIsland, type Verdict } from "./reef-islands.ts";
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
/** The window's growth (the header, "The widened window"): by a quarter a step, and never by less than 20 px (100 m a side). */
export const GROW_FACTOR = 1.25;
export const GROW_STEP_PX = 20;
/**
 * The widest window tried, 20 km. RF2's largest platform reefs close at 15.6 km (Kadinmahuraa) and 15.3 km (Farukolhu).
 * Past them, the only loops left round an island are an atoll's outer rim, a ring round a deep lagoon: Makunudhoo's, which
 * OpenStreetMap maps as one 59 km² reef, does not close within 16.7 km of the island. The game's reef is a flat from the
 * shore to the crest and a slope to the edge (D283, src/scene/reef.ts), so a lagoon inside the "reef" would be drawn as a
 * flat he could wade across; such an island gets D387's band instead. Rejected: no cap (a 40 km window is 16 M pixels a try,
 * and its result is that lagoon).
 */
export const MAX_WINDOW_PX = 2_000;

/** The windows an island's trace is tried in, from the one it begins at: base, then each a quarter wider, even, to the cap. */
export function windowSizes(basePx: number): number[] {
  const out = [basePx];
  for (;;) {
    const last = out[out.length - 1] as number;
    const next = Math.max(last + GROW_STEP_PX, 2 * Math.ceil((last * GROW_FACTOR) / 2));
    if (next > MAX_WINDOW_PX) return out;
    out.push(next);
  }
}

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

/** An island's panel on the review figure: what it was traced from (null where it was not) and every line drawn on it. */
export interface ReviewIsland {
  readonly id: string;
  readonly name: string | null;
  readonly part: Part;
  readonly kind: "traced" | "drawn";
  readonly flags: readonly string[];
  /** The scene the panel is drawn over: the one traced from, or for a drawn island the last one tried; null if none. */
  readonly sceneDir: string | null;
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
  /** Element84's `earthsearch:boa_offset_applied`: false on two of RF2's 149 (reprocessed `_1` items, baseline 05.12). */
  readonly offsetRemoved: boolean;
}

/** Every candidate a part's islands may choose from (reef-islands.ts CANDIDATES), each checked against SHA256SUMS. */
function readCandidates(rawDir: string, set: CandidateSet): { scenes: CandidateScene[]; sums: string } {
  const dir = join(rawDir, set.dir);
  const files = checkedFiles(dir, listed(dir));
  const scenes: CandidateScene[] = [];
  for (const [name, f] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.endsWith(".item.json")) continue;
    const item = s2ItemSchema.parse(JSON.parse(text(f.bytes)));
    const sensed = item.properties.datetime.slice(0, 10);
    if (sensed < set.sensedFrom || sensed > set.sensedTo || item.properties["eo:cloud_cover"] >= set.maxTileCloud) continue;
    const scl = files.get(`${item.id}.SCL.tif`);
    if (scl === undefined) throw new CouldNotRun(`${dir}: ${item.id}'s SCL.tif is not listed in SHA256SUMS`);
    scenes.push({ scene: item.id, sensed, tileCloud: item.properties["eo:cloud_cover"], epsg: item.properties["proj:epsg"], scl: scl.bytes, offsetRemoved: item.properties["earthsearch:boa_offset_applied"] === true });
  }
  return { scenes, sums: sha256(readFileSync(join(dir, "SHA256SUMS"))) };
}

type SceneFiles = Map<string, { bytes: Uint8Array; sha256: string }>;

/**
 * The scenes read whole, each read and checked against its SHA256SUMS once a build, the last two kept. RF2 traces 130
 * islands from a few dozen scenes, 220 MB of B03 and B08 apiece: read per island as RF1's three were, one build would hash
 * about 30 GB; held all at once, about 8 GB of memory. `build` traces the islands grouped by the scene they try first, so
 * two are enough. Rejected: holding every scene (the memory), re-reading per island (the time).
 */
class SceneCache {
  private readonly kept: { dir: string; files: SceneFiles }[] = [];
  private readonly rawDir: string;
  constructor(rawDir: string) {
    this.rawDir = rawDir;
  }

  get(dir: string): SceneFiles {
    const hit = this.kept.find((k) => k.dir === dir);
    if (hit !== undefined) return hit.files;
    const files = checkedFiles(join(this.rawDir, dir), ["B03.tif", "B08.tif", "SCL.tif", "item.json"]);
    this.kept.unshift({ dir, files });
    this.kept.length = Math.min(this.kept.length, 2);
    return files;
  }
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

/**
 * A part's batch id (D389, D392): the extract, the part's islands with the scene each was traced from ("untraced" where
 * none), in the list's order, and the method. The owner's verdict on a part names it (reef-islands.ts VERDICTS), so it
 * moves whenever anything he saw would. RF1's is the id its three islands had as the whole file, before RF2 joined.
 */
export function batchId(extractSha256: string, entries: readonly string[]): string {
  return `osm-${extractSha256.slice(0, 8)}.s2-${sha256(entries.join(",")).slice(0, 8)}.m${REEFS_METHOD_VERSION}`;
}
/** One part's entry in its batch id: the island and its scene, or "untraced". */
export const batchEntry = (id: string, scene: string | null): string => `${id}:${scene ?? "untraced"}`;

/** AC162 for one island's gap over 10 % (the header): three outcomes, each recorded. */
type GapOutcome = { readonly kind: "accepted"; readonly verdict: Verdict } | { readonly kind: "awaiting" } | { readonly kind: "refused"; readonly why: string };

export function gapOutcome(part: Part, partBatchId: string, id: string, offPercent: number, verdicts: readonly Verdict[] = VERDICTS): GapOutcome {
  const v = verdicts.find((x) => x.part === part);
  if (v === undefined) return { kind: "awaiting" };
  if (v.reefsId !== partBatchId) return { kind: "refused", why: `${v.decision} judged ${part}'s batch ${v.reefsId}, not this one (${partBatchId})` };
  const seen = v.acceptsAreaGap[id];
  if (seen === undefined) return { kind: "refused", why: `${v.decision} does not accept this island's gap` };
  if (Math.abs(seen - offPercent) >= 0.005) return { kind: "refused", why: `${v.decision} accepted ${seen} %, not this` };
  return { kind: "accepted", verdict: v };
}

export function build(rawDir: string, repo: string = REPO): Built {
  const osm = checkedFiles(join(rawDir, EXTRACT_DIR), [EXTRACT_FILE]);
  const pbf = osm.get(EXTRACT_FILE) as { bytes: Uint8Array; sha256: string };
  for (const p of [CHART_FILE, CHART_MANIFEST]) if (!existsSync(join(repo, p))) throw new CouldNotRun(`${join(repo, p)}: missing (the islands' outlines are the shipped chart's)`);
  const chartBytes = new Uint8Array(readFileSync(join(repo, CHART_FILE)));
  const chart = decodeChart(chartBytes);
  const parts = PARTS.filter((p) => REEF_ISLANDS.some((s) => s.part === p));
  const candidates = new Map(parts.map((p) => [p, readCandidates(rawDir, CANDIDATES[p])]));
  const reefRings = osmReefs(pbf.bytes);

  // 1. Each island's window and its candidates in the order the rule tries them (cheap: scene classifications only).
  const plans = REEF_ISLANDS.map((spec) => {
    const island = chart.islands.find((i) => i.id === spec.id);
    if (island === undefined) throw new Refused(`${labelOf(spec)} (${spec.id}) is not an island in chart ${chart.id}`);
    const cands = (candidates.get(spec.part) as { scenes: CandidateScene[] }).scenes;
    return { spec, island, candidates: cands, ...scoreIsland(island.ring as readonly LonLat[], cands) };
  });
  // 2. The traces, grouped by the scene each island tries first so SceneCache reads each scene about once; each island's
  // outcome depends only on its own inputs, so the order changes nothing written.
  const cache = new SceneCache(rawDir);
  const outcomes = new Map<string, TraceOutcome>();
  const byScene = plans.map((p, i) => ({ p, i })).sort((a, b) => (a.p.order[0]?.scene ?? "").localeCompare(b.p.order[0]?.scene ?? "") || a.i - b.i);
  for (const { p } of byScene) outcomes.set(p.spec.id, traceIsland(p, cache));
  const missing = new Map<string, string[]>();
  for (const p of plans) {
    const o = outcomes.get(p.spec.id) as TraceOutcome;
    if (o.kind === "waiting") missing.set(o.scene, [...(missing.get(o.scene) ?? []), labelOf(p.spec)]);
  }
  if (missing.size > 0)
    throw new CouldNotRun(
      `${missing.size} scene(s) the rule reaches are not fetched: fetch each whole into assets-raw and list it in reef-islands.ts SCENE_DIRS: ${[...missing]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([scene, who]) => `${scene} (${who.join(", ")})`)
        .join("; ")}`,
    );

  // 3. The records, in the list's order.
  const islands: IslandReefToWrite[] = [];
  const records: unknown[] = [];
  const review: ReviewIsland[] = [];
  const years = new Set<string>();
  const refusals: string[] = [];
  const gaps: { id: string; part: Part; name: string; offPercent: number; why: string; flags: string[]; area: { judged: unknown; awaitingVerdict?: unknown } }[] = [];
  let landsatPlatform: string | null = null;
  const entries = new Map<Part, string[]>(parts.map((p) => [p, []]));
  for (const { spec, island, win } of plans) {
    const coast = island.ring as readonly LonLat[];
    const o = outcomes.get(spec.id) as Exclude<TraceOutcome, { kind: "waiting" }>;
    const frame = frameAt({ lon0: win.centre[0], lat0: win.centre[1], scale: ISLAND_SOURCE.scale });
    const transform = {
      what: "the island's own (PLAN v2.6): equirectangular round the area centroid of its shipped chart outline, north to -z, at the home scale (scripts/reef/transform.ts frameAt)",
      lon0: frame.origin.lon0,
      lat0: frame.origin.lat0,
      metresPerDegLon: `${METRES_PER_DEG_LON_AT_EQUATOR} × cos(lat0)`,
      metresPerDegLat: METRES_PER_DEG_LAT,
      scale: frame.origin.scale,
    };
    const windowRule = `square on the centroid, ${WINDOW_MARGIN_M} m beyond the outline's farthest point on either axis, the home island's own 160 px window generalised (scripts/reef/scenes.ts islandWindow)`;
    const found: FoundReef | null = reefOf(island, reefRings, chart.islands);
    const islandArea = areaM2(coast);
    if (o.kind === "untraced") {
      // D387: the one exception. Not traced, so the band round its own outline stands in, in the data, and the island
      // stays landable; its record keeps why it would not trace (the header).
      (entries.get(spec.part) as string[]).push(batchEntry(spec.id, null));
      const band = drawnBand(coast);
      const flags = [`not traced, a drawn band (D387): ${o.reason}`];
      if (found === null) flags.push("no OSM reef: nothing to show beside the image");
      islands.push({ id: spec.id, kind: "drawn", edge: band.edge, crest: band.crest, marsh: [] });
      const edge = degrees(band.edge);
      const crest = degrees(band.crest);
      records.push({
        id: spec.id,
        name: spec.name,
        part: spec.part,
        atoll: island.atoll,
        kind: "drawn",
        transform,
        window: { rule: windowRule, sizePx: win.sizePx, pixelM: 10, widestTriedPx: o.last?.sizePx ?? null },
        untraced: { reason: o.reason, lastScene: o.last === null ? null : { scene: o.last.scene, dir: `projects/kaabafain/assets-raw/${o.last.dir} (PROVENANCE.md)` } },
        drawn: {
          rule: "D387: an island whose reef cannot be traced gets a drawn reef band round its outline and stays landable. The coast offset outwards, the crest and the edge at IS's drawn band's widths (src/rules/islandTuning.ts drawnReef, the home reef's medians) at the home scale; not traced, so not held to AC162's 10 % (draft 18.2)",
          code: "scripts/reef/drawn-band.ts",
          crestM: round(band.crestM, 2),
          edgeM: round(band.edgeM, 2),
          latticeM: DRAWN_LATTICE_M,
          simplificationM: round(DRAWN_TOLERANCE_TRUE_M, 3),
        },
        choice: { rule: CHOICE_RULE, candidates: o.table },
        osm: found === null ? null : osmRecordOf(found, islandArea),
        result: {
          points: { edge: band.edge.length, crest: band.crest.length, marsh: [] },
          reefAreaM2: { drawn: Math.round(areaM2(edge) - islandArea), osm: found === null ? null : Math.round(found.reef.areaM2 - islandArea), heldToAC162: false },
        },
        flags,
      });
      review.push({ id: spec.id, name: spec.name, part: spec.part, kind: "drawn", flags, sceneDir: o.last?.dir ?? null, window: { ...win, sizePx: o.last?.sizePx ?? win.sizePx, x0: o.last?.x0 ?? 0, y0: o.last?.y0 ?? 0 }, coast, edge, crest, osm: found === null ? null : found.reef.outer, disagree: [], others: [], kulhi: null });
      continue;
    }
    const toTrueUtm = (p: Scene): Scene => {
      const ll = fromUtm(p[0], p[1], o.zone);
      return frame.toTrue(ll.lon, ll.lat);
    };
    const name = labelOf(spec);
    const edgeQ = quantise(simplify(o.t.edgeUtm.map(toTrueUtm) as Px[], TOLERANCE_TRUE_M) as Scene[], frame, `${name}'s edge`);
    const crestQ = quantise(simplify(o.t.crestUtm.map(toTrueUtm) as Px[], TOLERANCE_TRUE_M) as Scene[], frame, `${name}'s crest`);
    const edge = degrees(edgeQ);
    const crest = degrees(crestQ);
    if (!crest.every((p) => inRing(p, edge))) throw new Refused(`${name}: the traced crest crosses the traced edge`);
    const tracedReef = areaM2(edge) - islandArea;
    const edgeTrue = edge.map(([lon, lat]) => frame.toTrue(lon, lat));
    const flags: string[] = [];
    let osmRecord: unknown = null;
    let off: number | null = null;
    // The record's AC162 line, filled once the batch is known (the judgement, if the owner gave one for this batch).
    const area: { traced: number; osm: number | null; offPercent: number | null; tolerancePercent: number; judged: unknown; awaitingVerdict?: unknown } = { traced: 0, osm: null, offPercent: null, tolerancePercent: AREA_TOLERANCE * 100, judged: null };
    let disagree: { deg: number; tracedM: number; osmM: number }[] = [];
    if (found === null) flags.push("no OSM reef: the trace stands alone");
    else {
      const osmReef = found.reef.areaM2 - islandArea;
      off = tracedReef / osmReef - 1;
      // AC162: settled after every island is traced (below), because whether the owner has accepted the gap depends on the
      // part's batch id, which names every island's scene.
      if (Math.abs(off) > AREA_TOLERANCE) gaps.push({ id: spec.id, part: spec.part, name, offPercent: round(off * 100, 2), why: `the traced reef's area ${Math.round(tracedReef)} m² is ${(off * 100).toFixed(1)} % from OSM's ${Math.round(osmReef)} m² (AC162 allows ${AREA_TOLERANCE * 100} %)`, flags, area });
      const osmTrue = found.reef.outer.map(([lon, lat]) => frame.toTrue(lon, lat));
      const all: { deg: number; tracedM: number; osmM: number }[] = [];
      for (let b = 0; b < BEARINGS; b++) {
        const theta = (b / BEARINGS) * Math.PI * 2;
        const s = rayDistance(edgeTrue, theta);
        const r = rayDistance(osmTrue, theta);
        if (s === null || r === null) throw new Refused(`${name}: no edge on bearing ${b * (360 / BEARINGS)}°`);
        all.push({ deg: b * (360 / BEARINGS), tracedM: Math.round(s), osmM: Math.round(r) });
      }
      disagree = all.filter((r) => Math.abs(r.tracedM - r.osmM) > DISAGREE_TRUE_M);
      if (found.sharedWith.length > 0) flags.push(`a shared reef: OSM's reef also holds ${found.sharedWith.join(", ")}`);
      osmRecord = osmRecordOf(found, islandArea);
    }
    if (o.t.sea.median < DARK_SEA) flags.push(`a dark open sea: median ${o.t.sea.median.toFixed(4)} in B03, under ${DARK_SEA} (the atmospheric correction may have taken most of the water's light, which lowers the edge's threshold and widens the reef)`);
    const cloudOverWater = o.chosen.window.score ?? 0;
    if (cloudOverWater > 0) flags.push(`cloud over the window's water: ${cloudOverWater} SCL pixels`);
    if (o.grownFromPx !== null) flags.push(`a widened window: the reef reached past ${o.grownFromPx} px, so it was traced in ${o.t.window.size} px (a farther frame reads darker sea and a wider reef)`);
    const others = o.t.others.map((l) => l.map(toTrueUtm));
    const near = others.map((l) => ({ m: nearest(l, edgeTrue), areaM2: ringAreaTrue(l), loop: l })).filter((x) => x.m <= NEAR_EDGE_M);
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
    years.add(o.item.properties.datetime.slice(0, 4));
    (entries.get(spec.part) as string[]).push(batchEntry(spec.id, o.item.id));
    islands.push({ id: spec.id, kind: "traced", edge: edgeQ, crest: crestQ, marsh });
    records.push({
      id: spec.id,
      name: spec.name,
      part: spec.part,
      atoll: island.atoll,
      kind: "traced",
      transform,
      window: { rule: windowRule, sizePx: o.t.window.size, pixelM: 10, x0: o.t.window.x0, y0: o.t.window.y0, ...(o.grownFromPx === null ? {} : { grownFromPx: o.grownFromPx, grownBy: `a quarter a step (at least ${GROW_STEP_PX} px) until the edge and the crest close round the island with open sea in the frame, at most ${MAX_WINDOW_PX} px (scripts/reef/build-reefs.ts windowSizes)` }) },
      sentinel2: {
        scene: o.item.id,
        product: o.item.properties["s2:product_uri"],
        sensed: o.item.properties.datetime,
        sceneCloudCover: o.item.properties["eo:cloud_cover"],
        stac: `https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${o.item.id}`,
        dir: `projects/kaabafain/assets-raw/${o.sceneDir} (PROVENANCE.md)`,
        bands: o.bands,
        item: o.itemSha,
        utmZone: o.zone,
      },
      choice: { rule: CHOICE_RULE, candidates: o.table },
      osm: osmRecord,
      method: {
        openSea: { framePx: 8, median: round(o.t.sea.median, 5), robustSigma: round(o.t.sea.sigma, 5) },
        edge: { threshold: round(o.t.edgeThreshold, 5) },
        crest: { threshold: round(o.t.crestThreshold, 5) },
      },
      result: {
        points: { edge: edgeQ.length, crest: crestQ.length, marsh: marsh.map((m) => m.length) },
        reefAreaM2: Object.assign(area, { traced: Math.round(tracedReef), osm: found === null ? null : Math.round(found.reef.areaM2 - islandArea), offPercent: off === null ? null : round(off * 100, 2) }),
        bearings: { count: BEARINGS, from: "the island's centroid, degrees from east towards south", disagreeOverM: DISAGREE_TRUE_M, disagree },
        brightNearEdge: near.map((x) => ({ nearestM: Math.round(x.m), areaM2: Math.round(x.areaM2) })),
        coastOutsideCrest: coastOutside,
      },
      flags,
      ...(kulhiRecord === undefined ? {} : { kulhi: kulhiRecord }),
    });
    review.push({
      id: spec.id,
      name: spec.name,
      part: spec.part,
      kind: "traced",
      flags,
      sceneDir: o.sceneDir,
      window: { ...win, sizePx: o.t.window.size, x0: o.t.window.x0, y0: o.t.window.y0 },
      coast,
      edge,
      crest,
      osm: found === null ? null : found.reef.outer,
      disagree,
      others: near.map((x) => x.loop.map(([a, b]) => frame.fromTrue(a, b))),
      kulhi: kulhiReview,
    });
  }
  const batchIds = new Map(parts.map((p) => [p, batchId(pbf.sha256, entries.get(p) as string[])]));
  const id = parts.map((p) => batchIds.get(p) as string).join("+");
  // AC162 (D392), three outcomes (the header): accepted where the part's verdict covers this very gap, awaiting where the
  // part has no verdict yet, refused otherwise. Refusals are recorded rather than thrown so the review figure can still
  // show what was traced; nothing is written while any island is refused (`main`).
  const counted = { accepted: 0, awaiting: 0 };
  for (const g of gaps) {
    const out = gapOutcome(g.part, batchIds.get(g.part) as string, g.id, g.offPercent);
    if (out.kind === "accepted") {
      counted.accepted++;
      g.area.judged = { decision: out.verdict.decision, date: out.verdict.date, offPercentSeen: g.offPercent, by: "the owner" };
      g.flags.push(`OSM's reef differs by more than AC162's 10 %, accepted by the owner (${out.verdict.decision}, ${out.verdict.date}): ${g.why}`);
    } else if (out.kind === "awaiting") {
      counted.awaiting++;
      g.area.awaitingVerdict = { batch: g.part, of: batchIds.get(g.part), rule: "D392: a gap over 10 % is a recorded disagreement the owner judges on his part's contact sheet (D389, D394), not a refusal; refused once his verdict on this part does not cover it" };
      g.flags.push(`OSM's reef differs by more than AC162's 10 %, for the owner's verdict on ${g.part}'s contact sheet (D392): ${g.why}`);
    } else {
      refusals.push(`${g.name}: ${g.why}; ${out.why}`);
      g.flags.push(`refused by AC162: ${g.why}; ${out.why}`);
    }
  }
  const data = encodeReefs({ id, islands });
  const base64 = 4 * Math.ceil(data.length / 3);
  const yearList = [...years].sort();
  const copernicus = `Contains modified Copernicus Sentinel data ${yearList.join(" and ")}`;
  const listIndex = (id: string): number => REEF_ISLANDS.findIndex((s) => s.id === id);
  // D389: the doubtful first, as the owner asked to judge them (RF2's brief: "over 10 % from OSM, low coverage, or a drawn
  // band"). A key, so the order says why: a drawn band before any trace; then a gap over 10 % from OSM's area, the largest
  // first; then cloud SCL over the window's water ("low coverage"), the most first; then no OSM reef to hold it to; then
  // the rest. Rejected: RF1's "most flags first" (with 130 islands a count of flags ranks a shared reef above a gap of 1,600
  // %); RF1's three come out in the same order either way (Kandoodhoo, Kumundhoo, Kulhudhuffushi).
  const doubt = (r: ReviewIsland): number => {
    if (r.kind === "drawn") return 4e9;
    const rec = (records as { id: string; result: { reefAreaM2: { offPercent?: number | null } } }[]).find((x) => x.id === r.id);
    const off = Math.abs(rec?.result.reefAreaM2.offPercent ?? 0);
    if (off > AREA_TOLERANCE * 100) return 3e9 + Math.round(off * 100);
    const o = outcomes.get(r.id);
    const cloud = o?.kind === "traced" ? (o.chosen.window.score ?? 0) : 0;
    if (cloud > 0) return 2e9 + cloud;
    return r.osm === null ? 1e9 : 0;
  };
  const batches = parts.map((part) => {
    const mine = review.filter((r) => r.part === part);
    const v = VERDICTS.find((x) => x.part === part && x.reefsId === batchIds.get(part)) ?? null;
    return {
      part,
      id: batchIds.get(part),
      islands: mine.length,
      traced: mine.filter((r) => r.kind === "traced").length,
      drawn: mine.filter((r) => r.kind === "drawn").length,
      order: [...mine].sort((a, b) => doubt(b) - doubt(a) || listIndex(a.id) - listIndex(b.id)).map((r) => r.id),
      verdict: v === null ? null : { by: "the owner", decision: v.decision, date: v.date, verdict: v.verdict, seenOn: v.seenOn },
    };
  });
  const manifest = {
    why: "The record of the traced reefs of the islands he can land on (R75 as draft 18.1 extends it, AC162, AC163, AC165; D375, D380, D387, D388, D392). Written by scripts/reef/build-reefs.ts; scripts/check-reefs.ts holds reefs.bin to it. Never imported by the app. The home island's reef is not here: src/assets/reef/reef.json and reef-manifest.json. An island whose reef would not trace has D387's drawn band instead (kind drawn), and its record says why.",
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
      candidates: Object.fromEntries(
        parts.map((p) => {
          const set = CANDIDATES[p];
          const c = candidates.get(p) as { scenes: CandidateScene[]; sums: string };
          return [p, { dir: `projects/kaabafain/assets-raw/${set.dir} (PROVENANCE.md)`, sensedFrom: set.sensedFrom, sensedTo: set.sensedTo, maxTileCloudPercent: set.maxTileCloud, scenes: c.scenes.length, sums: c.sums }];
        }),
      ),
    },
    method: {
      version: REEFS_METHOD_VERSION,
      code: "scripts/reef/build-reefs.ts (the steps and why), scripts/reef/build-reef.ts traceScene (the home's trace, one body for every island), scripts/reef/trace.ts (the method and why), scripts/reef/scenes.ts, scripts/reef/osm-reefs.ts, scripts/reef/kulhi.ts, scripts/reef/transform.ts, scripts/reef/tiff.ts, scripts/reef/utm.ts, scripts/reef/encode-reefs.ts",
      window: `${WINDOW_MARGIN_M} m beyond the island's farthest coastline point; where the edge or the crest does not close in it, or its frame is not open sea (robust sigma over ${FRAME_SIGMA_MAX} in B03), widened by a quarter (at least ${GROW_STEP_PX} px) at a time on the same scene up to ${MAX_WINDOW_PX} px, the first that closes traced`,
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
      rule: "D389: the owner judges each part on its own contact sheet on the Mac, the doubtful first: drawn bands, then gaps over 10 % from OSM's area (largest first), then cloud over the window's water (most first), then no OSM reef, then the list's order; AC163's verdict is recorded with the part's batch (D394: the sheet's verdict is enough)",
      batches,
    },
    islands: records,
  };
  const recs = records as { kind: string; result?: { reefAreaM2: { offPercent: number | null } } }[];
  const traced = recs.filter((r) => r.kind === "traced");
  const over = traced.filter((r) => r.result !== undefined && r.result.reefAreaM2.offPercent !== null && Math.abs(r.result.reefAreaM2.offPercent) > AREA_TOLERANCE * 100).length;
  const drawnNames = review.filter((r) => r.kind === "drawn").map((r) => labelOf(r));
  const summary = `reefs ${id}: ${traced.length} traced and ${drawnNames.length} drawn of ${records.length} (${batches.map((b) => `${b.part} ${b.traced} of ${b.islands}`).join(", ")}), ${data.length.toLocaleString("en")} bytes (${base64.toLocaleString("en")} as base64, ${((100 * base64) / REEFS_BUDGET_BYTES).toFixed(1)} % of ${REEFS_BUDGET_BYTES.toLocaleString("en")}); ${over} over AC162's 10 % of OSM (${counted.accepted} accepted, ${counted.awaiting} for the owner's verdict, ${refusals.length} refused); drawn (D387): ${drawnNames.length === 0 ? "none" : drawnNames.join(", ")}`;
  return { refusals, data, manifest: `${JSON.stringify(manifest, null, 2)}\n`, summary, review };
}

const CHOICE_RULE = "the least cloud over the window's water by SCL (shadow, cloud, cirrus), cloud flags on land or within 40 m of the coast set aside as bright ground; no-data rules a scene out; ties to the least cloudy tile, then the earlier date (scripts/reef/scenes.ts)";

/** OSM's reef as an island's record holds it. */
function osmRecordOf(found: FoundReef, islandArea: number) {
  return {
    element: found.reef.element,
    tags: found.reef.tags,
    outerWays: found.reef.outerWays,
    innerWays: found.reef.innerWays,
    outerPoints: found.reef.outer.length,
    // The outer ring itself (ODbL, credited as the coastlines are): what the review and the check hold the trace to where
    // the extract is absent.
    outer: found.reef.outer.map((p) => [p[0], p[1]]),
    areaM2: { outer: Math.round(found.reef.areaM2), island: Math.round(islandArea), reef: Math.round(found.reef.areaM2 - islandArea) },
    areaMethod: "scripts/chart/geometry.ts areaM2 on the outer ring, less the island's charted outline (the same subtraction from the traced edge)",
    sharedWith: found.sharedWith,
  };
}

/** Step 3 for one island: its window, and every candidate scored and put in the order the rule tries them. */
function scoreIsland(coast: readonly LonLat[], candidates: readonly CandidateScene[]) {
  const zones = new Set(candidates.map((c) => c.epsg));
  if (zones.size !== 1) throw new Refused(`the candidates span ${zones.size} UTM zones; this build reads one`);
  const zone = (candidates[0]?.epsg ?? 0) - 32600;
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
  return { zone, win, scored, notOver, order: byClearness(scored) };
}

type Plan = { readonly spec: ReefIsland; readonly candidates: readonly CandidateScene[] } & ReturnType<typeof scoreIsland>;
type CandidateTable = { considered: number; fromOtherTiles: number; passedOver: { scene: string; why: string }[]; scenes: unknown[] };
type TraceOutcome =
  | {
      readonly kind: "traced";
      readonly zone: number;
      readonly t: ReturnType<typeof traceScene>;
      readonly chosen: Candidate;
      readonly item: z.infer<typeof s2ItemSchema>;
      readonly sceneDir: string;
      readonly itemSha: string;
      readonly bands: Readonly<Record<string, string>>;
      readonly table: CandidateTable;
      /** The window it began at, where the reef needed a wider one (the header); null where the first closed. */
      readonly grownFromPx: number | null;
    }
  | { readonly kind: "untraced"; readonly reason: string; readonly last: { scene: string; dir: string; sizePx: number; x0: number; y0: number } | null; readonly table: CandidateTable }
  /** The rule reached a scene that is not fetched: the build names it and stops (could not run). */
  | { readonly kind: "waiting"; readonly scene: string };

/** Steps 4–5 for one island: its scene by rule, and the trace, widening the window where the reef runs past it. */
function traceIsland(plan: Plan, cache: SceneCache): TraceOutcome {
  const { win, zone, scored, notOver, order } = plan;
  const passedOver: { scene: string; why: string }[] = [];
  const tableOf = (chosen: string | null): CandidateTable => ({
    considered: scored.length,
    fromOtherTiles: notOver,
    passedOver,
    scenes: [...scored].sort((a, b) => a.sensed.localeCompare(b.sensed) || a.scene.localeCompare(b.scene)).map((c) => ({ scene: c.scene, sensed: c.sensed, tileCloudPercent: c.tileCloud, ...c.window, chosen: c.scene === chosen })),
  });
  let last: { scene: string; dir: string; sizePx: number; x0: number; y0: number } | null = null;
  // Clearest first; a scene the trace cannot read (no data in the window, or the window off its image: NoData) is passed
  // over for the next, and the record says so. Only that: a reef that will not close is a finding about the reef, not
  // the scene (the header).
  const offsetOf = new Map(plan.candidates.map((c) => [c.scene, c.offsetRemoved]));
  for (const c of order) {
    // The trace reads reflectance as DN / 10,000, which holds only once Element84 has removed L2A's +1,000 offset. A scene
    // that still carries it is one this method cannot read, known from its catalogue item before any band is fetched, so it
    // is passed over as a no-data window is. Rejected: subtracting the offset here (a second reading of DN in one method).
    if (offsetOf.get(c.scene) !== true) {
      passedOver.push({ scene: c.scene, why: "its L2A offset is not removed (earthsearch:boa_offset_applied is not true): the trace reads reflectance as DN / 10,000" });
      continue;
    }
    const dir = SCENE_DIRS[c.scene];
    if (dir === undefined) return { kind: "waiting", scene: c.scene };
    const s2 = cache.get(dir);
    const item = s2ItemSchema.parse(JSON.parse(text((s2.get("item.json") as { bytes: Uint8Array }).bytes)));
    if (item.id !== c.scene) throw new CouldNotRun(`${dir}/item.json is ${item.id}, not ${c.scene}`);
    if (item.properties["earthsearch:boa_offset_applied"] !== true) throw new Refused(`${item.id}: the L2A offset is not removed; reflectance would be DN/10,000 − 0.1`);
    const green = (s2.get("B03.tif") as { bytes: Uint8Array }).bytes;
    const nir = (s2.get("B08.tif") as { bytes: Uint8Array }).bytes;
    const sizes = windowSizes(win.sizePx);
    for (const size of sizes) {
      try {
        const t = traceScene(green, nir, item.properties["proj:epsg"], win.centre, size);
        return {
          kind: "traced",
          zone,
          t,
          chosen: c,
          item,
          sceneDir: dir,
          itemSha: (s2.get("item.json") as { sha256: string }).sha256,
          bands: { "B03.tif": (s2.get("B03.tif") as { sha256: string }).sha256, "B08.tif": (s2.get("B08.tif") as { sha256: string }).sha256 },
          table: tableOf(c.scene),
          grownFromPx: size === win.sizePx ? null : win.sizePx,
        };
      } catch (e) {
        if (e instanceof NoData) {
          passedOver.push({ scene: c.scene, why: size === win.sizePx ? `the trace cannot read it: ${e.message}` : `the trace cannot read it at ${size} px, widened for the reef: ${e.message}` });
          break;
        }
        if (!(e instanceof NotClosed)) throw e;
        const g = readTiff(green);
        const at = toUtm(win.centre[0], win.centre[1], zone);
        last = { scene: c.scene, dir, sizePx: size, x0: Math.floor((at.x - g.originX) / 10) - size / 2, y0: Math.floor((g.originY - at.y) / 10) - size / 2 };
        if (size === sizes[sizes.length - 1])
          return { kind: "untraced", reason: `${e.message}, in every window from ${win.sizePx} px to ${size} px (${(size / 100).toFixed(1)} km) on ${c.scene}, the clearest scene that shows it`, last, table: tableOf(null) };
      }
    }
  }
  return { kind: "untraced", reason: `no candidate shows its window: ${passedOver.length} passed over (no-data or the window off the image), ${scored.length - order.length} with no-data in the scene classification`, last, table: tableOf(null) };
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
