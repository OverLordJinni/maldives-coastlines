// The traced reef's pure steps (scripts/reef/trace.ts): the statistics that choose the two levels, the contour that
// draws them, and the simplification that ships them.
// Seen red (L49): `contours` with its saddle rule inverted split the saddle case into two loops; `otsu` returning half
// its cut (a level inside the lower hump) failed the bimodal case.
import { describe, expect, it } from "vitest";
import { blur, contours, frameValues, inside, loopAround, median, otsu, ringArea, robust, simplify, type Px } from "../../../scripts/reef/trace.ts";

/** A disc of value 1 on 0, radius r pixels, centred in an n × n grid. */
const disc = (n: number, r: number, cx = n / 2, cy = n / 2): Float64Array => {
  const f = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) f[y * n + x] = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r ? 1 : 0;
  return f;
};

describe("statistics", () => {
  it("median and the robust sigma (1.4826 × MAD) of a known list", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    const r = robust([1, 2, 3, 4, 100]);
    expect(r.median).toBe(3);
    expect(r.sigma).toBeCloseTo(1.4826, 6);
  });

  it("Otsu splits two separated humps between them", () => {
    const v = [...Array.from({ length: 500 }, (_, i) => 1 + (i % 10) * 0.01), ...Array.from({ length: 300 }, (_, i) => 3 + (i % 10) * 0.01)];
    const t = otsu(v);
    // Above every value of the lower hump (1.00–1.09) and below every value of the upper one.
    expect(t).toBeGreaterThan(1.09);
    expect(t).toBeLessThan(3);
  });

  it("frames a grid's border", () => {
    const f = Array.from({ length: 25 }, (_, i) => i);
    expect(frameValues(f, 5, 5, 1).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]);
  });

  it("blurs without moving a mass or brightening anything", () => {
    const f = disc(40, 8);
    const b = blur(f, 40, 40, 1);
    expect(b.reduce((a, x) => a + x, 0)).toBeCloseTo(f.reduce((a, x) => a + x, 0), 6);
    expect(Math.max(...b)).toBeLessThanOrEqual(1);
  });
});

describe("contours", () => {
  it("draws a disc's edge as one closed loop of the disc's area", () => {
    const loops = contours(blur(disc(60, 15), 60, 60, 1), 60, 60, 0.5);
    expect(loops.length).toBe(1);
    // Within 2 %: a disc of whole pixels is not quite πr², and the contour runs through the blurred edge.
    expect(Math.abs(ringArea(loops[0] as Px[]) / (Math.PI * 15 * 15) - 1)).toBeLessThan(0.02);
  });

  it("keeps two separate discs separate, and finds the one round a point", () => {
    const a = disc(80, 10, 25, 40);
    const b = disc(80, 10, 55, 40);
    const f = a.map((v, i) => Math.max(v, b[i] as number));
    const loops = contours(f, 80, 80, 0.5);
    expect(loops.length).toBe(2);
    const round = loopAround(loops, [55, 40]);
    expect(round).not.toBeNull();
    expect(inside([55, 40], round as Px[])).toBe(true);
    expect(inside([25, 40], round as Px[])).toBe(false);
  });

  it("joins a saddle the same way every time (by the cell's mean)", () => {
    // A checkerboard 2 × 2 cell inside a field of 0: corners 1, 0, 1, 0 with a mean of 0.5, at level 0.5 (inside).
    const f = new Float64Array(16);
    f[5] = 1;
    f[10] = 1;
    const first = contours(f, 4, 4, 0.5);
    expect(contours(f, 4, 4, 0.5)).toEqual(first);
    expect(first.length).toBe(1);
  });
});

describe("simplify", () => {
  it("keeps a closed ring within its tolerance and drops the points it can", () => {
    const ring: Px[] = Array.from({ length: 400 }, (_, i) => [Math.cos((i / 400) * Math.PI * 2) * 50, Math.sin((i / 400) * Math.PI * 2) * 50] as const);
    const s = simplify(ring, 0.5);
    expect(s.length).toBeLessThan(60);
    expect(s.length).toBeGreaterThan(8);
    // Every original point within the tolerance of the simplified ring.
    const dist = (p: Px): number => {
      let best = Infinity;
      for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
        const a = s[j] as Px;
        const b = s[i] as Px;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
      }
      return best;
    };
    for (const p of ring) expect(dist(p)).toBeLessThanOrEqual(0.5 + 1e-9);
  });
});
