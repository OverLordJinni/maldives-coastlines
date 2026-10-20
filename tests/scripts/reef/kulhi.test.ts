// The kulhi's pure steps (scripts/reef/kulhi.ts) on grids this test draws: the water index, which water the sea cannot
// reach, and the outline of a region by marching squares with every other water held below the level.
//
// Seen red (L49), each once and reverted: the flood made 8-connected (the corner case red: a pond touching the lagoon only
// at a corner joined the sea); `kulhiLoops` without holding other water at −1 (the lagoon-corner case red: the saddle at
// the corner joined the pond's outline to the lagoon's, so the loop held lagoon pixels).
import { describe, expect, it } from "vitest";
import { enclosedWater, kulhiLoops, mndwi, WATER_MNDWI } from "../../../scripts/reef/kulhi.ts";
import { inside, type Px } from "../../../scripts/reef/trace.ts";

/** A grid from rows of characters: "~" water, "#" land. */
function grid(rows: readonly string[]): { water: Uint8Array; index: Float64Array; width: number; height: number } {
  const height = rows.length;
  const width = (rows[0] as string).length;
  const water = new Uint8Array(width * height);
  const index = new Float64Array(width * height);
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      water[y * width + x] = ch === "~" ? 1 : 0;
      index[y * width + x] = ch === "~" ? 0.5 : -0.4;
    }),
  );
  return { water, index, width, height };
}

describe("the water index (MNDWI)", () => {
  it("is (green − SWIR1) / (green + SWIR1), water at or above 0, and water when both are dark", () => {
    expect(mndwi(0.08, 0.01)).toBeCloseTo(7 / 9, 12);
    expect(mndwi(0.05, 0.3)).toBeLessThan(WATER_MNDWI);
    expect(mndwi(-0.01, 0)).toBe(1);
  });
});

describe("water the sea cannot reach", () => {
  it("is a pond inside the land; the lagoon touching the border is sea", () => {
    const g = grid(["~~~~~~~", "~#####~", "~#~~~#~", "~#~~~#~", "~#####~", "~~~~~~~"]);
    const e = enclosedWater(g.water, g.width, g.height);
    expect(e.regions).toEqual([[16, 17, 18, 23, 24, 25]]);
  });

  it("does not join the sea through a corner (4-connected), so a sand bar narrower than a pixel still encloses", () => {
    const g = grid(["~~~~~", "~~###", "##~~#", "##~~#", "#####"]);
    const e = enclosedWater(g.water, g.width, g.height);
    expect(e.regions).toEqual([[12, 13, 17, 18]]);
  });

  it("finds nothing where every pond opens to the sea", () => {
    const g = grid(["~~~~~", "~###~", "~#~~~", "~###~", "~~~~~"]);
    expect(enclosedWater(g.water, g.width, g.height).regions).toEqual([]);
  });
});

describe("the kulhi's outline", () => {
  it("does not run into the lagoon at a corner the pond touches (a saddle marching squares would otherwise join)", () => {
    const g = grid(["~~~~~", "~~###", "##~~#", "##~~#", "#####"]);
    const { regions, sea } = enclosedWater(g.water, g.width, g.height);
    const [loop] = kulhiLoops(g.index, regions, g.width, g.height);
    expect(loop).not.toBeNull();
    const centre = (k: number): Px => [(k % g.width) + 0.5, Math.floor(k / g.width) + 0.5];
    for (const k of regions[0] as number[]) expect(inside(centre(k), loop as Px[]), `own pixel ${k}`).toBe(true);
    for (let k = 0; k < sea.length; k++) if (sea[k] === 1) expect(inside(centre(k), loop as Px[]), `lagoon pixel ${k}`).toBe(false);
  });

  it("is one loop round the region kept, holding its pixels and not the other pond's", () => {
    const g = grid(["#########", "#~~~#~~~#", "#~~~#~~~#", "#~~~#~~~#", "#########"]);
    const { regions } = enclosedWater(g.water, g.width, g.height);
    expect(regions.length).toBe(2);
    const keep = [regions[0] as number[]];
    const [loop] = kulhiLoops(g.index, keep, g.width, g.height);
    expect(loop).not.toBeNull();
    const centre = (k: number): Px => [(k % g.width) + 0.5, Math.floor(k / g.width) + 0.5];
    for (const k of regions[0] as number[]) expect(inside(centre(k), loop as Px[]), `own pixel ${k}`).toBe(true);
    for (const k of regions[1] as number[]) expect(inside(centre(k), loop as Px[]), `other pond's pixel ${k}`).toBe(false);
  });
});
