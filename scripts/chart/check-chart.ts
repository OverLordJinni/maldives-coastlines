// check:chart (PLAN CH0; AC128's size part; in `pnpm verify`): the committed chart data is what its
// record says it is, and within budget.
//
//   node scripts/chart/check-chart.ts [<repo root>] [--budget <bytes>]
//
// Holds `src/assets/chart/maldives.bin` to `chart-manifest.json`:
//   - the file decodes (src/rules/chartData.ts, the decoder the app will use), and its sha256 and
//     length are the manifest's;
//   - its chart id, and its counts of islands, atolls, cloud areas, points and aliases, are the
//     manifest's;
//   - Maavaidhoo (w19879672) and Kulhudhuffushi (w19879671) are both islands, in the same atoll
//     (D118, D224);
//   - every island id an earlier chart shipped is still an island or an alias (PLAN Risk 21: a saved
//     state on it must not be orphaned);
//   - **the size is within D245's budget of 1 MB**, measured as the base64 text the bundle carries
//     (PLAN V15 inlines the file as base64, a third larger than the binary). 1 MB is read as
//     1,000,000 bytes, the stricter of the two readings. `--budget` exists for the negative control.
//
// What this cannot see: whether `dist/` actually contains the data (nothing imports it until CH2,
// which adds that half of AC128), whether the outlines are right (the owner's review, AC136), and
// whether the record's extract is the one on disk (`pnpm chart` checks SHA256SUMS; this check never
// reads the extract, which lives outside the repo and is absent in CI).
//
// Exit codes (testing-policy "A check that could not run"):
//   0  ran, and the data matches its record and is within budget
//   1  ran and failed (each problem listed)
//   2  could not run: no chart build (no maldives.bin or no manifest). Not a pass.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ChartDataError, decodeChart, isIslandId, type ChartData } from "../../src/rules/chartData.ts";

export const BUDGET_BYTES = 1_000_000;
const HOME = "w19879672";
const DESTINATION = "w19879671";

const manifestSchema = z.looseObject({
  chartId: z.string(),
  bin: z.looseObject({ bytes: z.int(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  counts: z.looseObject({ islands: z.int(), atolls: z.int(), cloudAreas: z.int(), points: z.int(), aliases: z.int() }),
  knownIds: z.array(z.string().refine(isIslandId)),
});

export type ChartVerdict =
  | { readonly kind: "ok"; readonly bytes: number; readonly base64: number; readonly budget: number; readonly islands: number; readonly chartId: string }
  | { readonly kind: "failed"; readonly problems: readonly string[] }
  | { readonly kind: "could-not-run"; readonly reason: string };

/** The length of `n` bytes as base64 text, with padding. */
export const base64Length = (n: number): number => 4 * Math.ceil(n / 3);

export function checkChart(root: string, budget = BUDGET_BYTES): ChartVerdict {
  const dir = join(root, "src/assets/chart");
  const binPath = join(dir, "maldives.bin");
  const manPath = join(dir, "chart-manifest.json");
  for (const p of [binPath, manPath]) if (!existsSync(p)) return { kind: "could-not-run", reason: `${p} does not exist: no chart build (pnpm chart <extract dir>)` };

  const bytes = new Uint8Array(readFileSync(binPath));
  const problems: string[] = [];
  const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(manPath, "utf8")));
  if (!parsed.success) return { kind: "failed", problems: [`chart-manifest.json does not parse: ${parsed.error.message}`] };
  const m = parsed.data;

  const sha = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== m.bin.bytes) problems.push(`maldives.bin is ${bytes.length} bytes; the manifest says ${m.bin.bytes}`);
  if (sha !== m.bin.sha256) problems.push(`maldives.bin's sha256 is ${sha}; the manifest says ${m.bin.sha256}`);
  const b64 = base64Length(bytes.length);
  if (b64 > budget) problems.push(`the chart is ${b64.toLocaleString("en")} bytes as base64 in the bundle (${bytes.length.toLocaleString("en")} binary), over the budget of ${budget.toLocaleString("en")} (D245)`);

  let chart: ChartData;
  try {
    chart = decodeChart(bytes);
  } catch (e) {
    if (!(e instanceof ChartDataError)) throw e;
    return { kind: "failed", problems: [...problems, `maldives.bin does not decode: ${e.message}`] };
  }
  const counts = {
    islands: chart.islands.length,
    atolls: chart.atolls.length,
    cloudAreas: chart.cloud.length,
    points: chart.islands.reduce((s, i) => s + i.ring.length, 0),
    aliases: chart.aliases.size,
  };
  if (chart.id !== m.chartId) problems.push(`the file's chart id is ${chart.id}; the manifest says ${m.chartId}`);
  for (const [k, v] of Object.entries(counts)) {
    const want = m.counts[k as keyof typeof counts];
    if (v !== want) problems.push(`${k}: the file holds ${v}; the manifest says ${want}`);
  }
  const home = chart.islands.find((i) => i.id === HOME);
  const dest = chart.islands.find((i) => i.id === DESTINATION);
  if (!home) problems.push(`Maavaidhoo (${HOME}), the home island, is not in the chart`);
  if (!dest) problems.push(`Kulhudhuffushi (${DESTINATION}), the crossing's destination, is not in the chart`);
  if (home && dest && home.atoll !== dest.atoll) problems.push(`Maavaidhoo is in ${home.atoll} and Kulhudhuffushi in ${dest.atoll}: D118 needs one atoll`);
  const ids = new Set<string>(chart.islands.map((i) => i.id));
  const orphaned = m.knownIds.filter((id) => !ids.has(id) && !chart.aliases.has(id as never));
  if (orphaned.length > 0) problems.push(`island ids an earlier chart shipped are neither islands nor aliases now (a saved state on them would be lost): ${orphaned.join(", ")}`);
  if (chart.islands.length === 0) problems.push("the chart holds no islands");

  if (problems.length > 0) return { kind: "failed", problems };
  return { kind: "ok", bytes: bytes.length, base64: b64, budget, islands: chart.islands.length, chartId: chart.id };
}

// Real paths on both sides: through a symlink (macOS's /var is /private/var) a plain comparison is
// false, and the script would exit 0 having done nothing, which reads as a pass.
const invoked = process.argv[1] !== undefined && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--budget");
  let budget = BUDGET_BYTES;
  if (at >= 0) {
    budget = Number(args[at + 1]);
    args.splice(at, 2);
    if (!Number.isInteger(budget) || budget <= 0) {
      console.error(`check-chart: COULD NOT RUN: --budget needs a whole number of bytes\nThis is not a pass.`);
      process.exit(2);
    }
  }
  const root = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), "../.."));
  const v = checkChart(root, budget);
  switch (v.kind) {
    case "ok":
      console.log(`check-chart: ok. ${v.chartId}: ${v.islands} islands, ${v.bytes.toLocaleString("en")} bytes (${v.base64.toLocaleString("en")} as base64), ${((100 * v.base64) / v.budget).toFixed(1)} % of the ${v.budget.toLocaleString("en")}-byte budget. Not checked here: that dist/ carries it (CH2) and that the outlines are right (AC136).`);
      process.exit(0);
      break;
    case "failed":
      console.error(`check-chart: FAILED\n${v.problems.map((p) => `  - ${p}`).join("\n")}`);
      process.exit(1);
      break;
    case "could-not-run":
      console.error(`check-chart: COULD NOT RUN: ${v.reason}\nThis is not a pass. Nothing was compared.`);
      process.exit(2);
  }
}
