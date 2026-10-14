// check:chart (scripts/chart/check-chart.ts) through its real command line, on copies of the
// committed data in a scratch root: its three outcomes, and PLAN CH0's two negative controls (a
// truncated file; a budget of 1 KB), each of which must fail.
//
// Negative control seen red once (L49), recorded in the CH0 commit: the budget comparison removed
// (the 1 KB case then passed, and this test went red).
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeChart } from "../../../scripts/chart/encode.ts";
import { base64Length, BUDGET_BYTES } from "../../../scripts/chart/check-chart.ts";
import { createHash } from "node:crypto";

const repo = resolve(import.meta.dirname, "../../..");
const CHART = join(repo, "src/assets/chart");

function scratch(edit?: (dir: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "kf-chart-"));
  const dir = join(root, "src/assets/chart");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(CHART, "maldives.bin"), join(dir, "maldives.bin"));
  copyFileSync(join(CHART, "chart-manifest.json"), join(dir, "chart-manifest.json"));
  edit?.(dir);
  return root;
}

const run = (...args: string[]) => spawnSync(process.execPath, [join(repo, "scripts/chart/check-chart.ts"), ...args], { encoding: "utf8", cwd: repo });

const editManifest = (dir: string, f: (m: Record<string, unknown>) => void): void => {
  const p = join(dir, "chart-manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
  f(m);
  writeFileSync(p, JSON.stringify(m));
};

describe("check:chart", () => {
  it("passes the committed data, and says what it cannot see", () => {
    const r = run(scratch());
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^check-chart: ok\. osm-.*islands.*% of the 1,000,000-byte budget\. Not checked here/);
  });

  it("the committed data is within D245's 1 MB as base64, with room (AC128's size part)", () => {
    const bytes = readFileSync(join(CHART, "maldives.bin")).length;
    expect(base64Length(bytes)).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it("negative control: a truncated file fails (exit 1)", () => {
    const root = scratch((dir) => {
      const b = readFileSync(join(dir, "maldives.bin"));
      writeFileSync(join(dir, "maldives.bin"), b.subarray(0, Math.floor(b.length / 2)));
    });
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/does not decode/);
  });

  it("negative control: a budget of 1 KB fails (exit 1)", () => {
    const r = run(scratch(), "--budget", "1024");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/over the budget of 1,024 \(D245\)/);
  });

  it("no chart build is could-not-run (exit 2), never a pass", () => {
    const r = run(mkdtempSync(join(tmpdir(), "kf-chart-empty-")));
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/COULD NOT RUN.*\n.*not a pass/);
  });

  it("a manifest whose counts disagree with the file fails", () => {
    const r = run(scratch((dir) => editManifest(dir, (m) => {
          const counts = m.counts as { islands: number };
          counts.islands += 1;
        })));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/islands: the file holds \d+; the manifest says \d+/);
  });

  it("an island an earlier chart shipped that is now neither island nor alias fails (PLAN Risk 21)", () => {
    const r = run(scratch((dir) => editManifest(dir, (m) => (m.knownIds as string[]).push("w1"))));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/neither islands nor aliases now.*w1/);
  });

  it("a chart without Maavaidhoo, or with Kulhudhuffushi in another atoll, fails", () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
    ];
    const write = (islands: Parameters<typeof encodeChart>[0]["islands"]) => (dir: string) => {
      const bin = encodeChart({ id: "t", atolls: [{ id: "a", name: "A" }, { id: "b", name: "B" }], cloud: [], islands, aliases: [] });
      writeFileSync(join(dir, "maldives.bin"), bin);
      editManifest(dir, (m) => {
        m.chartId = "t";
        m.bin = { bytes: bin.length, sha256: createHash("sha256").update(bin).digest("hex") };
        m.counts = { islands: islands.length, atolls: 2, cloudAreas: 0, points: 3 * islands.length, aliases: 0 };
        m.knownIds = [];
      });
    };
    const missing = run(scratch(write([{ id: "w19879671", atoll: "a", ring }])));
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/Maavaidhoo \(w19879672\), the home island, is not in the chart/);
    const apart = run(scratch(write([{ id: "w19879672", atoll: "a", ring }, { id: "w19879671", atoll: "b", ring }])));
    expect(apart.status).toBe(1);
    expect(apart.stderr).toMatch(/D118 needs one atoll/);
  });
});
