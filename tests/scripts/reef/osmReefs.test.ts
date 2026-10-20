// OpenStreetMap's reef round an island (scripts/reef/osm-reefs.ts), on an extract this test builds by hand: the smallest
// reef polygon round the island's whole coast is its reef, an atoll's outline never is, a relation's outer ring counts as a
// closed way does, and other islands on the same reef are listed.
//
// Seen red (L49), each once and reverted: `reefOf` taking the largest ring instead of the smallest (the own-reef case red);
// the `place=archipelago` exclusion removed (the ring list and the off-every-reef case red: island D, inside the atoll,
// found the atoll's own reef-tagged outline as its reef).
import { describe, expect, it } from "vitest";
import type { Extract, ExtractRelation, ExtractWay } from "../../../scripts/chart/extract.ts";
import { reefOf, reefRings } from "../../../scripts/reef/osm-reefs.ts";
import type { ChartIsland, IslandId, LonLat } from "../../../src/rules/chartData.ts";

/** A square ring of nodes round (cx, cy), half-side h degrees, as node ids from `base`. */
function square(base: number, cx: number, cy: number, h: number): { nodes: [number, LonLat][]; refs: number[] } {
  const pts: LonLat[] = [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]];
  const nodes = pts.map((p, i) => [base + i, p] as [number, LonLat]);
  return { nodes, refs: [...nodes.map(([id]) => id), base] };
}

function extract(): Extract {
  const coords = new Map<number, LonLat>();
  const ways = new Map<number, ExtractWay>();
  const relations: ExtractRelation[] = [];
  const add = (id: number, s: ReturnType<typeof square>, tags: Record<string, string>): void => {
    for (const [n, p] of s.nodes) coords.set(n, p);
    ways.set(id, { id, refs: s.refs, tags });
  };
  // Island A's own reef (a closed way), and a bigger reef relation holding A and B; an atoll outline round everything.
  add(10, square(100, 73.0, 6.5, 0.004), { natural: "reef" });
  add(20, square(200, 73.006, 6.5, 0.012), {});
  relations.push({ id: 7, members: [{ type: "way", ref: 20, role: "outer" }], tags: { type: "multipolygon", natural: "reef" } });
  add(30, square(300, 73.0, 6.5, 0.2), { natural: "atoll", place: "archipelago" });
  add(31, square(400, 73.0, 6.5, 0.3), { natural: "reef", place: "archipelago" });
  // A reef round only part of island D (its centre inside, its coast not).
  add(40, square(500, 73.1, 6.6, 0.0005), { natural: "reef" });
  return {
    ways,
    relations,
    placeNodes: [],
    trees: [],
    coord(n: number): LonLat {
      const c = coords.get(n);
      if (c === undefined) throw new RangeError(`node ${n}`);
      return c;
    },
  };
}

const island = (id: string, cx: number, cy: number, h: number): ChartIsland => ({ id: id as IslandId, atoll: "test", ring: square(0, cx, cy, h).nodes.map(([, p]) => p) });
const A = island("w1", 73.0, 6.5, 0.002);
const B = island("w2", 73.012, 6.5, 0.002);
const C = island("w3", 73.5, 6.9, 0.002);
const D = island("w4", 73.1, 6.6, 0.002);
const chart = [A, B, C, D];

describe("the reef OpenStreetMap maps round an island", () => {
  const rings = reefRings(extract());

  it("reads closed reef ways and reef relations' outer rings, and never an atoll's outline", () => {
    expect(rings.map((r) => r.element).sort()).toEqual(["r7", "w10", "w40"]);
    expect(rings.find((r) => r.element === "r7")?.outerWays).toEqual([20]);
  });

  it("is the smallest polygon round the island's whole coast", () => {
    const a = reefOf(A, rings, chart);
    expect(a?.reef.element).toBe("w10");
    expect(a?.sharedWith).toEqual([]);
  });

  it("lists the other islands a shared reef holds", () => {
    const b = reefOf(B, rings, chart);
    expect(b?.reef.element).toBe("r7");
    expect(b?.sharedWith).toEqual(["w1"]);
  });

  it("is none for an island off every reef, or one whose coast a reef only partly holds", () => {
    expect(reefOf(C, rings, chart)).toBeNull();
    expect(reefOf(D, rings, chart)).toBeNull();
  });
});
