// Filter v1 (PLAN CH0, D220: "only natural islands with plants count; no sandbanks, no reclaimed
// land"). Pure: it decides from a candidate's recorded facts and the hand list, and nothing else.
//
// Why a deterministic rule over tags, and not a classifier (imagery, NDVI, a model): every island the
// chart leaves out has to be explained to the owner in one line (AC136's review), and re-derived from
// the record years later (R57). "No name, no mapped vegetation and no buildings" can be checked by
// anyone with the extract; "the model scored it 0.41" cannot. The cost is honest and recorded: OSM's
// vegetation mapping is incomplete (PLAN Risk 20), so some real islands with plants are left out for
// having nothing mapped, and some sandbanks with a name are kept. Both show in the manifest: every
// exclusion with its reason, and every island kept on its name alone, so the owner reviews lists and
// not 900 outlines.
//
// The rules, first match wins, so each excluded ring has exactly one reason:
//   1. inner     a ring drawn clockwise: land outside it (a lagoon or pond), not an island
//   2. hand      on `excluded.json`, the hand-kept list of reclaimed or artificial islands, which OSM
//                does not tag (PLAN Risk 20); each row has its reason and source
//   3. tag       the ring (its ways or its place element) says it is not an island: natural=sand,
//                shoal or reef, landcover=sand, or any man_made=* (a breakwater, a quay, an
//                artificial islet). man_made is an addition to PLAN's "sand, shoal or reef": D220
//                excludes artificial land, and these rings say so themselves
//   4. small     under 1,000 m² (PLAN filter v1)
//   5. bare      no name, no mapped vegetation and no buildings
import type { IslandId } from "../../src/rules/chartData.ts";

export const FILTER_VERSION = 1;
export const MIN_AREA_M2 = 1000;

export interface Facts {
  readonly id: IslandId;
  readonly areaM2: number;
  readonly anticlockwise: boolean;
  readonly name: string | null;
  readonly vegetation: number;
  readonly buildings: number;
  readonly notIslandTag: string | null;
}

export interface HandRow {
  readonly id: IslandId;
  readonly name: string;
  readonly reason: string;
  readonly source: string;
}

export type Rule = "inner" | "hand" | "tag" | "small" | "bare";

export type Basis = "name" | "vegetation" | "buildings";

export type Verdict = { readonly keep: true; readonly basis: readonly Basis[] } | { readonly keep: false; readonly rule: Rule; readonly reason: string };

export function filterV1(c: Facts, hand: ReadonlyMap<IslandId, HandRow>): Verdict {
  if (!c.anticlockwise) return { keep: false, rule: "inner", reason: "drawn clockwise: land lies outside it (a lagoon or pond inside an island), not an island" };
  const h = hand.get(c.id);
  if (h !== undefined) return { keep: false, rule: "hand", reason: h.reason };
  if (c.notIslandTag !== null) return { keep: false, rule: "tag", reason: `tagged ${c.notIslandTag}: ${c.notIslandTag.startsWith("man_made") ? "built, not an island" : "a sandbank or reef, not an island"}` };
  if (c.areaM2 < MIN_AREA_M2) return { keep: false, rule: "small", reason: `${Math.round(c.areaM2)} m², under ${MIN_AREA_M2.toLocaleString("en")} m²` };
  const basis: Basis[] = [];
  if (c.name !== null) basis.push("name");
  if (c.vegetation > 0) basis.push("vegetation");
  if (c.buildings > 0) basis.push("buildings");
  if (basis.length === 0) return { keep: false, rule: "bare", reason: "no name, no mapped vegetation and no buildings" };
  return { keep: true, basis };
}
