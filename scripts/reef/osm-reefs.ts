// OpenStreetMap's reef round an island (R75; D269, D283; PLAN v2.6 "The reefs of every island, traced"): which mapped reef
// a traced reef is held to, found from the extract rather than listed by hand.
//
// **What counts as an island's reef.** A `natural=reef` polygon (a closed way, or the outer ring of a multipolygon
// relation, joined by scripts/chart/geometry.ts `assembleRings`) that surrounds the island's whole charted coastline,
// and of those the smallest. Smallest, because a reef mapped round one island sits inside any larger reef mapped round
// its neighbours; whole coastline, because a polygon that holds only the island's centre is a lagoon patch or a mapping
// error, not the island's reef. Rings tagged `place=archipelago` are the atolls' outlines (the chart's cloud, D246) and
// never an island's reef. PLAN v2.6 measured 125 of the 134 islands inside a reef of their own and 9 inside atoll-scale
// outlines only; for those 9 this finds nothing and the trace stands alone, which the record says.
//
// **Found, not listed** (the home's build-reef.ts names its relation and refuses if its members change). For 134 islands
// a hand list is 134 chances to copy a wrong id; found by rule, the relation and its member ways are written into each
// island's record, and the byte-for-byte rebuild fails the moment a later extract finds another (the same guard by other
// means). Rejected: the nearest reef by distance (a neighbour's reef is often nearer than the far side of one's own).
//
// **Shared reefs.** Where the reef found holds other charted islands too, they are listed; PLAN v2.6: each island's loop
// is traced from its own centroid and the sharing recorded.
//
// Pure apart from the extract's bytes, which the caller reads and hashes.
import { loadExtract, type Extract } from "../chart/extract.ts";
import { areaM2, assembleRings, inRing } from "../chart/geometry.ts";
import type { Tags } from "../chart/pbf.ts";
import type { ChartIsland, IslandId, LonLat } from "../../src/rules/chartData.ts";

/** A mapped reef polygon: where it came from in OSM, its outer ring (open), and its inner rings (open). */
export interface OsmReefRing {
  /** `w<id>` for a closed way, `r<id>` for a relation. */
  readonly element: string;
  readonly tags: Tags;
  /** The ways the outer ring was joined from (one, for a closed way). */
  readonly outerWays: readonly number[];
  readonly innerWays: readonly number[];
  readonly outer: readonly LonLat[];
  readonly areaM2: number;
}

export interface FoundReef {
  readonly reef: OsmReefRing;
  /** Other charted islands whose whole coastline the same reef surrounds (PLAN v2.6: the sharing recorded). */
  readonly sharedWith: readonly IslandId[];
}

/** Every `natural=reef` polygon in the extract that is not an atoll's outline, in a fixed order. */
export function reefRings(ex: Extract): OsmReefRing[] {
  const out: OsmReefRing[] = [];
  const ring = (refs: readonly number[]): LonLat[] => refs.slice(0, -1).map((r) => ex.coord(r));
  const ways = [...ex.ways.values()].sort((a, b) => a.id - b.id);
  for (const w of ways) {
    if (w.tags.natural !== "reef" || w.tags.place === "archipelago" || w.refs.length < 4 || w.refs[0] !== w.refs[w.refs.length - 1]) continue;
    const outer = ring(w.refs);
    out.push({ element: `w${w.id}`, tags: w.tags, outerWays: [w.id], innerWays: [], outer, areaM2: areaM2(outer) });
  }
  const relations = [...ex.relations].sort((a, b) => a.id - b.id);
  for (const r of relations) {
    if (r.tags.natural !== "reef" || r.tags.place === "archipelago") continue;
    const member = (role: string) =>
      r.members
        .filter((m) => m.type === "way" && m.role === role)
        .map((m) => ex.ways.get(m.ref))
        .filter((w): w is NonNullable<typeof w> => w !== undefined);
    const inner = member("inner").map((w) => w.id);
    for (const joined of assembleRings(member("outer").map((w) => ({ id: w.id, refs: w.refs }))).rings) {
      const outer = ring(joined.refs);
      out.push({ element: `r${r.id}`, tags: r.tags, outerWays: joined.wayIds, innerWays: inner, outer, areaM2: areaM2(outer) });
    }
  }
  return out;
}

/** The smallest reef ring surrounding every point of the island's coastline, and who else it holds; null if none does. */
export function reefOf(island: ChartIsland, rings: readonly OsmReefRing[], chart: readonly ChartIsland[]): FoundReef | null {
  const coast = island.ring as readonly LonLat[];
  const holds = (r: OsmReefRing, c: readonly LonLat[]): boolean => c.every((p) => inRing(p, r.outer));
  let best: OsmReefRing | null = null;
  for (const r of rings) if (holds(r, coast) && (best === null || r.areaM2 < best.areaM2)) best = r;
  if (best === null) return null;
  const found = best;
  const sharedWith = chart.filter((o) => o.id !== island.id && holds(found, o.ring as readonly LonLat[])).map((o) => o.id);
  return { reef: found, sharedWith };
}

/** Reads the extract once for every island asked about. */
export function osmReefs(pbf: Uint8Array): readonly OsmReefRing[] {
  return reefRings(loadExtract(pbf));
}
