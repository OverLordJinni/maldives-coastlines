// Loads what the chart needs from an OSM PBF extract, in two passes over the file.
//
// A PBF lists nodes, then ways, then relations, so which nodes a relation needs is known only after
// the nodes have gone by. Pass 1 keeps every way and every relation (69,111 ways and 1,209 relations
// in the 2026-10-14 extract: a few megabytes of ids); pass 2 keeps the coordinates of the nodes those
// reference, plus the tagged nodes the filter reads (place names, trees). Rejected: keeping all
// 468,232 node coordinates in one pass, which is simpler and would also work at this size, but grows
// with every building anyone maps, and the second pass costs about 100 ms.
import { readPbf, type PbfMember, type Tags } from "./pbf.ts";
import type { LonLat } from "../../src/rules/chartData.ts";

export interface ExtractWay {
  readonly id: number;
  readonly refs: readonly number[];
  readonly tags: Tags;
}

export interface ExtractRelation {
  readonly id: number;
  readonly members: readonly PbfMember[];
  readonly tags: Tags;
}

export interface TaggedPoint {
  readonly id: number;
  readonly at: LonLat;
  readonly tags: Tags;
}

export interface Extract {
  readonly ways: ReadonlyMap<number, ExtractWay>;
  readonly relations: readonly ExtractRelation[];
  /** Nodes tagged place=island|islet (a name for a ring that has none of its own). */
  readonly placeNodes: readonly TaggedPoint[];
  /** Nodes tagged natural=tree (mapped vegetation, PLAN filter v1). */
  readonly trees: readonly TaggedPoint[];
  /** Coordinates of every node any kept way references, in degrees. */
  coord(node: number): LonLat;
}

export const isPlace = (t: Tags): boolean => t.place === "island" || t.place === "islet";

/** Reads the two passes. Throws (via `readPbf`) on anything it cannot read, never skipping a block. */
export function loadExtract(file: Uint8Array): Extract {
  const ways = new Map<number, ExtractWay>();
  const relations: ExtractRelation[] = [];
  readPbf(file, {
    way: (w) => void ways.set(w.id, w),
    relation: (r) => void relations.push(r),
  });

  const needed = new Set<number>();
  for (const w of ways.values()) for (const r of w.refs) needed.add(r);

  const coords = new Map<number, LonLat>();
  const placeNodes: TaggedPoint[] = [];
  const trees: TaggedPoint[] = [];
  readPbf(file, {
    node: (n) => {
      const at: LonLat = [n.lonE9 / 1e9, n.latE9 / 1e9];
      if (needed.has(n.id)) coords.set(n.id, at);
      if (isPlace(n.tags)) placeNodes.push({ id: n.id, at, tags: n.tags });
      if (n.tags.natural === "tree") trees.push({ id: n.id, at, tags: n.tags });
    },
  });

  return {
    ways,
    relations,
    placeNodes,
    trees,
    coord(node: number): LonLat {
      const c = coords.get(node);
      // A way referencing a node the extract does not hold is what an extract's clipped edge looks
      // like. Refused here so the caller decides, rather than a ring drawn through (0, 0).
      if (c === undefined) throw new RangeError(`node ${node} is referenced and not in the extract`);
      return c;
    },
  };
}
