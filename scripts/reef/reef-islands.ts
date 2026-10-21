// Which islands' reefs build-reefs.ts traces, and where their inputs are kept (RF; D375, D380, D388; PLAN v2.6). The one
// hand-kept list of the reefs' build: everything else (the window, the scene, OSM's reef, the thresholds) is found by rule
// and written into each island's record.
//
// **RF1** is the three islands the crossing and the ending land on (PLAN v2.6: "Kumundhoo, Kulhudhuffushi and its kulhi,
// Kandoodhoo"). **RF2** is the other 130 of D373's 134 landable islands, by atoll north to south (Haa Dhaalu, Shaviyani,
// Noonu, Raa) and within each by centroid latitude, the order the batches landed in. The home island is not in this list:
// its reef ships as src/assets/reef/reef.json and is rebuilt by build-reef.ts, never re-traced (PLAN v2.6).
//
// **Why a list, when src/rules/landable.ts derives the set from the chart.** This file goes public with the build (D294,
// public-bundle.ts), and landable.ts and its tuning are game code that does not (D257). So the ids are listed here, and
// tests/scripts/reef/reefIslands.test.ts (which stays in the game repository) holds the list to exactly landable()'s 134
// less the home island: a re-extract that moves the band fails there, by id. Rejected: importing landable.ts into the
// build (the public copy would not run); a second copy of the band's rule here (two bodies of one rule, L6).
//
// Names are for the record (reefs-manifest.json, never imported by the app), the review figure and this file; the data
// carries ids only (D221, AC138). An RF2 name is OpenStreetMap's `name` tag where it is in Latin letters, else its
// `name:en`, else null: 42 of the 130 have neither, and a name made up here would be a claim nobody can check. Some are
// resorts' names, as OSM has them.
import type { IslandId } from "../../src/rules/chartData.ts";

/** The two batches the owner judges (D389, D394): RF1's three, then RF2's 130. */
export type Part = "RF1" | "RF2";
export const PARTS: readonly Part[] = ["RF1", "RF2"];

export interface ReefIsland {
  readonly id: IslandId;
  /** OpenStreetMap's name for it (the header), or null where it has none in Latin letters. */
  readonly name: string | null;
  readonly part: Part;
  /** Kulhudhuffushi's kulhi (D380, D388): traced too, from the Landsat scene build-reefs.ts chooses by rule (kulhi.ts). */
  readonly kulhi?: true;
}

/** How an island is named in messages and on the review figure: its name, or its chart id where OSM gives it none. */
export const labelOf = (i: { readonly id: string; readonly name: string | null }): string => i.name ?? `unnamed ${i.id}`;

export const REEF_ISLANDS: readonly ReefIsland[] = [
  { id: "w122946807", name: "Kumundhoo", part: "RF1" },
  { id: "w19879671", name: "Kulhudhuffushi", part: "RF1", kulhi: true },
  // Noonu's Kandoodhoo (the chart also holds another Kandoodhoo, w19883089, in Thaa).
  { id: "w19879485", name: "Kandoodhoo", part: "RF1" },
  // RF2. Haa Dhaalu (8), north to south by centroid.
  { id: "w19879540", name: "Keylakunu", part: "RF2" },
  { id: "w19879606", name: "Kattalafushi", part: "RF2" },
  { id: "w19879423", name: "Vaikaradhoo", part: "RF2" },
  { id: "w19879344", name: "Neykurendhoo", part: "RF2" },
  { id: "w19879255", name: "Vaikaramuraidhoo", part: "RF2" },
  { id: "w19879365", name: "Makunudhoo", part: "RF2" },
  { id: "w19879393", name: null, part: "RF2" },
  { id: "w19879290", name: null, part: "RF2" },
  // Shaviyani (40), north to south by centroid.
  { id: "w19879744", name: "Kakaaeriyadhoo", part: "RF2" },
  { id: "w19879527", name: "Neyo", part: "RF2" },
  { id: "w19879536", name: "Kanditheemu", part: "RF2" },
  { id: "w19879603", name: null, part: "RF2" },
  { id: "w19879462", name: "Noomaraa", part: "RF2" },
  { id: "w19879433", name: "Goidhoo", part: "RF2" },
  { id: "w19879722", name: null, part: "RF2" },
  { id: "w19879705", name: "Feydhoo", part: "RF2" },
  { id: "w19879633", name: "Feevah", part: "RF2" },
  { id: "w19879561", name: "Bileffahi", part: "RF2" },
  { id: "w19879434", name: "Foakaidhoo", part: "RF2" },
  { id: "w19879709", name: null, part: "RF2" },
  { id: "w19879688", name: "Gaakoshinbi", part: "RF2" },
  { id: "w19879544", name: "Milandhoo", part: "RF2" },
  { id: "w19879348", name: "Narudhoo", part: "RF2" },
  { id: "w19879420", name: "Maakandoodhoo", part: "RF2" },
  { id: "w19879481", name: "Migoodhoo", part: "RF2" },
  { id: "w19879449", name: "Maroshi", part: "RF2" },
  { id: "w19879502", name: null, part: "RF2" },
  { id: "w19879611", name: "Medhukuburudhoo", part: "RF2" },
  { id: "w19879662", name: "Farukolhu", part: "RF2" },
  { id: "w19879670", name: "Hirubadhoo", part: "RF2" },
  { id: "w19879361", name: "Lhaimagu", part: "RF2" },
  { id: "w19879369", name: "Funadhoo", part: "RF2" },
  { id: "w19879564", name: "Kanbaalifaru", part: "RF2" },
  { id: "w19879598", name: "Firun'baidhoo", part: "RF2" },
  { id: "w19879644", name: null, part: "RF2" },
  { id: "w19879354", name: "Vagaru", part: "RF2" },
  { id: "w19879341", name: null, part: "RF2" },
  { id: "w483093186", name: "Ekasdhoo", part: "RF2" },
  { id: "w19879318", name: null, part: "RF2" },
  { id: "w19879458", name: null, part: "RF2" },
  { id: "w19879427", name: "Komandoo", part: "RF2" },
  { id: "w19879402", name: "Maaungoodhoo", part: "RF2" },
  { id: "w482510935", name: null, part: "RF2" },
  { id: "w19879601", name: null, part: "RF2" },
  { id: "w19879741", name: null, part: "RF2" },
  { id: "w19879681", name: "Keekimini", part: "RF2" },
  { id: "w19879416", name: null, part: "RF2" },
  { id: "w19879574", name: null, part: "RF2" },
  // Noonu (59), north to south by centroid.
  { id: "w19879698", name: "Kudalhaimendhoo", part: "RF2" },
  { id: "w19879478", name: null, part: "RF2" },
  { id: "w19879597", name: null, part: "RF2" },
  { id: "w19879556", name: "Henbadhoo", part: "RF2" },
  { id: "w19879680", name: null, part: "RF2" },
  { id: "w19879692", name: null, part: "RF2" },
  { id: "w19879474", name: "Kendhikulhudhoo", part: "RF2" },
  { id: "w19879439", name: null, part: "RF2" },
  { id: "w19879747", name: null, part: "RF2" },
  { id: "w19879716", name: null, part: "RF2" },
  { id: "w19879612", name: "Maalhendhoo", part: "RF2" },
  { id: "w19879560", name: null, part: "RF2" },
  { id: "w19879516", name: "Kuda-funafaru", part: "RF2" },
  { id: "w19879473", name: "Kudafari", part: "RF2" },
  { id: "w19879426", name: "Landhoo", part: "RF2" },
  { id: "w19879338", name: "Kuredhivaru", part: "RF2" },
  { id: "w19879331", name: null, part: "RF2" },
  { id: "w19879291", name: "Kadinmahuraa", part: "RF2" },
  { id: "w19879244", name: null, part: "RF2" },
  { id: "w19879646", name: "Farumuli", part: "RF2" },
  { id: "w19879529", name: null, part: "RF2" },
  { id: "w19879558", name: null, part: "RF2" },
  { id: "w19879586", name: "Fushivelavaru", part: "RF2" },
  { id: "w19879285", name: "Maafaru", part: "RF2" },
  { id: "w19879390", name: null, part: "RF2" },
  { id: "w19879491", name: "Lhohi", part: "RF2" },
  { id: "w19879417", name: null, part: "RF2" },
  { id: "w19879444", name: null, part: "RF2" },
  { id: "w19879550", name: null, part: "RF2" },
  { id: "w19879596", name: "Orivaru", part: "RF2" },
  { id: "w19879590", name: null, part: "RF2" },
  { id: "w19879403", name: null, part: "RF2" },
  { id: "w19879424", name: "Miladhoo", part: "RF2" },
  { id: "w399666153", name: null, part: "RF2" },
  { id: "w19879267", name: "Loafaru", part: "RF2" },
  { id: "w19879339", name: "Magoodhoo", part: "RF2" },
  { id: "w19879608", name: null, part: "RF2" },
  { id: "w19879551", name: "Manadhoo", part: "RF2" },
  { id: "w19879308", name: "Holhudhoo", part: "RF2" },
  { id: "w19879363", name: "Hulhumeedhoo", part: "RF2" },
  { id: "w19879492", name: "Iru Fushi Maldives", part: "RF2" },
  { id: "w19879407", name: "Foddhoo", part: "RF2" },
  { id: "w19879510", name: "Dhigurah", part: "RF2" },
  { id: "w19879639", name: "Than'burudhoo", part: "RF2" },
  { id: "w19879360", name: "Medhufaru", part: "RF2" },
  { id: "w19879631", name: null, part: "RF2" },
  { id: "w399093023", name: null, part: "RF2" },
  { id: "w399093019", name: null, part: "RF2" },
  { id: "w478773228", name: "Cheval Blanc Randheli Private Island", part: "RF2" },
  { id: "w399093021", name: null, part: "RF2" },
  { id: "w478261407", name: "Cheval Blanc Spa", part: "RF2" },
  { id: "w19879445", name: "Maakurandhoo", part: "RF2" },
  { id: "w478206176", name: "Fahudheli", part: "RF2" },
  { id: "w478206064", name: "Medhudheli", part: "RF2" },
  { id: "w19879421", name: "Randheli", part: "RF2" },
  { id: "w19879587", name: "Didhdhoo", part: "RF2" },
  { id: "w19879669", name: "Vattaru", part: "RF2" },
  { id: "w19879320", name: "Velidhoo", part: "RF2" },
  { id: "w1421713938", name: "Raafushi", part: "RF2" },
  // Raa (23), north to south by centroid.
  { id: "w19879570", name: null, part: "RF2" },
  { id: "w19879732", name: "Alifushi", part: "RF2" },
  { id: "w19879704", name: "Vaadhoo", part: "RF2" },
  { id: "w19879707", name: "Rasgetheemu", part: "RF2" },
  { id: "w19879383", name: "Angolhitheemu", part: "RF2" },
  { id: "w19879367", name: "Kan'doogan'du", part: "RF2" },
  { id: "w1408926397", name: null, part: "RF2" },
  { id: "w1408926398", name: null, part: "RF2" },
  { id: "w19879582", name: "Faarufushi", part: "RF2" },
  { id: "w19879622", name: "Veyvah", part: "RF2" },
  { id: "w19879750", name: "Hulhudhuffaaru", part: "RF2" },
  { id: "w19879676", name: "Fasgandufaru", part: "RF2" },
  { id: "w19879292", name: "Maanenfushi", part: "RF2" },
  { id: "w19879454", name: "Gaaun'dhoodhoo", part: "RF2" },
  { id: "w19879607", name: "Hulhudhoo", part: "RF2" },
  { id: "w19879548", name: "Lun'boakandhoo", part: "RF2" },
  { id: "w19879689", name: "Fuggiri", part: "RF2" },
  { id: "w19879286", name: "Ifuru", part: "RF2" },
  { id: "w19879517", name: "Ungulu", part: "RF2" },
  { id: "w19879635", name: "Uthurumaafaru", part: "RF2" },
  { id: "w19879248", name: "Ungoofaaru", part: "RF2" },
  { id: "w19879391", name: "Arilundhoo", part: "RF2" },
  { id: "w19879401", name: "Maamin'gili", part: "RF2" },
];

/** The OpenStreetMap extract, as the chart's and the home reef's builds read it. */
export const EXTRACT_DIR = "osm-2026-10-14";

/** A set of Sentinel-2 candidates an island's scene is chosen from (scenes.ts), and the bounds it was gathered with. */
export interface CandidateSet {
  readonly dir: string;
  readonly sensedFrom: string;
  readonly sensedTo: string;
  /** Scenes with this share of their tile cloudy or more were not gathered: a cost bound, not a finding. */
  readonly maxTileCloud: number;
}

/**
 * The candidates each part's islands choose from, every Sentinel-2 L2A scene of the year to 2026-10-20 with under 10 % of
 * its tile cloudy, by Element84 Earth Search, the source of the home's scene; their scene classification bands and STAC
 * items are kept in each directory.
 *
 * **RF1's** are the 54 found by searching at its three islands' points (32 of 43NBH, 22 of 43NCG), exactly as its islands
 * were chosen from and the owner judged. **RF2's** are the 149 found by searching the four tiles the 134 islands lie in
 * (43NBH 37, 43NBG 39, 43NCG 22, 43NCH 51): a superset of RF1's 54, which hash the same in both directories (compared
 * 2026-10-21). Rejected: re-choosing RF1's islands from RF2's set. It could not change their choice (a point search
 * already returns every scene over the point, and a scene that reaches the window but not the point holds no-data in it),
 * but it would rewrite their records' candidate tables, which the owner's verdict was given on.
 *
 * The cap is a cost bound, not a finding: scenes with more of their tile cloudy were not screened, so an island could
 * have a clearer window among them, unlooked-at.
 */
export const CANDIDATES: Readonly<Record<Part, CandidateSet>> = {
  RF1: { dir: "sentinel2-scl-candidates-2026-10-20", sensedFrom: "2025-10-20", sensedTo: "2026-10-20", maxTileCloud: 10 },
  RF2: { dir: "sentinel2-scl-candidates-2026-10-21", sensedFrom: "2025-10-20", sensedTo: "2026-10-20", maxTileCloud: 10 },
};

/**
 * Where each scene a reef may be traced from is kept whole (B02, B03, B04, B08, SCL and its item; PROVENANCE.md beside
 * them). A scene the rule reaches that is not listed here stops the build with "could not run", naming every such scene
 * and the islands waiting on it, so one run says everything there is to fetch.
 */
export const SCENE_DIRS: Readonly<Record<string, string>> = {
  S2A_43NCG_20260224_0_L2A: "sentinel2-43NCG-2026-02-24",
  S2B_43NBG_20251109_0_L2A: "sentinel2-43NBG-2025-11-09",
  S2B_43NBG_20260224_1_L2A: "sentinel2-43NBG-2026-02-24-1",
  S2B_43NBG_20260306_0_L2A: "sentinel2-43NBG-2026-03-06",
  S2B_43NBG_20260316_0_L2A: "sentinel2-43NBG-2026-03-16",
  S2B_43NBG_20261002_0_L2A: "sentinel2-43NBG-2026-10-02",
  S2B_43NBH_20251106_0_L2A: "sentinel2-43NBH-2025-11-06",
  S2B_43NBH_20251226_0_L2A: "sentinel2-43NBH-2025-12-26",
  S2B_43NCG_20260115_0_L2A: "sentinel2-43NCG-2026-01-15",
  S2B_43NCG_20260306_0_L2A: "sentinel2-43NCG-2026-03-06",
  S2B_43NCG_20260316_0_L2A: "sentinel2-43NCG-2026-03-16",
  S2B_43NCG_20260405_0_L2A: "sentinel2-43NCG-2026-04-05",
  S2B_43NCH_20260306_0_L2A: "sentinel2-43NCH-2026-03-06",
  S2B_43NCH_20260405_0_L2A: "sentinel2-43NCH-2026-04-05",
  S2C_43NBG_20251101_0_L2A: "sentinel2-43NBG-2025-11-01",
  S2C_43NBG_20251121_0_L2A: "sentinel2-43NBG-2025-11-21",
  S2C_43NBG_20260123_0_L2A: "sentinel2-43NBG-2026-01-23",
  S2C_43NBG_20260130_0_L2A: "sentinel2-43NBG-2026-01-30",
  S2C_43NBG_20260219_1_L2A: "sentinel2-43NBG-2026-02-19-1",
  S2C_43NBG_20260301_0_L2A: "sentinel2-43NBG-2026-03-01",
  S2C_43NBG_20260311_0_L2A: "sentinel2-43NBG-2026-03-11",
  S2C_43NBG_20260420_0_L2A: "sentinel2-43NBG-2026-04-20",
  S2C_43NBG_20260719_0_L2A: "sentinel2-43NBG-2026-07-19",
  S2C_43NBG_20261007_0_L2A: "sentinel2-43NBG-2026-10-07",
  S2C_43NBH_20251111_0_L2A: "sentinel2-43NBH-2025-11-11",
  S2C_43NBH_20260103_0_L2A: "sentinel2-43NBH-2026-01-03",
  S2C_43NBH_20260110_0_L2A: "sentinel2-43NBH-2026-01-10",
  S2C_43NBH_20260123_0_L2A: "sentinel2-43NBH-2026-01-23",
  S2C_43NBH_20260219_0_L2A: "sentinel2-43NBH-2026-02-19",
  S2C_43NBH_20260304_0_L2A: "sentinel2-43NBH-2026-03-04",
  S2C_43NBH_20260311_0_L2A: "sentinel2-43NBH-2026-03-11",
  S2C_43NBH_20260420_0_L2A: "sentinel2-43NBH-2026-04-20",
  S2C_43NBH_20261007_0_L2A: "sentinel2-43NBH-2026-10-07",
  S2C_43NCG_20251101_0_L2A: "sentinel2-43NCG-2025-11-01",
  S2C_43NCG_20260110_0_L2A: "sentinel2-43NCG-2026-01-10",
  S2C_43NCG_20260301_0_L2A: "sentinel2-43NCG-2026-03-01",
  S2C_43NCG_20260311_0_L2A: "sentinel2-43NCG-2026-03-11",
  S2C_43NCG_20260420_0_L2A: "sentinel2-43NCG-2026-04-20",
  S2C_43NCG_20260619_0_L2A: "sentinel2-43NCG-2026-06-19",
  S2C_43NCG_20261007_0_L2A: "sentinel2-43NCG-2026-10-07",
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
 * holds for the batch he saw and nothing else: its reefs id names the extract, the part's islands and their scenes, and
 * the method, and each accepted gap names the area he saw, so a rebuild that traces anything differently is not covered
 * and is refused again until he looks again. Rejected: a per-island "AC162 waived" switch (it would outlive the trace it
 * was given for); widening AC162's tolerance (D392 keeps 10 % as the rule and records the exceptions).
 *
 * **One verdict a part** (RF2). Each part's batch has its own id (build-reefs.ts `batchId`), so RF2's islands joining the
 * data leave RF1's id, and so D392, exactly as they were. **A part with no verdict here is awaiting one**: its gaps over
 * 10 % are recorded as his to judge on its contact sheet (D392's rule, D394: the sheet's verdict is enough), shipped in
 * the data and reported by check:reefs, not refused. Once a part has a verdict, any gap it does not cover is refused, so
 * "awaiting" cannot outlive his look. Nothing reads reefs.bin until N11 (PLAN v2.6), so no build draws an awaiting reef.
 */
export interface Verdict {
  readonly part: Part;
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
    part: "RF1",
    decision: "D392",
    date: "2026-10-20",
    reefsId: "osm-858582dd.s2-ecc71584.m1",
    seenOn: "the contact sheet archive/rf1-2026-10-20/index.html, made at commit 5562e12; not yet on a build",
    verdict: "all three traced reefs right",
    acceptsAreaGap: { w122946807: 10.86, w19879485: 57.31 },
  },
];
