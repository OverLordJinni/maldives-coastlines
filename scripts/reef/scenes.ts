// Which Sentinel-2 scene each island's reef is traced from (RF; PLAN v2.6 "The reefs of every island, traced"): the clearest
// for the island's own window, by the scene classification (SCL, 20 m), with bright ground set aside. And the window
// itself, sized to the island.
//
// **Why by the island's window and not by the tile's cloud.** A tile's cloud cover is the share of 110 km of sea and
// island that is cloud; an island's reef is a few km² of it. Measured 2026-10-20: the scene the home island was traced
// from (2026-04-20, 0.34 % of the tile, the least cloudy of the year) has a cumulus on Kulhudhuffushi's south-east reef,
// and the only scene of the year with no cloud over Kulhudhuffushi's water is 2026-01-10 at 4.30 % of the tile.
//
// **What is counted.** Pixels of the window that SCL calls cloud shadow (3), cloud of medium or high probability (8, 9)
// or thin cirrus (10), **over water only**. A scene with any no-data (0) or saturated (1) pixel in the window cannot be
// used at all (the trace refuses no-data). **Set aside**: those classes on land or within 40 m of the charted coastline
// (two SCL pixels), which is where Sen2Cor's known confusions sit: bright beach sand flagged as cloud (the home scene's
// record: all 32 of its window's cloud pixels lie on the west and north beaches) and bright roofs (Kulhudhuffushi's town
// reads as up to 3,800 cloud pixels in scenes whose true colour shows none). The trace never reads a land pixel (land is
// held above every threshold, build-reef.ts), so cloud there cannot move a traced line; cloud over the water can.
//
// **What it cannot see** (seen 2026-10-20): Sen2Cor called a small cumulus 600 m west of Kumundhoo's reef on 2025-11-11
// water (class 6), so a score of 0 is "no cloud SCL found", not "no cloud". The review figure (D389) is the instrument
// for the rest, and build-reefs.ts flags anything bright at the edge's threshold within 100 m of a traced edge.
//
// **Ties** (several scenes with no cloud over the water) go to the least cloudy tile, the rule the home scene was chosen
// by, then the earlier date, then the id: a total order, so the choice is the same on every run.
//
// Pure: bytes and rings in, numbers out.
import { readTiff, readWindow } from "./tiff.ts";
import { toUtm } from "./utm.ts";
import type { LonLat } from "../../src/rules/chartData.ts";

/** Open sea all round the island: this far beyond its farthest point on either axis, metres (see `islandWindow`). */
export const WINDOW_MARGIN_M = 340;
/** Within this distance of the charted coastline, a cloud flag is taken for bright sand (the header). */
export const SAND_BAND_M = 40;
/** The SCL classes that count as cloud: shadow, medium and high probability, thin cirrus. */
export const CLOUD_CLASSES: Readonly<Record<number, "shadow" | "cloud" | "cirrus">> = { 3: "shadow", 8: "cloud", 9: "cloud", 10: "cirrus" };
/** The SCL classes no window may hold: no data and saturated or defective. */
export const UNUSABLE_CLASSES: readonly number[] = [0, 1];

/** The area centroid of a ring in degrees. Planar on longitude and latitude, which is exact for the equirectangular frame
 * the island is drawn in (a centroid moves with any affine map, and the frame is one). */
export function areaCentroid(ring: readonly LonLat[]): LonLat {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as LonLat;
    const [xj, yj] = ring[j] as LonLat;
    const cross = xj * yi - xi * yj;
    a += cross;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }
  if (a === 0) throw new RangeError("a ring with no area has no centroid");
  return [cx / (3 * a), cy / (3 * a)];
}

export interface IslandWindow {
  /** The window's centre: the island's area centroid. */
  readonly centre: LonLat;
  /** Its side in pixels of `pixelM`: even, so the window is centred as the trace centres it. */
  readonly sizePx: number;
  readonly pixelM: number;
}

/**
 * A square window centred on the island's centroid, reaching `WINDOW_MARGIN_M` beyond its farthest coastline point on
 * either axis.
 *
 * **Why 340 m: it is the home island's own window, generalised.** The window is part of the method, not a frame round it:
 * the trace measures the open sea on its outer 80 m, and the farther out that frame lies, the deeper and darker the sea it
 * reads, the lower the edge's threshold and the wider the reef. Measured on the home's own scene (2026-04-20): its 160 px
 * window gives +2.4 % against OSM's area, a 192 px one +5.2 %. The home's 160 px was REEF2's, judged by the owner, so the
 * rule takes its margin from it: the home's farthest coastline point is 453 m from its centroid, and every margin from 338
 * to 347 m gives it 160 px; 340 m is the round one (tests/scripts/reef/scenes.test.ts holds the home at 160). Rejected:
 * 500 m, the first try (wider than any island's reef needs, and it moved the home's own edge outwards by 3 points of area);
 * a margin tuned per island against OSM (that would make OSM the method, where R75 makes it the check).
 */
export function islandWindow(ring: readonly LonLat[], zone: number, pixelM = 10): IslandWindow {
  const centre = areaCentroid(ring);
  const c = toUtm(centre[0], centre[1], zone);
  let half = 0;
  for (const [lon, lat] of ring) {
    const p = toUtm(lon, lat, zone);
    half = Math.max(half, Math.abs(p.x - c.x), Math.abs(p.y - c.y));
  }
  return { centre, sizePx: 2 * Math.ceil((half + WINDOW_MARGIN_M) / pixelM), pixelM };
}

export interface WindowCloud {
  /** The SCL pixels read. */
  readonly pixels: number;
  /** No-data or saturated pixels: any at all and the scene cannot be used. */
  readonly unusable: number;
  readonly cloud: number;
  readonly shadow: number;
  readonly cirrus: number;
  /** Cloud flags on land or within `SAND_BAND_M` of the coast (the header). */
  readonly setAside: number;
  /** cloud + shadow + cirrus over water: the score, lower is clearer. Null when the scene cannot be used. */
  readonly score: number | null;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/**
 * The cloud over an island's water in one scene's SCL band (`scl`, the whole file's bytes). The SCL window covers the 10 m
 * window exactly: its 20 m pixels from the one holding the 10 m window's first pixel to the one holding its last.
 */
export function windowCloud(scl: Uint8Array, ring: readonly LonLat[], win: IslandWindow, zone: number): WindowCloud {
  const img = readTiff(scl);
  if (img.pixelX !== 20) throw new RangeError(`an SCL band of ${img.pixelX} m pixels, not 20`);
  if (win.pixelM !== 10) throw new RangeError(`a window of ${win.pixelM} m pixels: the SCL is read under the 10 m trace window`);
  const c = toUtm(win.centre[0], win.centre[1], zone);
  // The 10 m window's first pixel, as the trace computes it (build-reef.ts traceScene), on the 10 m grid sharing the
  // tile's origin.
  const x10 = Math.floor((c.x - img.originX) / 10) - win.sizePx / 2;
  const y10 = Math.floor((img.originY - c.y) / 10) - win.sizePx / 2;
  const x0 = Math.floor(x10 / 2);
  const y0 = Math.floor(y10 / 2);
  const w = Math.floor((x10 + win.sizePx - 1) / 2) - x0 + 1;
  const h = Math.floor((y10 + win.sizePx - 1) / 2) - y0 + 1;
  const values = readWindow(scl, img, x0, y0, w, h).values;
  const coast = ring.map(([lon, lat]) => toUtm(lon, lat, zone));
  const onLandOrBeach = (ux: number, uy: number): boolean => {
    let inside = false;
    let near = Infinity;
    for (let i = 0, j = coast.length - 1; i < coast.length; j = i++) {
      const a = coast[i] as { x: number; y: number };
      const b = coast[j] as { x: number; y: number };
      if (a.y > uy !== b.y > uy && ux < ((b.x - a.x) * (uy - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      near = Math.min(near, segmentDistance(ux, uy, a.x, a.y, b.x, b.y));
    }
    return inside || near <= SAND_BAND_M;
  };
  let unusable = 0;
  let cloud = 0;
  let shadow = 0;
  let cirrus = 0;
  let setAside = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = values[y * w + x] as number;
      if (UNUSABLE_CLASSES.includes(v)) {
        unusable++;
        continue;
      }
      const kind = CLOUD_CLASSES[v];
      if (kind === undefined) continue;
      if (onLandOrBeach(img.originX + (x0 + x + 0.5) * 20, img.originY - (y0 + y + 0.5) * 20)) setAside++;
      else if (kind === "cloud") cloud++;
      else if (kind === "shadow") shadow++;
      else cirrus++;
    }
  return { pixels: w * h, unusable, cloud, shadow, cirrus, setAside, score: unusable > 0 ? null : cloud + shadow + cirrus };
}

export interface Candidate {
  readonly scene: string;
  readonly sensed: string;
  readonly tileCloud: number;
  readonly window: WindowCloud;
}

/** The usable candidates, clearest first (the header's order): the order build-reefs.ts tries them in. */
export function byClearness(candidates: readonly Candidate[]): Candidate[] {
  return candidates
    .filter((c) => c.window.score !== null)
    .sort((a, b) => (a.window.score as number) - (b.window.score as number) || a.tileCloud - b.tileCloud || a.sensed.localeCompare(b.sensed) || a.scene.localeCompare(b.scene));
}

/** The clearest usable candidate, or null when none can be used. */
export function clearest(candidates: readonly Candidate[]): Candidate | null {
  return byClearness(candidates)[0] ?? null;
}
