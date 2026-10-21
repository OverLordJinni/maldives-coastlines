// The review figure for the traced reefs (D389; AC163 as draft 18.1 extends it): one contact sheet a part (RF1's three, RF2's
// 130) the owner judges on the Mac in one sitting, the doubtful islands first. It opens with a table of every island (its
// gap against OpenStreetMap's area, its flags, whether its window was widened), each row a link to its panel. Each panel is
// the island's window from the scene its reef was traced from, true colour, with the traced edge and crest,
// OpenStreetMap's reef, the charted coastline and every bearing where the traced edge and OSM's differ by more than 20 m;
// Kulhudhuffushi's kulhi gets its own panel over the 1997 Landsat scene it was traced from.
//
//   node scripts/reef/review-sheet.ts <assets-raw dir> <out dir> [--part RF1|RF2]
//   e.g. node scripts/reef/review-sheet.ts ../../assets-raw ../../archive/rf2-2026-10-21 --part RF2      (from a worktree)
//
// Writes `index.html` (the sheet: panels and their words), one PNG per panel and `LABEL.txt` (what the folder is, how it
// was made, from which commit's scripts). **It holds imagery, so it is written only outside the repository** (D269: no
// pixel in the repository or the app): an out dir inside it is refused, exit 1. The repository keeps this script and the
// record (reefs-manifest.json), never the figure (PLAN v2.6).
//
// **Refused, awaiting and drawn islands are shown too, first.** A gap over 10 % (AC162) is what the owner is asked to judge
// (D392), whether the build refused it or holds it for his verdict; an island that would not trace has D387's drawn band,
// shown in green over the widest window tried, with the coast and OSM's reef, so he sees why it is not a trace.
//
// Text is HTML, not drawn into the pictures: no font to embed, and the words stay searchable and readable at any size.
//
// Exit codes: 0 written; 1 refused (an out dir inside the repository); 2 could not run (an input missing or disagreeing).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkedFiles, CouldNotRun, Refused } from "./build-reef.ts";
import { build, type ReviewIsland } from "./build-reefs.ts";
import { labelOf, type Part } from "./reef-islands.ts";
import { encodePng } from "./png.ts";
import { readTiff, readWindow } from "./tiff.ts";
import { frameAt } from "./transform.ts";
import { toUtm } from "./utm.ts";
import { ISLAND_SOURCE } from "../../src/rules/islandSource.ts";
import { decodeChart, type LonLat } from "../../src/rules/chartData.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(here, "../..");

/** The colours of the sheet, named in its legend. */
export const COLOURS = {
  edge: [255, 214, 0],
  crest: [255, 120, 0],
  osm: [255, 0, 220],
  coast: [255, 255, 255],
  disagree: [255, 40, 40],
  bright: [0, 230, 255],
  kulhi: [0, 230, 255],
  drawn: [120, 255, 120],
} as const;
/** About this many pixels across a panel. */
const PANEL_PX = 640;

/** A true-colour stretch: reflectance × 3.5, gamma 1/2.2, clipped. The same for every panel, so they compare. */
const shade = (r: number): number => Math.max(0, Math.min(255, Math.round(255 * Math.pow(Math.max(0, Math.min(1, r * 3.5)), 1 / 2.2))));

interface Canvas {
  readonly w: number;
  readonly h: number;
  readonly rgb: Uint8Array;
}

function plot(c: Canvas, x: number, y: number, col: readonly number[], width: number): void {
  for (let dy = 0; dy < width; dy++)
    for (let dx = 0; dx < width; dx++) {
      const X = Math.round(x) + dx;
      const Y = Math.round(y) + dy;
      if (X >= 0 && Y >= 0 && X < c.w && Y < c.h) c.rgb.set(col, (Y * c.w + X) * 3);
    }
}
function segment(c: Canvas, a: readonly [number, number], b: readonly [number, number], col: readonly number[], width: number): void {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1;
  for (let s = 0; s <= n; s++) plot(c, a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n, col, width);
}
function ring(c: Canvas, pts: readonly (readonly [number, number])[], col: readonly number[], width: number): void {
  for (let i = 0; i < pts.length; i++) segment(c, pts[i] as [number, number], pts[(i + 1) % pts.length] as [number, number], col, width);
}

/** A window of three bands as a canvas, `scale` canvas pixels a band pixel, and the map from UTM to canvas. */
function background(bands: readonly Uint8Array[], x0: number, y0: number, n: number, pixelM: number, refl: (dn: number) => number) {
  const imgs = bands.map((b) => readTiff(b));
  const first = imgs[0] as ReturnType<typeof readTiff>;
  const vals = bands.map((b, i) => readWindow(b, imgs[i] as ReturnType<typeof readTiff>, x0, y0, n, n).values);
  const scale = Math.max(1, Math.floor(PANEL_PX / n));
  const w = n * scale;
  const rgb = new Uint8Array(w * w * 3);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const k = Math.floor(y / scale) * n + Math.floor(x / scale);
      for (let ch = 0; ch < 3; ch++) rgb[(y * w + x) * 3 + ch] = shade(refl((vals[ch] as Uint16Array)[k] as number));
    }
  const toCanvas = (lon: number, lat: number, zone: number): [number, number] => {
    const u = toUtm(lon, lat, zone);
    return [((u.x - first.originX) / pixelM - x0) * scale, ((first.originY - u.y) / pixelM - y0) * scale];
  };
  return { canvas: { w, h: w, rgb }, toCanvas };
}

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface SheetRecord {
  readonly id: string;
  readonly name: string | null;
  readonly part: Part;
  readonly atoll: string;
  readonly kind: "traced" | "drawn";
  readonly sentinel2?: { readonly scene: string; readonly sensed: string };
  readonly window: { readonly sizePx: number; readonly grownFromPx?: number; readonly widestTriedPx?: number | null };
  readonly untraced?: { readonly reason: string };
  readonly result?: { readonly reefAreaM2: { readonly traced: number; readonly osm: number | null; readonly offPercent: number | null; readonly judged: unknown; readonly awaitingVerdict?: unknown } };
}
interface SheetManifest {
  readonly licence: readonly string[];
  readonly review: { readonly batches: readonly { readonly part: Part; readonly id: string; readonly order: readonly string[]; readonly verdict: unknown }[] };
  readonly islands: readonly SheetRecord[];
}

/** The panel's words: what it was traced from, its area against OSM's, its flags and its bearings. */
function caption(r: ReviewIsland, rec: SheetRecord, img: string | null, atoll: string): string {
  const title = `<h2 id="${escape(r.id)}">${escape(labelOf(r))} <small>${escape(r.id)}, ${escape(atoll)}</small></h2>`;
  const flags = r.flags.length === 0 ? "<p>No flags.</p>" : `<p><b>Flags:</b></p><ul>${r.flags.map((f) => `<li>${escape(f)}</li>`).join("")}</ul>`;
  let words: string;
  if (rec.kind === "drawn" || rec.result === undefined || rec.sentinel2 === undefined) {
    words = `<p><b>Not traced: D387's drawn band</b> (green, 81 m and 174 m off the coast, the home reef's medians), so the island stays landable. Why: ${escape(rec.untraced?.reason ?? "")}</p>${r.sceneDir === null ? "<p>No scene shows its window, so there is no picture.</p>" : `<p>The picture is the widest window tried (${rec.window.widestTriedPx ?? rec.window.sizePx} px) on <code>${escape(r.sceneDir)}</code>, with the band, the charted coast and OpenStreetMap's reef.</p>`}`;
  } else {
    const area = rec.result.reefAreaM2;
    const pct = area.offPercent === null ? "" : `${area.offPercent > 0 ? "+" : ""}${area.offPercent} %`;
    words = `<p>Traced from <code>${escape(rec.sentinel2.scene)}</code>, sensed ${escape(rec.sentinel2.sensed.slice(0, 10))}, in a ${rec.window.sizePx} px window${rec.window.grownFromPx === undefined ? "" : ` (widened from ${rec.window.grownFromPx} px: the reef ran on past it)`}. Reef area ${area.traced.toLocaleString("en")} m² traced against OpenStreetMap's ${area.osm === null ? "(none mapped)" : `${area.osm.toLocaleString("en")} m²: <b>${pct}</b>`} (AC162 allows 10 %${area.awaitingVerdict === undefined ? "" : "; over it, for your verdict, D392"}).</p>
    <p>${r.disagree.length} of 72 bearings more than 20 m from OpenStreetMap's edge${r.disagree.length === 0 ? "" : ` (degrees from east towards south: traced / OSM metres from the centroid): ${r.disagree.map((d) => `${d.deg}° ${d.tracedM}/${d.osmM}`).join(", ")}`}.</p>`;
  }
  return `<figure>
  ${img === null ? '<div class="none">no picture</div>' : `<img src="${img}" loading="lazy" alt="${escape(labelOf(r))}'s reef over its scene">`}
  <figcaption>
    ${title}
    ${words}
    ${flags}
  </figcaption>
</figure>`;
}

/**
 * The sheet's panels (PNG bytes by file name) and its HTML, from the build's review data, for one part (D389: a sheet a
 * batch) or every part. Pure apart from reading bands.
 *
 * **Each scene is read once.** RF2's 130 panels come from a few dozen scenes, and B02–B04 of one are about 350 MB: the
 * panels are drawn grouped by scene and the page laid out in the review's order afterwards. Panels are named by island id
 * (`<id>-reef.png`): RF2's names repeat and 42 are missing.
 */
export function sheet(rawDir: string, commit = "(not given)", part: Part | null = null): { files: Map<string, Uint8Array>; html: string; label: string } {
  const built = build(rawDir);
  const manifest = JSON.parse(built.manifest) as SheetManifest;
  // The record keeps the chart's atoll id; the sheet shows its name (the chart's own, D235).
  const atollName = new Map(decodeChart(new Uint8Array(readFileSync(join(REPO, "src/assets/chart/maldives.bin")))).atolls.map((a) => [a.id, a.name]));
  const atollOf = (rec: SheetRecord): string => atollName.get(rec.atoll) ?? rec.atoll;
  const batches = manifest.review.batches.filter((b) => part === null || b.part === part);
  if (batches.length === 0) throw new CouldNotRun(`no part ${String(part)} in the reefs' record`);
  const ordered = batches.flatMap((b) => b.order.map((id) => built.review.find((r) => r.id === id) as ReviewIsland));
  const files = new Map<string, Uint8Array>();
  const figures = new Map<string, string>();
  const zone = 43;
  const groups = new Map<string | null, ReviewIsland[]>();
  for (const r of ordered) groups.set(r.sceneDir, [...(groups.get(r.sceneDir) ?? []), r]);
  for (const [dir, rs] of [...groups].sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))) {
    const bands = dir === null ? null : ((s2) => ["B04.tif", "B03.tif", "B02.tif"].map((b) => (s2.get(b) as { bytes: Uint8Array }).bytes))(checkedFiles(join(rawDir, dir), ["B04.tif", "B03.tif", "B02.tif"]));
    for (const r of rs) {
      const rec = manifest.islands.find((i) => i.id === r.id) as SheetRecord;
      let img: string | null = null;
      if (bands !== null) {
        const { canvas, toCanvas } = background(bands, r.window.x0, r.window.y0, r.window.sizePx, 10, (dn) => dn / 10_000);
        const px = (p: LonLat): [number, number] => toCanvas(p[0], p[1], zone);
        ring(canvas, r.coast.map(px), COLOURS.coast, 1);
        if (r.osm !== null) ring(canvas, r.osm.map(px), COLOURS.osm, 2);
        ring(canvas, r.crest.map(px), r.kind === "drawn" ? COLOURS.drawn : COLOURS.crest, 2);
        ring(canvas, r.edge.map(px), r.kind === "drawn" ? COLOURS.drawn : COLOURS.edge, 2);
        for (const o of r.others) ring(canvas, o.map(px), COLOURS.bright, 2);
        // Each disagreeing bearing as a red stroke between the two edges, along the ray from the island's centroid.
        const frame = frameAt({ lon0: r.window.centre[0], lat0: r.window.centre[1], scale: ISLAND_SOURCE.scale });
        for (const d of r.disagree) {
          const t = (d.deg * Math.PI) / 180;
          const at = (m: number): [number, number] => px(frame.fromTrue(Math.cos(t) * m, Math.sin(t) * m));
          segment(canvas, at(d.tracedM), at(d.osmM), COLOURS.disagree, 3);
        }
        img = `${r.id}-reef.png`;
        files.set(img, encodePng(canvas.rgb, canvas.w, canvas.h));
      }
      let html = caption(r, rec, img, atollOf(rec));
      if (r.kulhi !== null) {
        const k = r.kulhi;
        const ls = checkedFiles(join(rawDir, k.dir), [k.files.red, k.files.green, k.files.blue]);
        const lb = [k.files.red, k.files.green, k.files.blue].map((b) => (ls.get(b) as { bytes: Uint8Array }).bytes);
        const bg = background(lb, k.window.x0, k.window.y0, k.window.sizePx, 30, (dn) => dn * 0.0000275 - 0.2);
        const kp = (p: LonLat): [number, number] => bg.toCanvas(p[0], p[1], zone);
        ring(bg.canvas, r.coast.map(kp), COLOURS.coast, 1);
        for (const m of k.rings) ring(bg.canvas, m.map(kp), COLOURS.kulhi, 2);
        const kname = `${r.id}-kulhi-1997.png`;
        files.set(kname, encodePng(bg.canvas.rgb, bg.canvas.w, bg.canvas.h));
        html += `
<figure>
  <img src="${kname}" width="${bg.canvas.w}" height="${bg.canvas.h}" alt="${escape(labelOf(r))}'s kulhi traced on Landsat 5, 1997-04-15">
  <figcaption>
    <h2>${escape(labelOf(r))}'s kulhi, 1997-04-15 <small>Landsat 5 TM, 30 m</small></h2>
    <p>Cyan: the open water the island's own land enclosed in 1997, traced (scripts/reef/kulhi.ts), ${k.rings.length} ring(s). White: today's charted coastline, which in 1997 was lagoon along the west shore. The airport has since filled most of it (by 2019-03-27).</p>
  </figcaption>
</figure>`;
      }
      figures.set(r.id, html);
    }
  }
  const legend = `<p class="legend"><span style="color:rgb(${COLOURS.edge.join(",")})">■ traced edge</span> <span style="color:rgb(${COLOURS.crest.join(",")})">■ traced crest</span> <span style="color:rgb(${COLOURS.osm.join(",")})">■ OpenStreetMap's reef</span> <span style="color:#fff">■ charted coastline</span> <span style="color:rgb(${COLOURS.disagree.join(",")})">■ a bearing over 20 m apart</span> <span style="color:rgb(${COLOURS.bright.join(",")})">■ something bright near the edge</span> <span style="color:rgb(${COLOURS.drawn.join(",")})">■ a drawn band (D387), not a trace</span></p>`;
  const rows = ordered.map((r) => {
    const rec = manifest.islands.find((i) => i.id === r.id) as SheetRecord;
    const off = rec.result?.reefAreaM2.offPercent;
    const gap = rec.kind === "drawn" ? "drawn band (D387)" : off === null || off === undefined ? "no OSM reef" : `${off > 0 ? "+" : ""}${off} %`;
    return `<tr><td><a href="#${escape(r.id)}">${escape(labelOf(r))}</a></td><td>${escape(atollOf(rec))}</td><td>${escape(gap)}</td><td>${r.flags.length}</td><td>${rec.window.grownFromPx === undefined ? "" : `${rec.window.grownFromPx} → ${rec.window.sizePx} px`}</td></tr>`;
  });
  const parts = batches.map((b) => b.part).join(" and ");
  const counts = {
    islands: ordered.length,
    drawn: ordered.filter((r) => r.kind === "drawn").length,
    over: ordered.filter((r) => {
      const rec = manifest.islands.find((i) => i.id === r.id);
      const o = rec?.kind === "traced" ? rec.result?.reefAreaM2.offPercent : null;
      return o !== null && o !== undefined && Math.abs(o) > 10;
    }).length,
  };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Traced reefs, ${escape(parts)}, for the owner's verdict</title>
<style>body{background:#111;color:#ddd;font:15px/1.45 -apple-system,system-ui,sans-serif;margin:24px;max-width:1400px}h1{font-weight:600}figure{display:flex;gap:20px;align-items:flex-start;margin:0 0 28px}figure img{width:640px;height:auto;image-rendering:pixelated}figcaption{max-width:620px}h2{margin:0 0 6px;font-weight:600}small{color:#999;font-weight:400}code{color:#fc6}.legend span{margin-right:14px;white-space:nowrap}.credits{color:#999;font-size:13px;border-top:1px solid #333;padding-top:10px}table{border-collapse:collapse;margin:0 0 24px}td,th{padding:2px 10px;border-bottom:1px solid #2a2a2a;text-align:left}a{color:#8cf}.none{width:640px;height:120px;display:flex;align-items:center;justify-content:center;border:1px dashed #444;color:#777}</style></head>
<body>
<h1>Traced reefs, ${escape(parts)}: ${counts.islands} island(s)</h1>
<p>For your verdict (AC163, D389, D394: this sheet is the whole verdict): does each traced edge match the reef you see? The doubtful come first: any island that would not trace, then the largest gaps against OpenStreetMap's area, then cloud over the water, then no OSM reef. ${counts.over} traced reef(s) differ from OpenStreetMap's area by more than AC162's 10 %; D392 makes each a disagreement for you to judge, not a refusal. ${counts.drawn} would not trace and have D387's drawn band instead (green). Reefs ids: ${batches.map((b) => `${b.part} <code>${escape(b.id)}</code>`).join(", ")}.</p>
${legend}
<table><tr><th>Island</th><th>Atoll</th><th>Against OSM's area</th><th>Flags</th><th>Window widened</th></tr>
${rows.join("\n")}
</table>
${ordered.map((r) => figures.get(r.id) as string).join("\n")}
<p class="credits">${manifest.licence.map(escape).join("<br>")}</p>
</body></html>
`;
  const label = `Traced reefs ${parts}: the owner's review figure (D389, AC163), made by scripts/reef/review-sheet.ts at the game repository's commit ${commit}.
Reefs ids: ${batches.map((b) => `${b.part} ${b.id}`).join(", ")}
Order: ${ordered.map((r) => `${labelOf(r)} (${r.kind === "drawn" ? "drawn band, " : ""}${r.flags.length} flag(s))`).join(", ")}
Open index.html. Each panel is a Sentinel-2 or Landsat window with the traced outlines drawn on it; the words are in the page.
This folder holds imagery and stays outside the repository (D269). ${manifest.licence.join(" ")}
`;
  return { files, html, label };
}

/** A path with every existing ancestor resolved through symlinks (macOS's /var is /private/var), so "inside" is decided on real paths. */
function realResolve(p: string): string {
  if (existsSync(p)) return realpathSync(p);
  const up = dirname(p);
  return up === p ? p : join(realResolve(up), basename(p));
}

function main(argv: readonly string[]): number {
  const args = [...argv];
  const at = args.indexOf("--part");
  let part: Part | null = null;
  if (at >= 0) {
    const p = args[at + 1];
    if (p !== "RF1" && p !== "RF2") {
      console.error("review-sheet: could not run, not a pass: --part takes RF1 or RF2");
      return 2;
    }
    part = p;
    args.splice(at, 2);
  }
  const [rawDir, outDir] = args;
  try {
    if (rawDir === undefined || outDir === undefined) throw new CouldNotRun("usage: node scripts/reef/review-sheet.ts <assets-raw dir> <out dir> [--part RF1|RF2]");
    const out = realResolve(resolve(outDir));
    const rel = relative(realpathSync(REPO), out);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Refused(`${out} is inside the repository: the figure holds imagery, which never enters it (D269)`);
    const head = spawnSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
    const dirty = spawnSync("git", ["-C", REPO, "status", "--porcelain", "--", "scripts", "src"], { encoding: "utf8" });
    const commit = head.status === 0 ? `${head.stdout.trim()}${dirty.stdout.trim() === "" ? "" : " plus uncommitted changes to scripts/ or src/"}` : "(git not readable)";
    const s = sheet(resolve(rawDir), commit, part);
    mkdirSync(out, { recursive: true });
    for (const [name, bytes] of s.files) writeFileSync(join(out, name), bytes);
    writeFileSync(join(out, "index.html"), s.html);
    writeFileSync(join(out, "LABEL.txt"), s.label);
    console.log(`review-sheet: wrote ${s.files.size} panel(s), index.html and LABEL.txt into ${out}`);
    return 0;
  } catch (e) {
    if (e instanceof CouldNotRun) {
      console.error(`review-sheet: could not run, not a pass: ${e.message}`);
      return 2;
    }
    if (e instanceof Refused) {
      console.error(`review-sheet: refused: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));

