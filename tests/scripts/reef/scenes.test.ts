// The reefs' scene rule (scripts/reef/scenes.ts): each island's window, the cloud SCL finds over its water with bright
// ground set aside, and the order the build tries scenes in. On a scene classification band this test writes itself.
//
// Seen red (L49), each once and reverted: WINDOW_MARGIN_M set back to 500 (the home's 160 px case red: 192); the land and
// beach set-aside removed from `windowCloud` (the score case red: 13 where 11 is right); the tile-cloud tie-break dropped
// from `byClearness` (the order case red).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { areaCentroid, byClearness, clearest, islandWindow, SAND_BAND_M, windowCloud, WINDOW_MARGIN_M, type Candidate, type WindowCloud } from "../../../scripts/reef/scenes.ts";
import { fromUtm } from "../../../scripts/reef/utm.ts";
import { decodeChart, type LonLat } from "../../../src/rules/chartData.ts";
import { writeTiff } from "./tiffWriter.ts";

const repo = resolve(import.meta.dirname, "../../..");
const chart = decodeChart(new Uint8Array(readFileSync(resolve(repo, "src/assets/chart/maldives.bin"))));
const ll = (x: number, y: number): LonLat => {
  const p = fromUtm(x, y, 43);
  return [p.lon, p.lat];
};

describe("an island's window", () => {
  it("is centred on the area centroid (a centroid an affine map carries, so planar degrees are exact)", () => {
    expect(areaCentroid([[0, 0], [4, 0], [4, 2], [0, 2]])).toEqual([2, 1]);
    // An L: two unit squares and one more, centroid weighted by area.
    const [x, y] = areaCentroid([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]);
    expect(x).toBeCloseTo(5 / 6, 12);
    expect(y).toBeCloseTo(5 / 6, 12);
    expect(() => areaCentroid([[0, 0], [1, 1], [2, 2]])).toThrow(/no area/);
  });

  it("gives the home island its own 160 px window: the margin is the home's, generalised", () => {
    const home = chart.islands.find((i) => i.id === "w19879672");
    expect(home).toBeDefined();
    expect(islandWindow(home?.ring as LonLat[], 43).sizePx).toBe(160);
  });

  it("is even, reaches the margin beyond the farthest point on either axis, and takes another pixel size", () => {
    const square = [ll(279900, 729900), ll(280100, 729900), ll(280100, 730100), ll(279900, 730100)];
    // Drawn square in UTM, the ring in degrees comes back turned by the grid's convergence (about 0.2° here), so its
    // farthest point is a little over 100 m out: the window covers it plus the margin, by less than one pixel more.
    for (const pixel of [10, 30]) {
      const w = islandWindow(square, 43, pixel);
      expect(w.sizePx % 2).toBe(0);
      expect(w.pixelM).toBe(pixel);
      expect((w.sizePx / 2) * pixel).toBeGreaterThanOrEqual(100 + WINDOW_MARGIN_M);
      expect((w.sizePx / 2) * pixel).toBeLessThan(102 + WINDOW_MARGIN_M + pixel);
    }
  });
});

describe("the cloud SCL finds over an island's water", () => {
  // A 200 m square island at UTM (280000, 730000); a 2 km SCL band at 20 m, its corner at (279000, 731000), all water (6)
  // but for: 9 cloud pixels over the water, one shadow, one cirrus, a cloud flag on the beach band (30 m off the coast)
  // and one inside the island.
  const island = [ll(279900, 729900), ll(280100, 729900), ll(280100, 730100), ll(279900, 730100)];
  const scl = (extra: (x: number, y: number) => number | null = () => null) =>
    writeTiff({
      width: 100,
      height: 100,
      tile: 32,
      pixelM: 20,
      originX: 279000,
      originY: 731000,
      pixel: (x, y) => {
        const e = extra(x, y);
        if (e !== null) return e;
        if (x >= 30 && x <= 32 && y >= 30 && y <= 32) return 9;
        if (x === 35 && y === 60) return 3;
        if (x === 65 && y === 35) return 10;
        if (x === 56 && y === 50) return 8; // centre 280130 E: 30 m off the island's east shore
        if (x === 50 && y === 50) return 9; // inside the island
        return 6;
      },
    });
  const win = islandWindow(island, 43);

  it("counts cloud, shadow and cirrus over the water and sets bright ground aside", () => {
    const c = windowCloud(scl(), island, win, 43);
    expect(c).toMatchObject({ unusable: 0, cloud: 9, shadow: 1, cirrus: 1, setAside: 2, score: 11 });
    expect(SAND_BAND_M).toBe(40);
  });

  it("rules a scene out when its window holds no data, and refuses a band that is not 20 m", () => {
    const c = windowCloud(scl((x, y) => (x === 40 && y === 40 ? 0 : null)), island, win, 43);
    expect(c.unusable).toBe(1);
    expect(c.score).toBeNull();
    const ten = writeTiff({ width: 200, height: 200, tile: 64, pixelM: 10, originX: 279000, originY: 731000, pixel: () => 6 });
    expect(() => windowCloud(ten, island, win, 43)).toThrow(/not 20/);
  });
});

describe("the order scenes are tried in", () => {
  const w = (score: number | null): WindowCloud => ({ pixels: 1, unusable: score === null ? 1 : 0, cloud: score ?? 0, shadow: 0, cirrus: 0, setAside: 0, score });
  const c = (scene: string, sensed: string, tileCloud: number, score: number | null): Candidate => ({ scene, sensed, tileCloud, window: w(score) });

  it("is least cloud over the water, then the least cloudy tile, then the earlier date; no-data scenes never", () => {
    const list = [c("a", "2026-01-10", 4.3, 0), c("b", "2025-11-06", 7.7, 0), c("c", "2026-03-01", 0.2, 5), c("d", "2025-12-01", 0.1, null), c("e", "2025-10-30", 4.3, 0)];
    expect(byClearness(list).map((x) => x.scene)).toEqual(["e", "a", "b", "c"]);
    expect(clearest(list)?.scene).toBe("e");
    expect(clearest([c("d", "2025-12-01", 0.1, null)])).toBeNull();
  });
});
