// The review figure for the traced reefs (D389; AC163 as draft 18.1 extends it): one contact sheet the owner judges on the
// Mac, the doubtful islands first. Each panel is the island's window from the scene its reef was traced from, true colour,
// with the traced edge and crest, OpenStreetMap's reef, the charted coastline and every bearing where the traced edge and
// OSM's differ by more than 20 m; Kulhudhuffushi's kulhi gets its own panel over the 1997 Landsat scene it was traced from.
//
//   node scripts/reef/review-sheet.ts <assets-raw dir> <out dir>
//   e.g. node scripts/reef/review-sheet.ts ../../assets-raw ../../archive/rf1-2026-10-20      (from a worktree)
//
// Writes `index.html` (the sheet: panels and their words), one PNG per panel and `LABEL.txt` (what the folder is, how it
// was made, from which commit's scripts). **It holds imagery, so it is written only outside the repository** (D269: no
// pixel in the repository or the app): an out dir inside it is refused, exit 1. The repository keeps this script and the
// record (reefs-manifest.json), never the figure (PLAN v2.6).
//
// **Refused islands are drawn too.** The build refuses an island whose traced reef is more than 10 % from OSM's (AC162) and
// writes nothing; the sheet still shows it, first, with the refusal in its caption, because the refusal is exactly what
// the owner is being asked to judge.
//
// Text is HTML, not drawn into the pictures: no font to embed, and the words stay searchable and readable at any size.
//
// Exit codes: 0 written; 1 refused (an out dir inside the repository); 2 could not run (an input missing or disagreeing).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkedFiles, CouldNotRun, Refused } from "./build-reef.ts";
import { build, type ReviewIsland } from "./build-reefs.ts";
import { encodePng } from "./png.ts";
import { readTiff, readWindow } from "./tiff.ts";
import { frameAt } from "./transform.ts";
import { toUtm } from "./utm.ts";
import { ISLAND_SOURCE } from "../../src/rules/islandSource.ts";
import type { LonLat } from "../../src/rules/chartData.ts";

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

/** The sheet's panels (PNG bytes by file name) and its HTML, from the build's review data. Pure apart from reading bands. */
export function sheet(rawDir: string, commit = "(not given)"): { files: Map<string, Uint8Array>; html: string; label: string } {
  const built = build(rawDir);
  const manifest = JSON.parse(built.manifest) as { id: string; review: { order: string[] }; licence: string[]; islands: { id: string; sentinel2: { scene: string; sensed: string }; result: { reefAreaM2: { traced: number; osm: number | null; offPercent: number | null } } }[] };
  const files = new Map<string, Uint8Array>();
  const figures: string[] = [];
  const zone = 43;
  const ordered = manifest.review.order.map((id) => built.review.find((r) => r.id === id) as ReviewIsland);
  for (const r of ordered) {
    const rec = manifest.islands.find((i) => i.id === r.id) as (typeof manifest.islands)[number];
    const s2 = checkedFiles(join(rawDir, r.sceneDir), ["B04.tif", "B03.tif", "B02.tif"]);
    const bands = ["B04.tif", "B03.tif", "B02.tif"].map((b) => (s2.get(b) as { bytes: Uint8Array }).bytes);
    const { canvas, toCanvas } = background(bands, r.window.x0, r.window.y0, r.window.sizePx, 10, (dn) => dn / 10_000);
    const px = (p: LonLat): [number, number] => toCanvas(p[0], p[1], zone);
    ring(canvas, r.coast.map(px), COLOURS.coast, 1);
    if (r.osm !== null) ring(canvas, r.osm.map(px), COLOURS.osm, 2);
    ring(canvas, r.crest.map(px), COLOURS.crest, 2);
    ring(canvas, r.edge.map(px), COLOURS.edge, 2);
    for (const o of r.others) ring(canvas, o.map(px), COLOURS.bright, 2);
    // Each disagreeing bearing as a red stroke between the two edges, along the ray from the island's centroid.
    const frame = frameAt({ lon0: r.window.centre[0], lat0: r.window.centre[1], scale: ISLAND_SOURCE.scale });
    for (const d of r.disagree) {
      const t = (d.deg * Math.PI) / 180;
      const at = (m: number): [number, number] => px(frame.fromTrue(Math.cos(t) * m, Math.sin(t) * m));
      segment(canvas, at(d.tracedM), at(d.osmM), COLOURS.disagree, 3);
    }
    const name = `${r.name.toLowerCase()}-reef.png`;
    files.set(name, encodePng(canvas.rgb, canvas.w, canvas.h));
    const area = rec.result.reefAreaM2;
    figures.push(`<figure>
  <img src="${name}" width="${canvas.w}" height="${canvas.h}" alt="${escape(r.name)}'s traced reef over ${escape(rec.sentinel2.scene)}">
  <figcaption>
    <h2>${escape(r.name)} <small>${escape(r.id)}</small></h2>
    <p>Traced from <code>${escape(rec.sentinel2.scene)}</code>, sensed ${escape(rec.sentinel2.sensed.slice(0, 10))}. Reef area ${area.traced.toLocaleString("en")} m² traced against OpenStreetMap's ${area.osm === null ? "(none mapped)" : `${area.osm.toLocaleString("en")} m²: <b>${area.offPercent === null ? "" : `${area.offPercent > 0 ? "+" : ""}${area.offPercent} %`}</b>`} (AC162 allows 10 %).</p>
    <p>${r.flags.length === 0 ? "No flags." : `<b>Flags:</b></p><ul>${r.flags.map((f) => `<li>${escape(f)}</li>`).join("")}</ul><p>`}</p>
    <p>${r.disagree.length} of 72 bearings more than 20 m from OpenStreetMap's edge${r.disagree.length === 0 ? "" : ` (degrees from east towards south: traced / OSM metres from the centroid): ${r.disagree.map((d) => `${d.deg}° ${d.tracedM}/${d.osmM}`).join(", ")}`}.</p>
  </figcaption>
</figure>`);
    if (r.kulhi !== null) {
      const k = r.kulhi;
      const ls = checkedFiles(join(rawDir, k.dir), [k.files.red, k.files.green, k.files.blue]);
      const lb = [k.files.red, k.files.green, k.files.blue].map((b) => (ls.get(b) as { bytes: Uint8Array }).bytes);
      const bg = background(lb, k.window.x0, k.window.y0, k.window.sizePx, 30, (dn) => dn * 0.0000275 - 0.2);
      const kp = (p: LonLat): [number, number] => bg.toCanvas(p[0], p[1], zone);
      ring(bg.canvas, r.coast.map(kp), COLOURS.coast, 1);
      for (const m of k.rings) ring(bg.canvas, m.map(kp), COLOURS.kulhi, 2);
      const kname = `${r.name.toLowerCase()}-kulhi-1997.png`;
      files.set(kname, encodePng(bg.canvas.rgb, bg.canvas.w, bg.canvas.h));
      figures.push(`<figure>
  <img src="${kname}" width="${bg.canvas.w}" height="${bg.canvas.h}" alt="${escape(r.name)}'s kulhi traced on Landsat 5, 1997-04-15">
  <figcaption>
    <h2>${escape(r.name)}'s kulhi, 1997-04-15 <small>Landsat 5 TM, 30 m</small></h2>
    <p>Cyan: the open water the island's own land enclosed in 1997, traced (scripts/reef/kulhi.ts), ${k.rings.length} ring(s). White: today's charted coastline, which in 1997 was lagoon along the west shore. The airport has since filled most of it (by 2019-03-27).</p>
  </figcaption>
</figure>`);
    }
  }
  const legend = `<p class="legend"><span style="color:rgb(${COLOURS.edge.join(",")})">■ traced edge</span> <span style="color:rgb(${COLOURS.crest.join(",")})">■ traced crest</span> <span style="color:rgb(${COLOURS.osm.join(",")})">■ OpenStreetMap's reef</span> <span style="color:#fff">■ charted coastline</span> <span style="color:rgb(${COLOURS.disagree.join(",")})">■ a bearing over 20 m apart</span> <span style="color:rgb(${COLOURS.bright.join(",")})">■ something bright near the edge</span></p>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Traced reefs, RF1, for the owner's verdict</title>
<style>body{background:#111;color:#ddd;font:15px/1.45 -apple-system,system-ui,sans-serif;margin:24px;max-width:1400px}h1{font-weight:600}figure{display:flex;gap:20px;align-items:flex-start;margin:0 0 28px}figcaption{max-width:620px}h2{margin:0 0 6px;font-weight:600}small{color:#999;font-weight:400}code{color:#fc6}.legend span{margin-right:14px;white-space:nowrap}.credits{color:#999;font-size:13px;border-top:1px solid #333;padding-top:10px}</style></head>
<body>
<h1>Traced reefs, RF1: Kumundhoo, Kulhudhuffushi, Kandoodhoo</h1>
<p>For your verdict (AC163, D389): does each traced edge match the reef you see? The doubtful come first. Reefs id <code>${escape(manifest.id)}</code>.</p>
${legend}
${figures.join("\n")}
<p class="credits">${manifest.licence.map(escape).join("<br>")}</p>
</body></html>
`;
  const label = `Traced reefs RF1: the owner's review figure (D389, AC163), made by scripts/reef/review-sheet.ts at the game repository's commit ${commit}.
Reefs id: ${manifest.id}
Order: ${ordered.map((r) => `${r.name} (${r.flags.length} flag(s))`).join(", ")}
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
  const [rawDir, outDir] = argv;
  try {
    if (rawDir === undefined || outDir === undefined) throw new CouldNotRun("usage: node scripts/reef/review-sheet.ts <assets-raw dir> <out dir>");
    const out = realResolve(resolve(outDir));
    const rel = relative(realpathSync(REPO), out);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Refused(`${out} is inside the repository: the figure holds imagery, which never enters it (D269)`);
    const head = spawnSync("git", ["-C", REPO, "rev-parse", "--short", "HEAD"], { encoding: "utf8" });
    const dirty = spawnSync("git", ["-C", REPO, "status", "--porcelain", "--", "scripts", "src"], { encoding: "utf8" });
    const commit = head.status === 0 ? `${head.stdout.trim()}${dirty.stdout.trim() === "" ? "" : " plus uncommitted changes to scripts/ or src/"}` : "(git not readable)";
    const s = sheet(resolve(rawDir), commit);
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

