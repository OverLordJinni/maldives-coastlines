// Tracing the reef flat from a Sentinel-2 window (R75, D269, D283): the pure steps, each a unit test
// (tests/scripts/reef/trace.test.ts). build-reef.ts reads the files and calls these in order.
//
// **The method, and why it is this one.** Over a coral island the sea bottom shows through shallow water and does not
// through deep water, so the reef reads in the green band (B03, 560 nm, the band that reaches deepest in clear tropical
// water) as water brighter than the open sea. Two levels, each a deterministic number taken from the image itself, never
// a hand-picked one:
//   1. **Land** is any pixel brighter in near-infrared (B08) than in green: vegetation and dry sand reflect NIR strongly,
//      and water absorbs it. (The ratio form is NDWI, McFeeters 1996: NDWI < 0 is land.)
//   2. **The reef's edge** (where it drops to open water, R71's boundary) is where the water stops being brighter than
//      the open sea: the green threshold is the open sea's median plus **six robust standard deviations**
//      (1.4826 × the median absolute deviation), measured on the window's outer frame of pixels, which is open ocean.
//      Six, because at that distance a pixel of open sea is never mistaken for reef (the frame's own brightest pixel on
//      the 2026-04-20 scene sits under it), while the faint fringe of the reef slope is still inside.
//   3. **The crest** (the rim of the flat, where the surf breaks and the slope begins) is Otsu's threshold on the
//      LOGARITHM of green over the water pixels inside the edge: the level that best splits the bright flat from the
//      darker slope. Log, because brightness over a bottom falls off exponentially with depth, so the flat and the slope
//      are two humps in log-reflectance and not in reflectance.
// Before either contour the green band is smoothed by a Gaussian of one pixel's sigma (`blur`): a single bright or dark
// pixel (a wave's glint, a patch of sea grass) otherwise draws a 10 m spur on the outline, which no reef has and which
// AC163's two-pixel tolerance would read as a disagreement. One pixel, not more: the reef's own bends are tens of pixels.
// Each level is traced as a contour by marching squares on the pixel grid (sub-pixel, linear between pixel centres), with
// land held above every threshold so the island is always "inside", and the one loop that encloses the island is kept.
//
// Rejected:
//   - **Tracing by hand** (Q72's option a). Not repeatable, and not something the record could rebuild.
//   - **A fixed reflectance** (say 0.025). It was the first try and it happens to match OSM's area on this scene, but a
//     hazier day lifts the whole sea and a fixed number would move the edge outwards with it; a threshold taken from the
//     scene's own open sea moves with the haze.
//   - **Otsu on raw green for the edge.** It lands at 0.106 on this scene, the bright sand shallows against everything
//     else, and draws the reef as a ring a few pixels wide: the "flat too small" the owner complained of (D269).
//   - **Depth inversion** (Stumpf's log-ratio bathymetry). It needs depth soundings to calibrate, which no open source has
//     for Maavaidhoo, and Q70 keeps depth a profile from the shore, not an image product.

/** A point in pixel coordinates: x across, y down, at pixel centres (0.5, 0.5 is the first pixel's centre). */
export type Px = readonly [x: number, y: number];

/** The median of a list (not mutated). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of nothing");
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** The median and the robust standard deviation (1.4826 × the median absolute deviation) of a list. */
export function robust(values: readonly number[]): { readonly median: number; readonly sigma: number } {
  const m = median(values);
  return { median: m, sigma: 1.4826 * median(values.map((v) => Math.abs(v - m))) };
}

/**
 * Otsu's threshold (1979) over a list of numbers, in `bins` equal bins between its least and greatest value: the cut
 * that maximises the between-class variance. Returns the cut's value (the upper edge of the last bin of the lower class).
 */
export function otsu(values: readonly number[], bins = 256): number {
  if (values.length < 2) throw new Error("otsu needs at least two values");
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi === lo) return lo;
  const width = (hi - lo) / bins;
  const hist = new Array<number>(bins).fill(0);
  for (const v of values) {
    const b = Math.min(bins - 1, Math.floor((v - lo) / width));
    hist[b] = (hist[b] as number) + 1;
  }
  let total = 0;
  for (let i = 0; i < bins; i++) total += i * (hist[i] as number);
  let sumB = 0;
  let wB = 0;
  let best = -1;
  let cut = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i] as number;
    if (wB === 0) continue;
    const wF = values.length - wB;
    if (wF === 0) break;
    sumB += i * (hist[i] as number);
    const mB = sumB / wB;
    const mF = (total - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      cut = i;
    }
  }
  return lo + (cut + 1) * width;
}

/** A separable Gaussian blur (sigma in pixels, kernel to 3 sigma), edges clamped. Deterministic. */
export function blur(values: ArrayLike<number>, width: number, height: number, sigma: number): Float64Array {
  const r = Math.ceil(3 * sigma);
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(w);
    sum += w;
  }
  for (let i = 0; i < k.length; i++) k[i] = (k[i] as number) / sum;
  const pass = (src: ArrayLike<number>, horizontal: boolean): Float64Array => {
    const out = new Float64Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let v = 0;
        for (let i = -r; i <= r; i++) {
          const xx = horizontal ? Math.min(width - 1, Math.max(0, x + i)) : x;
          const yy = horizontal ? y : Math.min(height - 1, Math.max(0, y + i));
          v += (k[i + r] as number) * (src[yy * width + xx] as number);
        }
        out[y * width + x] = v;
      }
    return out;
  };
  return pass(pass(values, true), false);
}

/** The values on the outer `frame` pixels of a `width × height` grid (the open sea round a window centred on an island). */
export function frameValues(values: ArrayLike<number>, width: number, height: number, frame: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (x < frame || y < frame || x >= width - frame || y >= height - frame) out.push(values[y * width + x] as number);
  return out;
}

/**
 * The closed contour loops of `field` at `level` (marching squares over pixel centres), each a ring of points with no
 * repeated closing point. A cell is inside where its value is ≥ `level`. Saddles are resolved by the cell's mean, so the
 * result is deterministic. Open contours that run off the grid are dropped: the window is chosen so the reef is inside it.
 */
export function contours(field: ArrayLike<number>, width: number, height: number, level: number): Px[][] {
  // Each segment runs between two edge midpoints, keyed by the edge it crosses, so the loops can be joined exactly.
  type Edge = string;
  const point = new Map<Edge, Px>();
  const next = new Map<Edge, Edge>();
  const at = (x: number, y: number): number => field[y * width + x] as number;
  const crossing = (x0: number, y0: number, x1: number, y1: number): Px => {
    const a = at(x0, y0);
    const b = at(x1, y1);
    const t = a === b ? 0.5 : (level - a) / (b - a);
    return [x0 + 0.5 + (x1 - x0) * t, y0 + 0.5 + (y1 - y0) * t];
  };
  // Edges of the cell whose top-left pixel is (x, y): top (x,y)-(x+1,y), right, bottom, left.
  const key = (x0: number, y0: number, x1: number, y1: number): Edge => `${x0},${y0},${x1},${y1}`;
  const link = (from: Edge, fromPt: Px, to: Edge, toPt: Px): void => {
    point.set(from, fromPt);
    point.set(to, toPt);
    next.set(from, to);
  };
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = at(x, y) >= level ? 1 : 0;
      const tr = at(x + 1, y) >= level ? 1 : 0;
      const br = at(x + 1, y + 1) >= level ? 1 : 0;
      const bl = at(x, y + 1) >= level ? 1 : 0;
      const code = tl * 8 + tr * 4 + br * 2 + bl;
      if (code === 0 || code === 15) continue;
      const T = key(x, y, x + 1, y);
      const R = key(x + 1, y, x + 1, y + 1);
      const B = key(x, y + 1, x + 1, y + 1);
      const L = key(x, y, x, y + 1);
      const pT = (): Px => crossing(x, y, x + 1, y);
      const pR = (): Px => crossing(x + 1, y, x + 1, y + 1);
      const pB = (): Px => crossing(x, y + 1, x + 1, y + 1);
      const pL = (): Px => crossing(x, y, x, y + 1);
      // Segments are directed with the inside on the right (x across, y down), so every loop runs one way and each
      // edge is the head of one segment and the tail of the next: the loops join exactly, edge by edge.
      const centre = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= level;
      switch (code) {
        case 1: link(L, pL(), B, pB()); break;
        case 2: link(B, pB(), R, pR()); break;
        case 3: link(L, pL(), R, pR()); break;
        case 4: link(R, pR(), T, pT()); break;
        case 5:
          if (centre) { link(L, pL(), T, pT()); link(R, pR(), B, pB()); }
          else { link(L, pL(), B, pB()); link(R, pR(), T, pT()); }
          break;
        case 6: link(B, pB(), T, pT()); break;
        case 7: link(L, pL(), T, pT()); break;
        case 8: link(T, pT(), L, pL()); break;
        case 9: link(T, pT(), B, pB()); break;
        case 10:
          if (centre) { link(T, pT(), R, pR()); link(B, pB(), L, pL()); }
          else { link(T, pT(), L, pL()); link(B, pB(), R, pR()); }
          break;
        case 11: link(T, pT(), R, pR()); break;
        case 12: link(R, pR(), L, pL()); break;
        case 13: link(R, pR(), B, pB()); break;
        case 14: link(B, pB(), L, pL()); break;
      }
    }
  }
  const loops: Px[][] = [];
  const used = new Set<Edge>();
  for (const start of [...next.keys()].sort()) {
    if (used.has(start)) continue;
    const ring: Px[] = [];
    let e: Edge | undefined = start;
    let closed = false;
    while (e !== undefined && !used.has(e)) {
      used.add(e);
      ring.push(point.get(e) as Px);
      e = next.get(e);
      if (e === start) closed = true;
    }
    if (closed && ring.length >= 3) loops.push(ring);
  }
  return loops;
}

/** Shoelace area of a ring (absolute), in its own units squared. */
export function ringArea(ring: readonly Px[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Px;
    const [xj, yj] = ring[j] as Px;
    a += xj * yi - xi * yj;
  }
  return Math.abs(a / 2);
}

/** Even–odd point in ring. */
export function inside(p: Px, ring: readonly Px[]): boolean {
  let c = false;
  const [x, y] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as Px;
    const [xj, yj] = ring[j] as Px;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** The largest loop that encloses `p`, or null. */
export function loopAround(loops: readonly Px[][], p: Px): Px[] | null {
  let best: Px[] | null = null;
  for (const l of loops) if (inside(p, l) && (best === null || ringArea(l) > ringArea(best))) best = l;
  return best;
}

/** Douglas–Peucker on a closed ring (in its own units), split at its two farthest-apart points so the result stays closed. */
export function simplify(ring: readonly Px[], tolerance: number): Px[] {
  if (ring.length < 4) return [...ring];
  const dist = (p: Px, a: Px, b: Px): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const run = (pts: readonly Px[]): Px[] => {
    const keep = new Uint8Array(pts.length);
    keep[0] = 1;
    keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length > 0) {
      const [i, j] = stack.pop() as [number, number];
      let far = -1;
      let at = -1;
      for (let k = i + 1; k < j; k++) {
        const d = dist(pts[k] as Px, pts[i] as Px, pts[j] as Px);
        if (d > far) {
          far = d;
          at = k;
        }
      }
      if (far > tolerance) {
        keep[at] = 1;
        stack.push([i, at], [at, j]);
      }
    }
    return pts.filter((_, k) => keep[k] === 1);
  };
  // Split at point 0 and the point farthest from it.
  let far = 0;
  let at = 0;
  for (let k = 1; k < ring.length; k++) {
    const d = Math.hypot((ring[k] as Px)[0] - (ring[0] as Px)[0], (ring[k] as Px)[1] - (ring[0] as Px)[1]);
    if (d > far) {
      far = d;
      at = k;
    }
  }
  const a = run(ring.slice(0, at + 1));
  const b = run([...ring.slice(at), ring[0] as Px]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
