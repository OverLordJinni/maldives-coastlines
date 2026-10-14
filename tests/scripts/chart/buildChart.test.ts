// The chart build (scripts/chart/build-chart.ts): it refuses an extract its record does not
// describe, quantises once, and, where the extract is on this machine, rebuilds the committed chart
// byte for byte (R57: the record is the means to rebuild it exactly).
//
// **The rebuild case is skipped wherever the extract is absent, which includes CI**: the extract is
// 3.6 MB of ODbL data that stays outside the repository (PLAN CH0). A skip is "could not run", not a
// pass; vitest lists it as skipped. Set CHART_EXTRACT to the extract's directory to run it.
//
// Negative control seen red once (L49), recorded in the CH0 commit: the SHA256SUMS comparison
// removed from `readExtractDir` (the mismatched sum then built, and this test went red).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build, quantise } from "../../../scripts/chart/build-chart.ts";

const repo = resolve(import.meta.dirname, "../../..");
// From game/ the extract is ../assets-raw; from a worktree under worktrees/<task> it is ../../assets-raw.
const EXTRACT = [process.env.CHART_EXTRACT, join(repo, "../assets-raw/osm-2026-10-14"), join(repo, "../../assets-raw/osm-2026-10-14")].find(
  (d): d is string => d !== undefined && existsSync(join(d, "maldives-latest.osm.pbf")),
);

const run = (...args: string[]) => spawnSync(process.execPath, [join(repo, "scripts/chart/build-chart.ts"), ...args], { encoding: "utf8", cwd: repo });

describe("pnpm chart refuses to run without an extract its record describes (exit 2, nothing written)", () => {
  it("no directory given", () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/COULD NOT RUN: usage/);
  });

  it("a directory with no SHA256SUMS", () => {
    const dir = mkdtempSync(join(tmpdir(), "kf-extract-"));
    writeFileSync(join(dir, "maldives-latest.osm.pbf"), "not a pbf");
    writeFileSync(join(dir, "fetched-at.txt"), "2026-10-14T12:48:06Z\n");
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/SHA256SUMS does not exist/);
  });

  it("a file whose sha256 disagrees with SHA256SUMS", () => {
    const dir = mkdtempSync(join(tmpdir(), "kf-extract-"));
    writeFileSync(join(dir, "maldives-latest.osm.pbf"), "not the extract");
    writeFileSync(join(dir, "fetched-at.txt"), "2026-10-14T12:48:06Z\n");
    writeFileSync(join(dir, "SHA256SUMS"), `${"0".repeat(64)}  maldives-latest.osm.pbf\n`);
    const r = run(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Refusing to build from a file the record does not describe/);
  });
});

describe("quantising once", () => {
  it("rounds to 1e-5 degrees and drops a point that rounds onto its neighbour, or onto the first", () => {
    expect(
      quantise([
        [73.000001, 6.5],
        [73.000002, 6.500001],
        [73.1, 6.5],
        [73.05, 6.6],
        [73.000004, 6.499999],
      ]),
    ).toEqual([
      [7_300_000, 650_000],
      [7_310_000, 650_000],
      [7_305_000, 660_000],
    ]);
  });
});

describe.skipIf(EXTRACT === undefined)("the committed chart is rebuilt byte for byte from the extract (local only; see the header)", () => {
  it("same bytes, same record", () => {
    const dir = EXTRACT as string;
    // Built with no previous chart: aliases come only from a previous chart, and this one has none.
    const { bin, manifest } = build(dir, null);
    const committed = readFileSync(join(repo, "src/assets/chart/maldives.bin"));
    expect(createHash("sha256").update(bin).digest("hex")).toBe(createHash("sha256").update(committed).digest("hex"));
    expect(`${JSON.stringify(manifest, null, 2)}\n`).toBe(readFileSync(join(repo, "src/assets/chart/chart-manifest.json"), "utf8"));
  });

  it("a stale hand list (a ring not in the extract) is refused, exit 1", () => {
    // Copy the extract's provenance into a scratch dir next to a hand list that names a missing ring:
    // the build reads excluded.json from scripts/chart, so this runs the module in a copied tree.
    const tree = mkdtempSync(join(tmpdir(), "kf-tree-"));
    const files = ["pbf.ts", "extract.ts", "geometry.ts", "islands.ts", "filter.ts", "encode.ts", "build-chart.ts", "atolls.json"];
    spawnSync("mkdir", ["-p", join(tree, "scripts/chart"), join(tree, "src/rules")]);
    for (const f of files) copyFileSync(join(repo, "scripts/chart", f), join(tree, "scripts/chart", f));
    copyFileSync(join(repo, "src/rules/chartData.ts"), join(tree, "src/rules/chartData.ts"));
    spawnSync("ln", ["-s", join(repo, "node_modules"), join(tree, "node_modules")]);
    const hand = JSON.parse(readFileSync(join(repo, "scripts/chart/excluded.json"), "utf8")) as { excluded: unknown[] };
    hand.excluded.push({ id: "w1", name: "Nowhere", reason: "test", source: "test" });
    writeFileSync(join(tree, "scripts/chart/excluded.json"), JSON.stringify(hand));
    const r = spawnSync(process.execPath, [join(tree, "scripts/chart/build-chart.ts"), dir()], { encoding: "utf8", cwd: tree });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/excluded\.json names rings that are not in this extract: w1 \(Nowhere\)/);
    expect(existsSync(join(tree, "src/assets/chart/maldives.bin"))).toBe(false);
  });
});

const dir = (): string => EXTRACT as string;
