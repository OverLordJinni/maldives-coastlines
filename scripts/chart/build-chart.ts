// CH0 (PLAN Phase E): builds the chart's data from an OpenStreetMap extract and records how.
//
//   pnpm chart <extract dir>          e.g. pnpm chart ../assets-raw/osm-2026-10-14 (from game/)
//
// Reads `<dir>/maldives-latest.osm.pbf`, refusing to run (exit 2) unless `<dir>/SHA256SUMS` names it
// and agrees with its bytes: the record says which extract the chart came from, and a chart built
// from a file that merely has the right name would make that record false. Writes
// `src/assets/chart/maldives.bin` (the format: src/rules/chartData.ts) and
// `src/assets/chart/chart-manifest.json` (the record, R57; what `check:chart` holds the file to).
//
// The steps, each in its own module so each can be tested and re-read:
//   1. pbf.ts, extract.ts   read the extract (two passes)
//   2. islands.ts           join coastline ways into rings; read each ring's names, vegetation,
//                           buildings and tags
//   3. filter.ts            filter v1, with excluded.json, one reason per excluded ring
//   4. here                 assign each kept island to today's administrative atoll (OSM
//                           admin_level=4, named from atolls.json, D235); build the cloud from the
//                           natural atolls (place=archipelago tagged natural=atoll|reef, D246)
//   5. geometry.ts          Douglas–Peucker at 5 m (islands) and 200 m (cloud), in local metres
//   6. here                 quantise once to 1e-5 degrees; carry ids forward from the previous chart
//                           (aliases, PLAN Risk 21)
//   7. encode.ts            write the binary
//
// **Deterministic**: the same extract and the same hand lists give the same bytes (no Map-order,
// clock or locale dependence; the manifest has no build time). That is what lets the public data
// repository (D225) publish "the means to rebuild it exactly" (R57) and have it mean something.
//
// Exit codes (testing-policy "A check that could not run"):
//   0  built
//   1  ran and refused: a hand list names a ring that is not in the extract, an atoll table row no
//      longer matches OSM, an island of the previous chart vanished with no successor, or Maavaidhoo
//      and Kulhudhuffushi are not both kept in one atoll
//   2  could not run: no extract directory given, a file missing, or SHA256SUMS disagrees. Nothing
//      was written.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { coastDistanceM, decodeChart, isIslandId, QUANTUM, type IslandId, type LonLat } from "../../src/rules/chartData.ts";
import { encodeChart, type QPoint } from "./encode.ts";
import { loadExtract, type Extract } from "./extract.ts";
import { assembleRings, areaM2, bboxOf, inBbox, inRing, simplifyRing, type Bbox } from "./geometry.ts";
import { filterV1, FILTER_VERSION, MIN_AREA_M2, type Basis, type HandRow, type Rule } from "./filter.ts";
import { findCandidates, type Candidate } from "./islands.ts";

export const EXTRACT_FILE = "maldives-latest.osm.pbf";
export const TOLERANCE_M = 5;
export const CLOUD_TOLERANCE_M = 200;
/** The home island and the crossing's destination (D182, D224), checked here so a filter change that drops either fails the build. */
export const HOME: IslandId = "w19879672";
export const DESTINATION: IslandId = "w19879671";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, "../..");
export const OUT_DIR = join(REPO, "src/assets/chart");
export const BIN = "maldives.bin";
export const MANIFEST = "chart-manifest.json";

export class CouldNotRun extends Error {
  override name = "CouldNotRun";
}
export class Refused extends Error {
  override name = "Refused";
}

const islandId = z.string().refine(isIslandId, "not an island id (w<n> or r<n>)").transform((s) => s as IslandId);
const handSchema = z.strictObject({
  why: z.string(),
  reviewed: z.null().or(z.strictObject({ by: z.string(), date: z.string(), build: z.string() })),
  excluded: z.array(z.strictObject({ id: islandId, name: z.string().min(1), reason: z.string().min(1), source: z.string().min(1) })),
});
const atollTableSchema = z.strictObject({
  why: z.string(),
  source: z.string(),
  atolls: z.record(z.string().regex(/^[1-9][0-9]*$/), z.strictObject({ osmNameEn: z.string().min(1), id: z.string().regex(/^[a-z]+(-[a-z]+)*$/), name: z.string().min(1) })),
});

export interface ExtractRecord {
  readonly file: string;
  readonly url: string | null;
  readonly fetchedAt: string;
  readonly date: string;
  readonly bytes: number;
  readonly md5: string;
  readonly sha256: string;
}

/** Reads the extract directory's file and its provenance, refusing (CouldNotRun) on any disagreement. */
export function readExtractDir(dir: string): { bytes: Uint8Array; record: ExtractRecord } {
  const file = join(dir, EXTRACT_FILE);
  const sums = join(dir, "SHA256SUMS");
  const at = join(dir, "fetched-at.txt");
  for (const f of [file, sums, at]) if (!existsSync(f)) throw new CouldNotRun(`${f} does not exist`);
  const bytes = new Uint8Array(readFileSync(file));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const line = readFileSync(sums, "utf8")
    .split("\n")
    .map((l) => /^([0-9a-f]{64}) [ *](.+)$/.exec(l.trim()))
    .find((m) => m !== null && m[2] === EXTRACT_FILE);
  if (!line) throw new CouldNotRun(`${sums} does not name ${EXTRACT_FILE}`);
  if (line[1] !== sha256) throw new CouldNotRun(`${EXTRACT_FILE} has sha256 ${sha256}; SHA256SUMS says ${line[1]}. Refusing to build from a file the record does not describe`);
  const fetchedAt = readFileSync(at, "utf8").trim();
  const date = /^(\d{4}-\d{2}-\d{2})T/.exec(fetchedAt)?.[1];
  if (date === undefined) throw new CouldNotRun(`${at} is not an ISO time: ${JSON.stringify(fetchedAt)}`);
  const from = join(dir, "fetched-from.txt");
  return {
    bytes,
    record: {
      file: EXTRACT_FILE,
      url: existsSync(from) ? readFileSync(from, "utf8").trim() : null,
      fetchedAt,
      date,
      bytes: bytes.length,
      md5: createHash("md5").update(bytes).digest("hex"),
      sha256,
    },
  };
}

interface AdminArea {
  readonly id: string;
  readonly name: string;
  readonly relation: number;
  readonly outer: readonly LonLat[][];
  readonly inner: readonly LonLat[][];
  readonly boxes: readonly Bbox[];
  readonly area: number;
}

function adminAreas(ex: Extract, table: z.output<typeof atollTableSchema>): AdminArea[] {
  const rels = ex.relations.filter((r) => r.tags.admin_level === "4" && r.tags.boundary === "administrative");
  const problems: string[] = [];
  const out: AdminArea[] = [];
  const ringsOf = (ids: number[]): LonLat[][] => {
    const ways = ids.map((id) => ex.ways.get(id)).filter((w) => w !== undefined);
    const a = assembleRings(ways);
    if (a.open.length > 0) problems.push(`ways ${a.open.map((o) => o.wayIds.join("+")).join(", ")} do not close`);
    return a.rings.map((r) => r.refs.map((n) => ex.coord(n)));
  };
  for (const r of rels) {
    const row = table.atolls[String(r.id)];
    if (row === undefined) {
      problems.push(`admin_level=4 relation r${r.id} (${r.tags["name:en"] ?? r.tags.name}) is not in atolls.json`);
      continue;
    }
    if (r.tags["name:en"] !== row.osmNameEn) problems.push(`r${r.id}'s name:en is now ${JSON.stringify(r.tags["name:en"])}; atolls.json was written against ${JSON.stringify(row.osmNameEn)}`);
    const wayIds = (role: (s: string) => boolean): number[] => r.members.filter((m) => m.type === "way" && role(m.role)).map((m) => m.ref);
    const outer = ringsOf(wayIds((s) => s !== "inner"));
    const inner = ringsOf(wayIds((s) => s === "inner"));
    out.push({ id: row.id, name: row.name, relation: r.id, outer, inner, boxes: outer.map(bboxOf), area: outer.reduce((s, x) => s + areaM2(x), 0) });
  }
  for (const id of Object.keys(table.atolls)) if (!rels.some((r) => String(r.id) === id)) problems.push(`atolls.json row ${id} is not an admin_level=4 relation in the extract`);
  if (problems.length > 0) throw new Refused(`the atoll table does not match the extract:\n  - ${problems.join("\n  - ")}`);
  // In the table's order (north to south), which is the order the chart lists them.
  const order = Object.values(table.atolls).map((a) => a.id);
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

function inArea(p: LonLat, a: AdminArea): boolean {
  if (!a.outer.some((r, i) => inBbox(p, a.boxes[i] as Bbox) && inRing(p, r))) return false;
  return !a.inner.some((r) => inRing(p, r));
}

/**
 * The administrative atoll an island lies in: the one holding its vertex centroid, else the one
 * holding most of its vertices; where two hold it (Malé inside Kaafu's outline), the smaller, more
 * specific one. Null when none does.
 */
export function atollOf(ring: readonly LonLat[], areas: readonly AdminArea[]): AdminArea | null {
  const c: LonLat = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  const by = (p: LonLat): AdminArea[] => areas.filter((a) => inArea(p, a)).sort((x, y) => x.area - y.area);
  const direct = by(c)[0];
  if (direct) return direct;
  const votes = new Map<AdminArea, number>();
  for (const p of ring) {
    const a = by(p)[0];
    if (a) votes.set(a, (votes.get(a) ?? 0) + 1);
  }
  return [...votes].sort((x, y) => y[1] - x[1] || x[0].area - y[0].area)[0]?.[0] ?? null;
}

/** The natural atolls' outlines (D246: cloud lies over each atoll's sea). */
function cloudRings(ex: Extract): { rings: LonLat[][]; sources: string[]; refused: string[] } {
  const rings: LonLat[][] = [];
  const sources: string[] = [];
  const refused: string[] = [];
  // Only elements that say they are a natural atoll or reef. Rejected: every place=archipelago, which
  // in 2026-10 includes r12137583 "Fari Islands", a resort group whose outer rings are the islands'
  // own outlines: cloud drawn there would trace three islands nobody has sighted (R58).
  const natural = (t: Readonly<Record<string, string>>): boolean => t.natural === "atoll" || t.natural === "reef";
  for (const w of [...ex.ways.values()].sort((a, b) => a.id - b.id)) {
    if (w.tags.place !== "archipelago") continue;
    if (!natural(w.tags)) {
      refused.push(`w${w.id} ${w.tags.name ?? ""}: not tagged natural=atoll|reef`);
      continue;
    }
    if (w.refs[0] !== w.refs[w.refs.length - 1]) {
      refused.push(`w${w.id} ${w.tags.name ?? ""}: not closed`);
      continue;
    }
    rings.push(w.refs.map((n) => ex.coord(n)));
    sources.push(`w${w.id} ${w.tags.name ?? ""}`.trim());
  }
  for (const r of [...ex.relations].sort((a, b) => a.id - b.id)) {
    if (r.tags.place !== "archipelago") continue;
    if (!natural(r.tags)) {
      refused.push(`r${r.id} ${r.tags.name ?? ""}: not tagged natural=atoll|reef`);
      continue;
    }
    const ways = r.members.filter((m) => m.type === "way" && m.role !== "inner").map((m) => ex.ways.get(m.ref)).filter((w) => w !== undefined);
    for (const ring of assembleRings(ways).rings) {
      rings.push(ring.refs.map((n) => ex.coord(n)));
      sources.push(`r${r.id} ${r.tags["name:en"] ?? r.tags.name ?? ""}`.trim());
    }
  }
  return { rings, sources, refused };
}

const q = (p: LonLat): QPoint => [Math.round(p[0] * QUANTUM), Math.round(p[1] * QUANTUM)];

/** Quantises an open ring once, dropping a point that rounds onto its predecessor. */
export function quantise(ring: readonly LonLat[]): QPoint[] {
  const out: QPoint[] = [];
  for (const p of ring) {
    const x = q(p);
    const last = out[out.length - 1];
    if (!last || last[0] !== x[0] || last[1] !== x[1]) out.push(x);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

const fromQ = (r: readonly QPoint[]): LonLat[] => r.map(([x, y]) => [x / QUANTUM, y / QUANTUM]);

export interface Excluded {
  readonly id: IslandId;
  readonly name: string | null;
  readonly areaM2: number;
  readonly rule: Rule | "atoll";
  readonly reason: string;
}

export interface Built {
  readonly bin: Uint8Array;
  readonly manifest: Record<string, unknown>;
}

export function build(extractDir: string, previous: { bin: Uint8Array; knownIds: readonly IslandId[] } | null): Built {
  const { bytes, record } = readExtractDir(extractDir);
  const hand = handSchema.parse(JSON.parse(readFileSync(join(here, "excluded.json"), "utf8")));
  const table = atollTableSchema.parse(JSON.parse(readFileSync(join(here, "atolls.json"), "utf8")));

  const ex = loadExtract(bytes);
  const candidates = findCandidates(ex);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const handMap = new Map<IslandId, HandRow>(hand.excluded.map((h) => [h.id, h]));
  const stale = hand.excluded.filter((h) => !byId.has(h.id));
  if (stale.length > 0) throw new Refused(`excluded.json names rings that are not in this extract: ${stale.map((h) => `${h.id} (${h.name})`).join(", ")}`);
  const areas = adminAreas(ex, table);

  const excluded: Excluded[] = [];
  const kept: { c: Candidate; atoll: AdminArea; basis: readonly Basis[] }[] = [];
  for (const c of [...candidates].sort((a, b) => cmpId(a.id, b.id))) {
    const v = filterV1(c, handMap);
    if (!v.keep) {
      excluded.push({ id: c.id, name: c.nameEn ?? c.name, areaM2: Math.round(c.areaM2), rule: v.rule, reason: v.reason });
      continue;
    }
    const atoll = atollOf(c.ring, areas);
    if (atoll === null) {
      excluded.push({ id: c.id, name: c.nameEn ?? c.name, areaM2: Math.round(c.areaM2), rule: "atoll", reason: "outside every administrative atoll in the extract" });
      continue;
    }
    kept.push({ c, atoll, basis: v.basis });
  }

  const islands = kept.map(({ c, atoll }) => {
    const ring = quantise(simplifyRing(c.ring, TOLERANCE_M));
    if (ring.length < 3) throw new Refused(`${c.id} quantises to ${ring.length} points`);
    return { id: c.id, atoll: atoll.id, ring };
  });
  const islandIds = new Set(islands.map((i) => i.id));
  for (const id of [HOME, DESTINATION]) if (!islandIds.has(id)) throw new Refused(`${id} (${id === HOME ? "Maavaidhoo, the home island" : "Kulhudhuffushi, the crossing's destination"}) is not in the chart: ${excluded.find((e) => e.id === id)?.reason ?? "not a ring in the extract"}`);
  const homeAtoll = islands.find((i) => i.id === HOME)?.atoll;
  const destAtoll = islands.find((i) => i.id === DESTINATION)?.atoll;
  if (homeAtoll !== destAtoll) throw new Refused(`Maavaidhoo is in ${homeAtoll} and Kulhudhuffushi in ${destAtoll}: D118 needs one atoll`);

  const cloud = cloudRings(ex);
  const cloudQ = cloud.rings.map((r) => quantise(simplifyRing(r, CLOUD_TOLERANCE_M)));

  // Aliases (PLAN Risk 21): an island of the previous chart that is not in this one either has a
  // successor whose outline holds the old outline's centre, which becomes its alias, or the build
  // refuses. Old aliases are carried forward and re-pointed if their target moved.
  const aliases = new Map<IslandId, IslandId>();
  const knownIds = new Set<IslandId>([...(previous?.knownIds ?? []), ...islandIds]);
  if (previous !== null) {
    const old = decodeChart(previous.bin);
    const successor = (ring: readonly LonLat[]): IslandId | null => {
      const c: LonLat = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      return islands.find((i) => inRing(c, fromQ(i.ring)))?.id ?? null;
    };
    const lost: string[] = [];
    for (const i of old.islands) {
      if (islandIds.has(i.id)) continue;
      const s = successor(i.ring as readonly LonLat[]);
      if (s === null) lost.push(i.id);
      else aliases.set(i.id, s);
    }
    for (const [from, to] of old.aliases) {
      if (islandIds.has(from)) continue;
      const target = islandIds.has(to) ? to : (aliases.get(to) ?? null);
      if (target === null) lost.push(`${from} (via ${to})`);
      else aliases.set(from, target);
    }
    if (lost.length > 0) throw new Refused(`islands of chart ${old.id} have no successor in this extract, so a saved state on them would be orphaned (PLAN Risk 21): ${lost.join(", ")}`);
  }
  for (const id of knownIds) if (!islandIds.has(id) && !aliases.has(id)) throw new Refused(`${id} was in an earlier chart and is neither an island nor an alias now`);

  const chartId = `osm-${record.date}.f${FILTER_VERSION}.t${TOLERANCE_M}`;
  // One entry per atoll id: atolls.json may chart two relations as one atoll (Malé as Kaafu; it says why).
  const atollsUsed = areas.filter((a, k) => islands.some((i) => i.atoll === a.id) && areas.findIndex((b) => b.id === a.id) === k);
  const bin = encodeChart({
    id: chartId,
    atolls: atollsUsed.map((a) => ({ id: a.id, name: a.name })),
    cloud: cloudQ,
    islands: [...islands].sort((a, b) => cmpId(a.id, b.id)),
    aliases: [...aliases].sort((a, b) => cmpId(a[0], b[0])),
  });

  // The measurement AC137 records (D224), on the shipped geometry: the number the game computes.
  const home = islands.find((i) => i.id === HOME) as (typeof islands)[number];
  const dest = islands.find((i) => i.id === DESTINATION) as (typeof islands)[number];
  const shipped = coastDistanceM("lonlat", fromQ(home.ring), fromQ(dest.ring));
  const full = coastDistanceM("lonlat", (byId.get(HOME) as Candidate).ring, (byId.get(DESTINATION) as Candidate).ring);

  // Islands no cloud area covers (D246). Recorded so the chart panel (CH2) can decide how to cloud
  // them; their positions are not in any cloud ring, so nothing about them leaks from the cloud.
  const cloudBoxes = cloud.rings.map(bboxOf);
  const outsideCloud = islands.filter((i) => !fromQ(i.ring).some((p) => cloud.rings.some((r, k) => inBbox(p, cloudBoxes[k] as Bbox) && inRing(p, r)))).map((i) => i.id);

  const points = islands.reduce((s, i) => s + i.ring.length, 0);
  const nameOf = (c: Candidate): string | null => c.nameEn ?? c.name;
  const manifest = {
    why: "The record of the chart's data (R57, AC136, AC137). Written by scripts/chart/build-chart.ts; held to by scripts/chart/check-chart.ts. Never imported by the app: it carries island names, which v1 never shows (D221, AC138), so they live here only for AC138's search.",
    chartId,
    format: 1,
    licence: "© OpenStreetMap contributors. Data under the Open Database Licence (ODbL) 1.0, https://opendatacommons.org/licenses/odbl/1-0/",
    extract: record,
    method: {
      filter: { version: FILTER_VERSION, minAreaM2: MIN_AREA_M2, rules: "scripts/chart/filter.ts", handList: "scripts/chart/excluded.json", handListReviewed: hand.reviewed },
      islandToleranceM: TOLERANCE_M,
      cloudToleranceM: CLOUD_TOLERANCE_M,
      simplification: "Douglas–Peucker on each closed ring in local equirectangular metres at the ring's mean latitude; a ring never falls below three points",
      quantum: "1e-5 degrees, rounded once after simplification",
      atolls: "OSM admin_level=4 relations, named from scripts/chart/atolls.json (today's names, D235)",
      cloud: "OSM place=archipelago tagged natural=atoll or natural=reef, outer rings (D246)",
    },
    bin: { file: BIN, bytes: bin.length, sha256: createHash("sha256").update(bin).digest("hex") },
    counts: {
      rings: candidates.length,
      islands: islands.length,
      excluded: excluded.length,
      atolls: atollsUsed.length,
      cloudAreas: cloudQ.length,
      points,
      cloudPoints: cloudQ.reduce((s, r) => s + r.length, 0),
      aliases: aliases.size,
    },
    excludedByRule: Object.fromEntries((["inner", "hand", "tag", "small", "bare", "atoll"] as const).map((r) => [r, excluded.filter((e) => e.rule === r).length])),
    crossing: {
      home: HOME,
      destination: DESTINATION,
      atoll: homeAtoll,
      nearestShoreM: Math.round(shipped),
      nearestShoreFullResolutionM: Math.round(full),
      note: "Nearest coastline point to nearest coastline point (R59), on the shipped 5 m-simplified, quantised outlines and on OSM's full outlines (AC137, D224)",
    },
    atolls: atollsUsed.map((a) => ({ id: a.id, name: a.name, osmRelations: areas.filter((b) => b.id === a.id).map((b) => `r${b.relation}`), islands: islands.filter((i) => i.atoll === a.id).length })),
    cloud: { sources: cloud.sources, notUsed: cloud.refused, islandsOutside: outsideCloud },
    excluded,
    review: {
      why: "Kept by filter v1, and worth the owner's eye at AC136: OSM cannot say whether these are sandbanks or reclaimed land",
      keptOnNameAlone: kept.filter((k) => k.basis.length === 1 && k.basis[0] === "name").map((k) => ({ id: k.c.id, name: nameOf(k.c), areaM2: Math.round(k.c.areaM2) })),
      keptUnnamedOnBuildingsAlone: kept.filter((k) => k.basis.length === 1 && k.basis[0] === "buildings").map((k) => ({ id: k.c.id, areaM2: Math.round(k.c.areaM2), buildings: k.c.buildings })),
      keptWithAeroway: kept.filter((k) => k.c.aeroways > 0).map((k) => ({ id: k.c.id, name: nameOf(k.c) })),
    },
    names: kept.flatMap((k) => (k.c.name === null && k.c.nameEn === null ? [] : [{ id: k.c.id, name: k.c.name, nameEn: k.c.nameEn }])),
    knownIds: [...knownIds].sort(cmpId),
  };
  return { bin, manifest };
}

export function cmpId(a: IslandId, b: IslandId): number {
  // Relations before ways ("r" < "w"), then by number: the order the chart is written in.
  const [ka, kb] = [a.charAt(0), b.charAt(0)];
  return ka === kb ? Number(a.slice(1)) - Number(b.slice(1)) : ka < kb ? -1 : 1;
}

function previousChart(): { bin: Uint8Array; knownIds: IslandId[] } | null {
  const bin = join(OUT_DIR, BIN);
  const man = join(OUT_DIR, MANIFEST);
  if (!existsSync(bin) || !existsSync(man)) return null;
  const known = z.object({ knownIds: z.array(islandId) }).parse(JSON.parse(readFileSync(man, "utf8")));
  return { bin: new Uint8Array(readFileSync(bin)), knownIds: known.knownIds };
}

// Real paths on both sides: through a symlink (macOS's /var is /private/var) a plain comparison is
// false, and the script would exit 0 having done nothing, which reads as a pass.
const invoked = process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  const dir = process.argv[2];
  try {
    if (dir === undefined) throw new CouldNotRun("usage: pnpm chart <extract dir>  (the directory holding maldives-latest.osm.pbf and SHA256SUMS, outside the repo)");
    const { bin, manifest } = build(resolve(dir), previousChart());
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, BIN), bin);
    writeFileSync(join(OUT_DIR, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    const c = manifest.counts as Record<string, number>;
    const x = manifest.crossing as Record<string, unknown>;
    console.log(`chart: ${manifest.chartId} from ${basename(resolve(dir))}: ${c.islands} islands of ${c.rings} rings (${c.excluded} excluded), ${c.atolls} atolls, ${c.cloudAreas} cloud areas, ${c.points} points, ${bin.length} bytes. Maavaidhoo–Kulhudhuffushi ${x.nearestShoreM} m shore to shore.`);
  } catch (e) {
    if (e instanceof CouldNotRun) {
      console.error(`chart: COULD NOT RUN: ${e.message}\nNothing was written.`);
      process.exit(2);
    }
    if (e instanceof Refused) {
      console.error(`chart: REFUSED: ${e.message}\nNothing was written.`);
      process.exit(1);
    }
    throw e;
  }
}
