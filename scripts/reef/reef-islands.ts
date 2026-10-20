// Which islands' reefs build-reefs.ts traces, and where their inputs are kept (RF; D375, D380, D388; PLAN v2.6). The one
// hand-kept list of the reefs' build: everything else (the window, the scene, OSM's reef, the thresholds) is found by rule
// and written into each island's record.
//
// **RF1** is the three islands the crossing and the ending land on (PLAN v2.6: "Kumundhoo, Kulhudhuffushi and its kulhi,
// Kandoodhoo"). RF2 adds the other 130 here, with the scenes it fetches. The home island is not in this list: its reef
// ships as src/assets/reef/reef.json and is rebuilt by build-reef.ts, never re-traced (PLAN v2.6).
//
// Names are for the record (reefs-manifest.json, never imported by the app) and this file; the data carries ids only
// (D221, AC138).
import type { IslandId } from "../../src/rules/chartData.ts";

export interface ReefIsland {
  readonly id: IslandId;
  readonly name: string;
  readonly part: "RF1" | "RF2";
  /** Kulhudhuffushi's kulhi (D380, D388): traced too, from the Landsat scene build-reefs.ts chooses by rule (kulhi.ts). */
  readonly kulhi?: true;
}

export const REEF_ISLANDS: readonly ReefIsland[] = [
  { id: "w122946807", name: "Kumundhoo", part: "RF1" },
  { id: "w19879671", name: "Kulhudhuffushi", part: "RF1", kulhi: true },
  // Noonu's Kandoodhoo (the chart also holds another Kandoodhoo, w19883089, in Thaa).
  { id: "w19879485", name: "Kandoodhoo", part: "RF1" },
];

/** The OpenStreetMap extract, as the chart's and the home reef's builds read it. */
export const EXTRACT_DIR = "osm-2026-10-14";

/**
 * The candidates every island's scene is chosen from (scenes.ts): every Sentinel-2 L2A scene over RF1's islands sensed in
 * the year to 2026-10-20 with under 10 % of its tile cloudy, by Element84 Earth Search, the source of the home's scene.
 * Their scene classification bands and STAC items are kept here. The cap is a cost bound, not a finding: scenes with more
 * of their tile cloudy were not screened (32 of 43NBH's 120 scenes of the year and 22 of 43NCG's 77 were), so a clearer
 * window among them is possible and unlooked-at.
 */
export const CANDIDATES = { dir: "sentinel2-scl-candidates-2026-10-20", sensedFrom: "2025-10-20", sensedTo: "2026-10-20", maxTileCloud: 10 } as const;

/**
 * Where each scene a reef may be traced from is kept whole (B02, B03, B04, B08, SCL and its item; PROVENANCE.md beside
 * them). A scene the rule chooses that is not listed here stops the build with "could not run", naming the scene.
 */
export const SCENE_DIRS: Readonly<Record<string, string>> = {
  S2B_43NBH_20251106_0_L2A: "sentinel2-43NBH-2025-11-06",
  S2C_43NBH_20251111_0_L2A: "sentinel2-43NBH-2025-11-11",
  S2C_43NBH_20260110_0_L2A: "sentinel2-43NBH-2026-01-10",
  S2C_43NCG_20260110_0_L2A: "sentinel2-43NCG-2026-01-10",
};

/** Sentinel-2's 2017–2019 scenes over Kulhudhuffushi, kept as the evidence that none of them sees the island (kulhi.ts). */
export const EARLY_DIR = "sentinel2-early-scl-2026-10-20";

/**
 * Every Landsat Collection 2 Level-2 scene over Kulhudhuffushi with under 30 % cloud, 1982–2021 (Microsoft Planetary
 * Computer's copy of the USGS archive): their quality bands and STAC items, which the kulhi's scene is chosen from.
 */
export const LANDSAT_CANDIDATES = "landsat-qa-candidates-2026-10-20";

/** Where each Landsat scene the kulhi may be traced from is kept whole (bands 1–5, QA_PIXEL, MTL and its item). */
export const LANDSAT_DIRS: Readonly<Record<string, string>> = {
  LT05_L2SR_146055_19970415_02_T1: "landsat-1997-04-15",
};

/**
 * The owner's verdicts on batches of traced reefs (D389, AC163), and the AC162 gaps he accepted with them (D392). A verdict
 * holds for the batch he saw and nothing else: its reefs id names the extract, the scenes and the method, and each accepted
 * gap names the area he saw, so a rebuild that traces anything differently is not covered and is refused again until he
 * looks again. Rejected: a per-island "AC162 waived" switch (it would outlive the trace it was given for); widening AC162's
 * tolerance (D392 keeps 10 % as the rule and records the exceptions).
 */
export interface Verdict {
  readonly decision: string;
  readonly date: string;
  readonly reefsId: string;
  /** Where he saw it: the contact sheet, and the commit its script was run at. */
  readonly seenOn: string;
  /** What he said of the batch (D392: "the owner judges all three traced reefs right on the contact sheet"). */
  readonly verdict: string;
  /** Islands whose traced reef he accepted beyond AC162's 10 % of OSM's area, with the gap he saw, in percent. */
  readonly acceptsAreaGap: Readonly<Record<string, number>>;
}

export const VERDICTS: readonly Verdict[] = [
  {
    decision: "D392",
    date: "2026-10-20",
    reefsId: "osm-858582dd.s2-ecc71584.m1",
    seenOn: "the contact sheet archive/rf1-2026-10-20/index.html, made at commit 5562e12; not yet on a build",
    verdict: "all three traced reefs right",
    acceptsAreaGap: { w122946807: 10.86, w19879485: 57.31 },
  },
];
