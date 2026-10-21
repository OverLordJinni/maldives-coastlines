// The trace's three ways of not tracing (scripts/reef/build-reef.ts `traceScene`), on scenes this test writes itself, so
// it runs everywhere: a reef that runs past the window is `NotClosed` (RF2's build widens the window and tries again), the
// same reef in a window wide enough closes, and a window off the scene's image is `NoData` (the build passes the scene
// over), never the TiffError it was before RF2.
//
// The scene: 10 m pixels in UTM zone 43 near the band's latitude; open sea at B03 DN 198–202 (a fixed ripple, so the
// frame's robust sigma is not zero), a reef flat at DN 600 with a brighter inner flat at 1200, and land (B08 above B03) at
// the centre.
//
// And `insideMask`, the trace's row-at-a-time even–odd fill, against trace.ts `inside` pixel by pixel, on rings with
// vertices and edges exactly on pixel centres, where a strict and a loose comparison differ.
//
// Seen red (L49), each once and reverted: the bounds check removed from `traceScene` (the off-image case red: TiffError,
// not NoData); `NotClosed` thrown as a plain Refused for the edge (the run-on and rim cases red); `insideMask` counting the
// crossings at or right of a pixel (`<` for `<=` in its scan: the mask case red).
import { describe, expect, it } from "vitest";
import { insideMask, NoData, NotClosed, Refused, traceScene } from "../../../scripts/reef/build-reef.ts";
import { inside, type Px } from "../../../scripts/reef/trace.ts";
import { fromUtm } from "../../../scripts/reef/utm.ts";
import { writeTiff } from "./tiffWriter.ts";

const ORIGIN = { x: 270_000, y: 740_000 };
const SIZE = 320;

/** A scene of B03 and B08 round an island at pixel (cx, cy), its reef by `reef(dx, dy)`: 0 sea, 1 reef, 2 inner flat. */
function scene(reef: (dx: number, dy: number) => 0 | 1 | 2, cx = 160, cy = 160) {
  const land = (x: number, y: number): boolean => Math.hypot(x - cx, y - cy) <= 4;
  const green = (x: number, y: number): number => {
    const r = reef(x - cx, y - cy);
    return r === 2 ? 1200 : r === 1 ? 600 : 200 + (((x * 7 + y * 13) % 5) - 2);
  };
  const spec = { width: SIZE, height: SIZE, tile: 64, pixelM: 10, originX: ORIGIN.x, originY: ORIGIN.y, bits: 16 as const };
  const b03 = writeTiff({ ...spec, pixel: green });
  const b08 = writeTiff({ ...spec, pixel: (x, y) => (land(x, y) ? 3000 : 100) });
  const c = fromUtm(ORIGIN.x + (cx + 0.5) * 10, ORIGIN.y - (cy + 0.5) * 10, 43);
  return { b03, b08, centre: [c.lon, c.lat] as const };
}

/** An elliptical reef round the island, `rx` by `ry` pixels from its centre, its inner flat at two thirds of it. */
const oval = (rx: number, ry: number) => (dx: number, dy: number): 0 | 1 | 2 => {
  const d = Math.hypot(dx / rx, dy / ry);
  return d <= 2 / 3 ? 2 : d <= 1 ? 1 : 0;
};

describe("traceScene's refusals, which RF2's build reads as 'widen' and 'pass over'", () => {
  // A reef 2 km long and 800 m wide: a 140 px window's frame is open sea above and below it, and crosses it at both ends.
  it("a reef that runs past the window does not close: NotClosed, a Refused", () => {
    const s = scene(oval(100, 40));
    const e = (() => {
      try {
        traceScene(s.b03, s.b08, 32643, s.centre, 140);
      } catch (x) {
        return x;
      }
      return null;
    })();
    expect(e).toBeInstanceOf(NotClosed);
    expect(e).toBeInstanceOf(Refused);
    expect(e).not.toBeInstanceOf(NoData);
  });

  it("the same reef in a window with open sea all round closes, the edge where the reef ends", () => {
    const s = scene(oval(100, 40));
    const t = traceScene(s.b03, s.b08, 32643, s.centre, 240);
    expect(t.window.size).toBe(240);
    const cx = ORIGIN.x + 160.5 * 10;
    const cy = ORIGIN.y - 160.5 * 10;
    const xs = t.edgeUtm.map((p) => p[0] - cx);
    const ys = t.edgeUtm.map((p) => p[1] - cy);
    // 1,000 m east and west, 400 m north and south, within three pixels: the blur and a threshold just above the sea put
    // the line a pixel or two outside the last reef pixel's centre.
    expect(Math.abs(Math.max(...xs) - 1000)).toBeLessThan(30);
    expect(Math.abs(Math.min(...xs) + 1000)).toBeLessThan(30);
    expect(Math.abs(Math.max(...ys) - 400)).toBeLessThan(30);
    expect(Math.abs(Math.min(...ys) + 400)).toBeLessThan(30);
    for (const p of t.crestUtm) expect(Math.hypot((p[0] - cx) / 1000, (p[1] - cy) / 400)).toBeLessThan(0.8);
  });

  it("a rim reef that runs on in a band through every window never closes", () => {
    const s = scene((_dx, dy) => (Math.abs(dy) <= 12 ? (Math.abs(dy) <= 6 ? 2 : 1) : 0));
    for (const size of [60, 120, 200]) expect(() => traceScene(s.b03, s.b08, 32643, s.centre, size)).toThrow(NotClosed);
  });

  it("a window off the scene's image is NoData, not a TiffError", () => {
    const s = scene(oval(20, 20), 30, 160);
    expect(() => traceScene(s.b03, s.b08, 32643, s.centre, 80)).toThrow(NoData);
    expect(() => traceScene(s.b03, s.b08, 32643, s.centre, 80)).toThrow(/runs off the scene's 320×320 image/);
    // And with room on that side it traces.
    expect(traceScene(s.b03, s.b08, 32643, s.centre, 56).window.size).toBe(56);
  });
});

describe("insideMask: trace.ts `inside`, a row at a time", () => {
  it("answers as `inside` for every pixel, on a star, a ring through pixel centres and a sliver", () => {
    const star: Px[] = Array.from({ length: 14 }, (_, k) => {
      const t = (k / 14) * Math.PI * 2;
      const r = k % 2 === 0 ? 23 : 9.5;
      return [32 + r * Math.cos(t), 30 + r * Math.sin(t)] as Px;
    });
    const centres: Px[] = [[4.5, 4.5], [40.5, 4.5], [40.5, 20.5], [20.5, 20.5], [20.5, 50.5], [4.5, 50.5]];
    const sliver: Px[] = [[2, 30.5], [60, 30.5], [60, 31.5], [2, 30.7]];
    for (const ring of [star, centres, sliver]) {
      const mask = insideMask(ring, 64, 60);
      let n = 0;
      for (let y = 0; y < 60; y++)
        for (let x = 0; x < 64; x++) {
          expect(mask[y * 64 + x], `${x},${y}`).toBe(inside([x + 0.5, y + 0.5], ring) ? 1 : 0);
          n += mask[y * 64 + x] as number;
        }
      expect(n).toBeGreaterThan(0);
    }
  });
});
