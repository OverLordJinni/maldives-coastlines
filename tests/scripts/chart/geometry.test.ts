// The pipeline's geometry (scripts/chart/geometry.ts) and filter v1 (scripts/chart/filter.ts).
//
// Negative controls seen red once (L49), recorded in the CH0 commit: the shoelace sign flipped
// (which the first real run hit: every one of 1,351 islands read as clockwise); filter rule order
// changed so a small hand-listed ring reports "small"; Douglas–Peucker comparing with >= instead of >.
import { describe, expect, it } from "vitest";
import type { LonLat } from "../../../src/rules/chartData.ts";
import { assembleRings, areaM2, inRing, signedAreaM2, simplifyRing } from "../../../scripts/chart/geometry.ts";
import { filterV1, type Facts, type HandRow } from "../../../scripts/chart/filter.ts";

/** A square of `side` metres near Maavaidhoo's latitude, anticlockwise, closed. */
function square(side: number, lat0 = 6.5, lon0 = 73.05): LonLat[] {
  const dLat = side / 111_195.08;
  const dLon = dLat / Math.cos((lat0 * Math.PI) / 180);
  return [
    [lon0, lat0],
    [lon0 + dLon, lat0],
    [lon0 + dLon, lat0 + dLat],
    [lon0, lat0 + dLat],
    [lon0, lat0],
  ];
}

describe("ring assembly", () => {
  it("joins ways end to end, reversing one where needed, and reports a chain that never closes", () => {
    const { rings, open } = assembleRings([
      { id: 3, refs: [3, 4, 1] },
      { id: 1, refs: [1, 2, 3] },
      { id: 9, refs: [7, 8] },
      { id: 5, refs: [10, 11, 12, 10] },
    ]);
    expect(rings).toContainEqual({ wayIds: [5], refs: [10, 11, 12, 10] });
    const joined = rings.find((r) => r.wayIds.includes(1));
    expect(joined?.refs[0]).toBe(joined?.refs.at(-1));
    expect(new Set(joined?.refs)).toEqual(new Set([1, 2, 3, 4]));
    expect(open.map((o) => o.wayIds)).toEqual([[9]]);
  });

  it("a coastline that branches (a mapping error) is reported as open, never closed by a guess", () => {
    // Three way ends meet at node 3. The join takes the lowest id and cannot close; the build then
    // refuses (islands.ts), which is louder than a ring chosen by whichever branch came first.
    const { rings, open } = assembleRings([
      { id: 1, refs: [1, 2, 3] },
      { id: 2, refs: [6, 5, 3] },
      { id: 3, refs: [3, 4, 1] },
    ]);
    expect(rings).toEqual([]);
    expect(open.length).toBeGreaterThan(0);
  });

  it("reversing a member's direction changes no ring's points", () => {
    const a = assembleRings([{ id: 1, refs: [1, 2, 3] }, { id: 2, refs: [3, 4, 1] }]).rings[0];
    const b = assembleRings([{ id: 1, refs: [1, 2, 3] }, { id: 2, refs: [1, 4, 3] }]).rings[0];
    expect(new Set(a?.refs)).toEqual(new Set(b?.refs));
  });
});

describe("area and orientation", () => {
  it("a 100 m square is 10,000 m² to within 0.1 %, positive anticlockwise and negative clockwise", () => {
    const s = square(100);
    expect(Math.abs(areaM2(s) - 10_000)).toBeLessThan(10);
    expect(signedAreaM2(s)).toBeGreaterThan(0);
    expect(signedAreaM2([...s].reverse())).toBeLessThan(0);
  });

  it("point in ring", () => {
    const s = square(100);
    const [x0, y0] = s[0] as LonLat;
    const [x2, y2] = s[2] as LonLat;
    expect(inRing([(x0 + x2) / 2, (y0 + y2) / 2], s)).toBe(true);
    expect(inRing([x2 + 0.001, y2], s)).toBe(false);
  });
});

describe("Douglas–Peucker on a closed ring", () => {
  it("drops a point within tolerance, keeps one beyond it, and returns the ring open", () => {
    const s = square(1000);
    // A bump of 3 m and one of 8 m on the south edge.
    const dLat = (m: number): number => m / 111_195.08;
    const [a, b] = [s[0] as LonLat, s[1] as LonLat];
    const third: LonLat = [a[0] + (b[0] - a[0]) / 3, a[1] - dLat(3)];
    const twoThirds: LonLat = [a[0] + (2 * (b[0] - a[0])) / 3, a[1] - dLat(8)];
    const ring: LonLat[] = [a, third, twoThirds, ...s.slice(1)];
    const out = simplifyRing(ring, 5);
    expect(out).not.toContainEqual(third);
    expect(out).toContainEqual(twoThirds);
    expect(out[0]).not.toEqual(out.at(-1));
    expect(out).toHaveLength(5);
  });

  it("an islet narrower than the tolerance keeps three points: the simplifier never deletes an island", () => {
    const thin: LonLat[] = [
      [73, 6.5],
      [73.0001, 6.50001],
      [73.0002, 6.5],
      [73.0001, 6.49999],
      [73, 6.5],
    ];
    expect(simplifyRing(thin, 50)).toHaveLength(3);
  });
});

describe("filter v1 (D220): each excluded ring gets exactly one reason, first rule first", () => {
  const base: Facts = { id: "w1", areaM2: 50_000, anticlockwise: true, name: null, vegetation: 0, buildings: 0, notIslandTag: null };
  const hand = new Map<`w${number}` | `r${number}`, HandRow>([["w2", { id: "w2", name: "Thilafushi", reason: "Artificial", source: "x" }]]);

  it("keeps a ring with a name, mapped vegetation or buildings, saying which", () => {
    expect(filterV1({ ...base, name: "Maavaidhoo" }, hand)).toEqual({ keep: true, basis: ["name"] });
    expect(filterV1({ ...base, vegetation: 2, buildings: 1 }, hand)).toEqual({ keep: true, basis: ["vegetation", "buildings"] });
  });

  it("drops a bare ring, a small one, a sandbank, a built one, a hand-listed one and a clockwise one", () => {
    expect(filterV1(base, hand)).toMatchObject({ keep: false, rule: "bare" });
    expect(filterV1({ ...base, name: "x", areaM2: 999 }, hand)).toMatchObject({ keep: false, rule: "small" });
    expect(filterV1({ ...base, name: "x", areaM2: 1000 }, hand)).toMatchObject({ keep: true });
    expect(filterV1({ ...base, name: "x", notIslandTag: "natural=sand" }, hand)).toMatchObject({ keep: false, rule: "tag" });
    expect(filterV1({ ...base, name: "x", notIslandTag: "man_made=breakwater" }, hand)).toMatchObject({ keep: false, rule: "tag", reason: expect.stringContaining("built") });
    expect(filterV1({ ...base, id: "w2", name: "Thilafushi", buildings: 300 }, hand)).toEqual({ keep: false, rule: "hand", reason: "Artificial" });
    expect(filterV1({ ...base, name: "x", anticlockwise: false }, hand)).toMatchObject({ keep: false, rule: "inner" });
  });

  it("a hand-listed ring that is also small reports the hand reason, which is the one the owner reviews", () => {
    expect(filterV1({ ...base, id: "w2", areaM2: 10, notIslandTag: "natural=sand" }, hand)).toMatchObject({ rule: "hand" });
  });
});
