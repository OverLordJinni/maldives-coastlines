// D387's drawn reef band, for an island whose reef cannot be traced (RF2): "gets a drawn reef band round its outline and
// stays landable", recorded per island as drawn, not traced. SPEC draft 18.2 makes "landable" depend on the reef being "in
// the data, traced or drawn", so the band is written into reefs.bin like a trace (kind 1 in src/rules/reefData.ts), and
// AC162 asks the check to hold "that a reef marked drawn is the band drawn round that island's outline, not a trace", so
// scripts/check-reefs.ts recomputes it with this function and compares the shipped rings point for point.
//
// **The band** is the island's own coast offset outwards, the crest at `DRAWN_CREST_SCENE_M` and the edge at
// `DRAWN_EDGE_SCENE_M` scene metres: the widths IS chose for the drawn band at the home reef's medians (src/rules/
// islandTuning.ts `drawnReef`: crest 14 m, edge 30 m; docs/geo/islands.md, "the traced home reef on 240 bearings: crest
// 10.6–17.3 m, edge 20.3–52.8 m"), at the home scale, so 81.4 m and 174.4 m true. Here as numbers of their own because this
// file goes public (D294) and islandTuning.ts is game code (D257); tests/scripts/reef/drawnBand.test.ts, which stays in the
// game repository, holds them equal to IS's and the band to IS's own `drawnReef` within a metre, so the two cannot drift.
//
// **How**: in the island's own frame (true metres, transform.ts `frameAt` on its area centroid, as its trace would be), the
// signed distance from the coast on a `DRAWN_LATTICE_M` lattice (exact distance to the nearest coast segment; negative
// inside, by trace.ts's even–odd rule), its level lines by marching squares (trace.ts `contours`), the outermost loop at
// each level, Douglas–Peucker at `DRAWN_TOLERANCE_TRUE_M` (IS's 0.25 scene m), quantised to 1e-5 degrees. Deterministic.
// Rejected: an analytic offset of the polygon (round joins and self-intersections at every concave corner, for a band
// nobody will see closer than a metre); a fixed ring round the centroid (a band "round its outline", D387, follows it).
//
// Pure: a ring in, rings out.
import type { LonLat } from "../../src/rules/chartData.ts";
import { ISLAND_SOURCE } from "../../src/rules/islandSource.ts";
import { areaCentroid } from "./scenes.ts";
import { contours, ringArea, simplify, type Px } from "./trace.ts";
import { frameAt, type Frame, type Scene } from "./transform.ts";

/** IS's drawn band's widths off the coast, scene metres at the home scale (islandTuning.ts `drawnReef`; the header). */
export const DRAWN_CREST_SCENE_M = 14;
export const DRAWN_EDGE_SCENE_M = 30;
/** The lattice the distance is taken on, true metres: a fifth of the trace's 10 m pixel. */
export const DRAWN_LATTICE_M = 2;
/** Douglas–Peucker tolerance, true metres: IS's 0.25 scene metres at the home scale. */
export const DRAWN_TOLERANCE_TRUE_M = 0.25 / ISLAND_SOURCE.scale;

/** A quantised point: [lon, lat] × 1e5, as encode-reefs.ts writes it. */
type Q = readonly [number, number];

function segmentDistance(p: Scene, a: Scene, b: Scene): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
}

/** The island's own frame, the one its trace would use: its outline's area centroid, at the home scale. */
export const frameOf = (ring: readonly LonLat[]): Frame => {
  const [lon0, lat0] = areaCentroid(ring);
  return frameAt({ lon0, lat0, scale: ISLAND_SOURCE.scale });
};

/**
 * The band's level lines `levelsM` true metres off the coast, as open rings in the frame's true metres, simplified. The
 * distance is exact where it matters: each coast segment updates only the lattice nodes within reach of the outermost
 * level (plus two nodes); a node no segment reaches is past every level, so it keeps ±Infinity, which no contour can cross
 * differently from the true distance.
 */
function levelLines(coast: readonly Scene[], levelsM: readonly number[]): Scene[][] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of coast) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const h = DRAWN_LATTICE_M;
  const reach = Math.max(...levelsM) + 2 * h;
  const pad = reach + 2 * h;
  const x0 = minX - pad;
  const z0 = minZ - pad;
  const w = Math.ceil((maxX - minX + 2 * pad) / h) + 1;
  const ht = Math.ceil((maxZ - minZ + 2 * pad) / h) + 1;
  const dist = new Float64Array(w * ht).fill(Infinity);
  for (let a = 0, b = coast.length - 1; a < coast.length; b = a++) {
    const p = coast[b] as Scene;
    const q = coast[a] as Scene;
    const i0 = Math.max(0, Math.floor((Math.min(p[0], q[0]) - reach - x0) / h));
    const i1 = Math.min(w - 1, Math.ceil((Math.max(p[0], q[0]) + reach - x0) / h));
    const j0 = Math.max(0, Math.floor((Math.min(p[1], q[1]) - reach - z0) / h));
    const j1 = Math.min(ht - 1, Math.ceil((Math.max(p[1], q[1]) + reach - z0) / h));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = segmentDistance([x0 + i * h, z0 + j * h], p, q);
        if (d < (dist[j * w + i] as number)) dist[j * w + i] = d;
      }
  }
  // The field contours() reads: inside (≥ level) is on the island or within the level of its coast, so +distance inside
  // and −distance outside; the sign by trace.ts `inside`'s even–odd test, a row at a time.
  const field = new Float64Array(w * ht);
  const xs: number[] = [];
  for (let j = 0; j < ht; j++) {
    const z = z0 + j * h;
    xs.length = 0;
    for (let a = 0, b = coast.length - 1; a < coast.length; b = a++) {
      const [xa, za] = coast[a] as Scene;
      const [xb, zb] = coast[b] as Scene;
      if (za > z !== zb > z) xs.push(((xb - xa) * (z - za)) / (zb - za) + xa);
    }
    for (let i = 0; i < w; i++) {
      const x = x0 + i * h;
      let crossings = 0;
      for (const c of xs) if (x < c) crossings++;
      const d = dist[j * w + i] as number;
      field[j * w + i] = crossings % 2 === 1 ? d : -d;
    }
  }
  return levelsM.map((levelM) => {
    let best: Px[] | null = null;
    for (const l of contours(field, w, ht, -levelM)) if (best === null || ringArea(l) > ringArea(best)) best = l;
    if (best === null) throw new RangeError(`no level line ${levelM} m off the coast`);
    // contours() puts points at pixel centres (x + 0.5): lattice node i is at x0 + i h.
    return simplify(best.map(([px, py]): Px => [x0 + (px - 0.5) * h, z0 + (py - 0.5) * h]), DRAWN_TOLERANCE_TRUE_M) as Scene[];
  });
}

function quantised(ring: readonly Scene[], frame: Frame): Q[] {
  const out: Q[] = [];
  for (const [x, z] of ring) {
    const [lon, lat] = frame.fromTrue(x, z);
    const q: Q = [Math.round(lon * 1e5), Math.round(lat * 1e5)];
    const last = out[out.length - 1];
    if (last === undefined || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

/** D387's band round an island's charted outline (degrees): its edge and crest, quantised to 1e-5 degrees (the header). */
export function drawnBand(ring: readonly LonLat[]): { readonly edge: Q[]; readonly crest: Q[]; readonly crestM: number; readonly edgeM: number } {
  const frame = frameOf(ring);
  const coast = ring.map(([lon, lat]) => frame.toTrue(lon, lat));
  const crestM = DRAWN_CREST_SCENE_M / ISLAND_SOURCE.scale;
  const edgeM = DRAWN_EDGE_SCENE_M / ISLAND_SOURCE.scale;
  const [edge, crest] = levelLines(coast, [edgeM, crestM]) as [Scene[], Scene[]];
  return { edge: quantised(edge, frame), crest: quantised(crest, frame), crestM, edgeM };
}
