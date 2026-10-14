// The pipeline's geometry: joining OSM ways into rings, area, point-in-ring, and Douglas–Peucker.
//
// Everything here works in **local metres** from an equirectangular projection at the latitude
// that matters (a ring's own mean latitude, or a pair's), the same projection the game's sighting
// rule uses (`src/rules/chartData.ts` `toLocalMetres`, imported rather than re-derived, so the measured
// Maavaidhoo–Kulhudhuffushi distance in the manifest is the number the game would compute). At the
// Maldives' latitudes (about 0.7° S to 7.1° N) and over one island or one pair, it errs by well
// under 0.1 %, which is below the 5 m simplification itself. Rejected: a geodesic library (one more
// dependency for a precision the data does not have; OSM coastlines here were traced from imagery,
// `source=PGS` on Maavaidhoo, to some metres).
import { toLocalMetres, type LonLat, type Metres } from "../../src/rules/chartData.ts";

export interface WayRefs {
  readonly id: number;
  readonly refs: readonly number[];
}

export interface Ring {
  /** The ways the ring was joined from, in joining order. */
  readonly wayIds: readonly number[];
  /** Node ids, closed: the first equals the last. */
  readonly refs: readonly number[];
}

export interface Assembled {
  readonly rings: readonly Ring[];
  /** Chains of ways that never closed (an extract's edge, or a mapping error). */
  readonly open: readonly { readonly wayIds: readonly number[] }[];
}

/**
 * Joins ways end to end into closed rings. A way may be used forwards or reversed, because
 * multipolygon members (an atoll's boundary) are not ordered; coastlines happen to be ordered (land
 * on the left), and reversing one changes no ring's set of points.
 *
 * Deterministic: ways are taken in id order, and at a node where more than one way could continue,
 * the lowest id is taken. A pipeline whose output depends on Map iteration order could not be rebuilt
 * byte for byte from the record (R57).
 */
export function assembleRings(ways: readonly WayRefs[]): Assembled {
  const sorted = [...ways].filter((w) => w.refs.length >= 2).sort((a, b) => a.id - b.id);
  const byEnd = new Map<number, WayRefs[]>();
  const add = (node: number, w: WayRefs): void => {
    const list = byEnd.get(node);
    if (list) list.push(w);
    else byEnd.set(node, [w]);
  };
  for (const w of sorted) {
    add(w.refs[0] as number, w);
    add(w.refs[w.refs.length - 1] as number, w);
  }
  const used = new Set<number>();
  const rings: Ring[] = [];
  const open: { wayIds: number[] }[] = [];
  for (const start of sorted) {
    if (used.has(start.id)) continue;
    used.add(start.id);
    const wayIds = [start.id];
    const refs = [...start.refs];
    // Extend at the tail until it closes or nothing continues; then try the head, so a chain cut by
    // the extract's edge is reported whole rather than as two pieces.
    const extend = (): void => {
      while (refs[0] !== refs[refs.length - 1]) {
        const tail = refs[refs.length - 1] as number;
        const next = (byEnd.get(tail) ?? []).find((w) => !used.has(w.id));
        if (!next) return;
        used.add(next.id);
        wayIds.push(next.id);
        const forwards = next.refs[0] === tail;
        const r = forwards ? next.refs : [...next.refs].reverse();
        for (let i = 1; i < r.length; i++) refs.push(r[i] as number);
      }
    };
    extend();
    if (refs[0] !== refs[refs.length - 1]) {
      refs.reverse();
      wayIds.reverse();
      extend();
    }
    if (refs[0] === refs[refs.length - 1] && refs.length >= 4) rings.push({ wayIds, refs });
    else open.push({ wayIds });
  }
  return { rings, open };
}

/** Mean latitude of a ring's points, the projection's standard parallel for anything about one ring. */
export function meanLat(points: readonly LonLat[]): number {
  let s = 0;
  for (const p of points) s += p[1];
  return points.length === 0 ? 0 : s / points.length;
}

/** Signed area by the shoelace formula, in square metres; positive when anticlockwise. */
export function signedAreaM2(points: readonly LonLat[]): number {
  const m = toLocalMetres(points, meanLat(points));
  // j is the point before i, so each term is x_prev·y_cur − x_cur·y_prev: the shoelace sum, positive
  // for an anticlockwise ring (land on the left of a coastline, as OSM draws islands).
  let a = 0;
  for (let i = 0, j = m.length - 1; i < m.length; j = i++) {
    const [xi, yi] = m[i] as Metres;
    const [xj, yj] = m[j] as Metres;
    a += xj * yi - xi * yj;
  }
  return a / 2;
}

export function areaM2(points: readonly LonLat[]): number {
  return Math.abs(signedAreaM2(points));
}

/** Even–odd point in ring, in degrees (a ring this small is flat enough for it). */
export function inRing(p: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as LonLat;
    const [xj, yj] = ring[j] as LonLat;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export interface Bbox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function bboxOf(points: readonly LonLat[]): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function inBbox(p: LonLat, b: Bbox): boolean {
  return p[0] >= b.minX && p[0] <= b.maxX && p[1] >= b.minY && p[1] <= b.maxY;
}

function segmentDistance(p: Metres, a: Metres, b: Metres): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker on an open polyline in metres: the indices kept, ends included. */
function dpIndices(pts: readonly Metres[], tolerance: number): number[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop() as [number, number];
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segmentDistance(pts[k] as Metres, pts[i] as Metres, pts[j] as Metres);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => {
    if (k) out.push(i);
  });
  return out;
}

/**
 * Simplifies a closed ring (first point = last) by Douglas–Peucker at `toleranceM` metres, in the
 * ring's own local projection. Returns the ring OPEN (no repeated last point), which is how the chart
 * stores rings: the closing edge is implied, and storing it would cost a point per island for nothing.
 *
 * A closed ring has no natural ends, so it is split at its first point and at the point furthest from
 * it, and each half is simplified; that keeps the two points that span it. A ring that would fall
 * below three points (an islet narrower than the tolerance) keeps its three most distant points
 * rather than collapsing: an island in the data never vanishes in simplification. The filter decides
 * which islands exist; the simplifier only decides how they are drawn.
 */
export function simplifyRing(closed: readonly LonLat[], toleranceM: number): LonLat[] {
  const ring = closed.slice(0, -1);
  if (ring.length <= 3) return ring;
  const m = toLocalMetres(ring, meanLat(ring));
  let far = 0;
  let farD = -1;
  for (let k = 1; k < m.length; k++) {
    const d = Math.hypot((m[k] as Metres)[0] - (m[0] as Metres)[0], (m[k] as Metres)[1] - (m[0] as Metres)[1]);
    if (d > farD) {
      farD = d;
      far = k;
    }
  }
  const first = m.slice(0, far + 1);
  const second = [...m.slice(far), m[0] as Metres];
  const a = dpIndices(first, toleranceM);
  const b = dpIndices(second, toleranceM).map((i) => i + far);
  const idx = [...a, ...b.slice(1, -1)];
  if (idx.length >= 3) return idx.map((i) => ring[i] as LonLat);
  // Fewer than three: keep 0, `far`, and the point furthest from the line between them.
  let third = -1;
  let thirdD = -1;
  for (let k = 1; k < m.length; k++) {
    if (k === far) continue;
    const d = segmentDistance(m[k] as Metres, m[0] as Metres, m[far] as Metres);
    if (d > thirdD) {
      thirdD = d;
      third = k;
    }
  }
  return [0, far, third].sort((x, y) => x - y).map((i) => ring[i] as LonLat);
}
