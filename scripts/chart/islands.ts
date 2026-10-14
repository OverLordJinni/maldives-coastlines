// Turns an extract into candidate islands: one per closed coastline ring, with everything filter v1
// (`filter.ts`) and the record need to decide about it, and nothing decided yet.
//
// **Identity** (PLAN Data model, IslandId): the OSM element tagged place=island/islet if there is
// one, else the lowest coastline way id in the ring. Found in this order, each deterministic:
//   1. a coastline way of the ring that carries the place tag itself (872 of 1,351 rings in the
//      2026-10-14 extract; Maavaidhoo's w19879672 and Kulhudhuffushi's w19879671 are this kind);
//   2. a place=island/islet relation with one of the ring's ways as an OUTER member (Malé, Hulhulé).
//      Inner members do not count: r13090978 is a reef with islets as its holes, and is not those
//      islets;
//   3. a separate place=island/islet way built from the ring's own nodes.
//   Ties go to the lowest id, so the same extract always gives the same ids.
//
// **What each candidate carries for the filter**, all read from OSM and none inferred:
//   - names: `name` and `name:en` from the ring's ways, its place element, or a place=island/islet
//     node or way lying inside the ring;
//   - vegetation: a polygon tagged natural=wood|scrub|grassland|heath or landuse=forest|farmland|
//     meadow|orchard with its centroid or any vertex inside the ring, a natural=tree node inside it,
//     or the tag on the ring's own ways or place element;
//   - buildings: building=* (not "no") ways and relations with their first node inside the ring;
//   - tags that say "this is not an island": natural=sand|shoal|reef, landcover=sand or any
//     man_made=*, on the ring's ways or its place element (filter.ts rule 3 says why man_made). `surface=sand` is NOT one of them: it describes the ground,
//     and r8419061 (Mathiveri, an inhabited island) carries it;
//   - an aeroway inside the ring (for the record only: Q58 asked whether Kulhudhuffushi has one).
//
// What this cannot see: whether OSM's vegetation mapping is complete (PLAN Risk 20: about 590 of
// 1,351 rings carry any), and whether land is reclaimed, which OSM does not tag. The hand list in
// `excluded.json` is the answer to the second; the owner's AC136 review is the answer to both.
import { assembleRings, areaM2, bboxOf, inBbox, inRing, signedAreaM2, type Bbox } from "./geometry.ts";
import { isPlace, type Extract, type ExtractWay } from "./extract.ts";
import type { IslandId, LonLat } from "../../src/rules/chartData.ts";
import type { Tags } from "./pbf.ts";

export interface Candidate {
  readonly id: IslandId;
  readonly wayIds: readonly number[];
  /** Closed: first point = last, full resolution, degrees. */
  readonly ring: readonly LonLat[];
  readonly bbox: Bbox;
  readonly areaM2: number;
  /** False for a ring whose land is outside it (a lagoon or pond with a coastline round it). */
  readonly anticlockwise: boolean;
  readonly name: string | null;
  readonly nameEn: string | null;
  readonly vegetation: number;
  readonly buildings: number;
  readonly aeroways: number;
  /** "natural=sand" and the like (see the header), or null. */
  readonly notIslandTag: string | null;
}

const VEG_NATURAL = new Set(["wood", "scrub", "grassland", "heath"]);
const VEG_LANDUSE = new Set(["forest", "farmland", "meadow", "orchard"]);
const NOT_ISLAND_NATURAL = new Set(["sand", "shoal", "reef"]);

export const isVegetation = (t: Tags): boolean => VEG_NATURAL.has(t.natural ?? "") || VEG_LANDUSE.has(t.landuse ?? "");
const isBuilding = (t: Tags): boolean => t.building !== undefined && t.building !== "no";

export function notIslandTag(t: Tags): string | null {
  if (t.natural !== undefined && NOT_ISLAND_NATURAL.has(t.natural)) return `natural=${t.natural}`;
  if (t.landcover === "sand") return "landcover=sand";
  if (t.man_made !== undefined) return `man_made=${t.man_made}`;
  return null;
}

/** A uniform grid over ring bounding boxes, so a point is tested against a handful of rings, not 1,351. */
class RingIndex {
  private readonly cells = new Map<string, number[]>();
  private static readonly SIZE = 0.05;
  private readonly boxes: readonly Bbox[];

  constructor(boxes: readonly Bbox[]) {
    this.boxes = boxes;
    boxes.forEach((b, i) => {
      for (let x = Math.floor(b.minX / RingIndex.SIZE); x <= Math.floor(b.maxX / RingIndex.SIZE); x++) {
        for (let y = Math.floor(b.minY / RingIndex.SIZE); y <= Math.floor(b.maxY / RingIndex.SIZE); y++) {
          const k = `${x},${y}`;
          const list = this.cells.get(k);
          if (list) list.push(i);
          else this.cells.set(k, [i]);
        }
      }
    });
  }

  near(p: LonLat): number[] {
    const list = this.cells.get(`${Math.floor(p[0] / RingIndex.SIZE)},${Math.floor(p[1] / RingIndex.SIZE)}`) ?? [];
    return list.filter((i) => inBbox(p, this.boxes[i] as Bbox));
  }
}

function centroid(points: readonly LonLat[]): LonLat {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

function firstName(tagSets: readonly Tags[], key: string): string | null {
  for (const t of tagSets) {
    const v = t[key];
    if (v !== undefined && v.trim() !== "") return v;
  }
  return null;
}

export function findCandidates(ex: Extract): Candidate[] {
  const ways = [...ex.ways.values()];
  const coastIds = new Set(ways.filter((w) => w.tags.natural === "coastline").map((w) => w.id));
  const { rings, open } = assembleRings(ways.filter((w) => coastIds.has(w.id)));
  // The 2026-10-14 extract closes every chain. An open one would be a coastline cut at the extract's
  // edge: refused, because the ring it belongs to cannot be measured, filtered or drawn.
  if (open.length > 0) throw new RangeError(`${open.length} coastline chains do not close (first: ways ${open[0]?.wayIds.join(",")})`);

  const ringOfWay = new Map<number, number>();
  rings.forEach((r, i) => r.wayIds.forEach((w) => ringOfWay.set(w, i)));
  const points = rings.map((r) => r.refs.map((n) => ex.coord(n)));
  const boxes = points.map(bboxOf);
  const index = new RingIndex(boxes);
  const nodeSets = rings.map((r) => new Set(r.refs));

  const place: ({ id: IslandId; tags: Tags } | null)[] = rings.map(() => null);
  const extraNameTags: Tags[][] = rings.map(() => []);
  const vegetation = rings.map(() => 0);
  const buildings = rings.map(() => 0);
  const aeroways = rings.map(() => 0);

  const claim = (i: number, id: IslandId, tags: Tags): void => {
    const cur = place[i] ?? null;
    // Lower id wins within a kind; a way on the ring (kind 1) is found first and is never displaced.
    if (cur === null || (cur.id.charAt(0) === id.charAt(0) && Number(id.slice(1)) < Number(cur.id.slice(1)))) place[i] = { id, tags };
  };

  // 1. The ring's own ways.
  rings.forEach((r, i) => {
    for (const w of [...r.wayIds].sort((a, b) => a - b)) {
      const t = (ex.ways.get(w) as ExtractWay).tags;
      if (isPlace(t)) {
        claim(i, `w${w}`, t);
        break;
      }
    }
  });
  // 2. Relations with an outer member on the ring.
  for (const rel of [...ex.relations].sort((a, b) => a.id - b.id)) {
    if (!isPlace(rel.tags)) continue;
    const hit = new Set<number>();
    for (const m of rel.members) if (m.type === "way" && (m.role === "outer" || m.role === "") && ringOfWay.has(m.ref)) hit.add(ringOfWay.get(m.ref) as number);
    for (const i of hit) if (place[i] === null || place[i]?.id[0] === "r") claim(i, `r${rel.id}`, rel.tags);
  }
  // 3. Separate place ways made of the ring's nodes; otherwise, inside the ring, a name source only.
  for (const w of ways) {
    if (!isPlace(w.tags) || coastIds.has(w.id)) continue;
    const pts = w.refs.map((n) => ex.coord(n));
    for (const i of index.near(centroid(pts))) {
      if (!inRing(centroid(pts), points[i] as LonLat[])) continue;
      if (place[i] === null && w.refs.every((n) => (nodeSets[i] as Set<number>).has(n))) place[i] = { id: `w${w.id}`, tags: w.tags };
      else (extraNameTags[i] as Tags[]).push(w.tags);
    }
  }
  for (const n of ex.placeNodes) for (const i of index.near(n.at)) if (inRing(n.at, points[i] as LonLat[])) (extraNameTags[i] as Tags[]).push(n.tags);

  // Vegetation, buildings and aeroways, by point in ring.
  const mark = (counts: number[], pts: readonly LonLat[], allVertices: boolean): void => {
    const hits = new Set<number>();
    const test = (p: LonLat): void => {
      for (const i of index.near(p)) if (!hits.has(i) && inRing(p, points[i] as LonLat[])) hits.add(i);
    };
    test(centroid(pts));
    if (allVertices) for (const p of pts) test(p);
    for (const i of hits) counts[i] = (counts[i] as number) + 1;
  };
  const wayPoints = (w: ExtractWay): LonLat[] => w.refs.map((n) => ex.coord(n));
  for (const w of ways) {
    if (coastIds.has(w.id)) continue;
    if (isVegetation(w.tags)) mark(vegetation, wayPoints(w), true);
    if (isBuilding(w.tags)) mark(buildings, [ex.coord(w.refs[0] as number)], false);
    if (w.tags.aeroway === "aerodrome" || w.tags.aeroway === "runway") mark(aeroways, wayPoints(w), true);
  }
  for (const rel of ex.relations) {
    const veg = isVegetation(rel.tags);
    const bld = isBuilding(rel.tags);
    const aero = rel.tags.aeroway === "aerodrome" || rel.tags.aeroway === "runway";
    if (!veg && !bld && !aero) continue;
    for (const m of rel.members) {
      if (m.type !== "way" || m.role === "inner") continue;
      const w = ex.ways.get(m.ref);
      if (w === undefined || coastIds.has(w.id)) continue;
      if (veg) mark(vegetation, wayPoints(w), true);
      if (bld) mark(buildings, [ex.coord(w.refs[0] as number)], false);
      if (aero) mark(aeroways, wayPoints(w), true);
    }
  }
  for (const t of ex.trees) for (const i of index.near(t.at)) if (inRing(t.at, points[i] as LonLat[])) vegetation[i] = (vegetation[i] as number) + 1;

  // A place relation whose outer members lie on two rings would name both: the larger ring keeps the
  // relation's id, the others fall back to their lowest way id, so ids stay unique.
  const holders = new Map<IslandId, number>();
  place.forEach((p, i) => {
    if (p === null) return;
    const other = holders.get(p.id);
    if (other === undefined) return void holders.set(p.id, i);
    const area = (k: number): number => areaM2(points[k] as LonLat[]);
    const [keep, drop] = area(i) > area(other) ? [i, other] : [other, i];
    holders.set(p.id, keep);
    place[drop] = null;
  });

  return rings.map((r, i): Candidate => {
    const ownTags = r.wayIds.map((w) => (ex.ways.get(w) as ExtractWay).tags);
    const p = place[i];
    const tagSets = [...(p ? [p.tags] : []), ...ownTags, ...(extraNameTags[i] as Tags[])];
    const selfTags = [...(p ? [p.tags] : []), ...ownTags];
    const pts = points[i] as LonLat[];
    return {
      id: p?.id ?? `w${Math.min(...r.wayIds)}`,
      wayIds: r.wayIds,
      ring: pts,
      bbox: boxes[i] as Bbox,
      areaM2: areaM2(pts),
      anticlockwise: signedAreaM2(pts) > 0,
      name: firstName(tagSets, "name"),
      nameEn: firstName(tagSets, "name:en"),
      vegetation: (vegetation[i] as number) + (selfTags.some(isVegetation) ? 1 : 0),
      buildings: (buildings[i] as number) + (selfTags.some(isBuilding) ? 1 : 0),
      aeroways: aeroways[i] as number,
      notIslandTag: selfTags.map(notIslandTag).find((x) => x !== null) ?? null,
    };
  });
}
