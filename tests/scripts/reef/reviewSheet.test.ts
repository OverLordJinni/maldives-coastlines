// The reefs' review figure (scripts/reef/review-sheet.ts, D389): never written inside the repository, because it holds
// imagery (D269); written outside, it shows every island, the doubtful first, with the credits the imagery asks for.
//
// Skipped where the real inputs are absent (CI among them): the figure is drawn from the scenes, which stay outside the
// repository. A skip is "could not run", not a pass. **Timeouts, measured** (L61): the sheet builds the reefs once and
// draws four panels, 4.6 s alone on this Mac (2026-10-20); 120 s, for parallel agents' load.
//
// Seen red (L49), each once and reverted: the inside-the-repository guard removed (the guard case red: it wrote its PNGs
// into the worktree, which the control then deleted); the review order taken as the list's order (the order case red:
// Kumundhoo first, where Kandoodhoo has more flags).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../../..");
const RAW = [process.env.REEFS_RAW, join(repo, "../assets-raw"), join(repo, "../../assets-raw")].find((d): d is string => d !== undefined && existsSync(join(d, "sentinel2-scl-candidates-2026-10-20/SHA256SUMS")));
const SLOW = 120_000;
const run = (...args: string[]) => spawnSync(process.execPath, [join(repo, "scripts/reef/review-sheet.ts"), ...args], { encoding: "utf8", cwd: repo });

describe("the review sheet's command", () => {
  it("could not run without its two directories (exit 2)", () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/could not run, not a pass: usage/);
  });
});

describe.skipIf(RAW === undefined)("the review sheet from the real inputs (skipped where they are absent)", () => {
  it(
    "is never written inside the repository (exit 1, nothing written)",
    () => {
      const before = readdirSync(repo).sort();
      const r = run(RAW as string, join(repo, "review-figure-here"));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/inside the repository/);
      expect(readdirSync(repo).sort()).toEqual(before);
    },
    SLOW,
  );

  it(
    "outside it, shows every island, the most flagged first, and the kulhi, with the imagery's credits",
    () => {
      const out = join(mkdtempSync(join(tmpdir(), "kf-review-")), "sheet");
      const r = run(RAW as string, out);
      expect(r.status).toBe(0);
      const files = readdirSync(out).sort();
      expect(files).toEqual(["LABEL.txt", "index.html", "kandoodhoo-reef.png", "kulhudhuffushi-kulhi-1997.png", "kulhudhuffushi-reef.png", "kumundhoo-reef.png"]);
      const html = readFileSync(join(out, "index.html"), "utf8");
      const at = (name: string): number => html.indexOf(`<h2>${name} `);
      expect(at("Kandoodhoo")).toBeGreaterThan(0);
      expect(at("Kandoodhoo")).toBeLessThan(at("Kumundhoo"));
      expect(at("Kumundhoo")).toBeLessThan(at("Kulhudhuffushi"));
      expect(html).toMatch(/Contains modified Copernicus Sentinel data 2025 and 2026/);
      expect(html).toMatch(/Landsat-5 image courtesy of the U\.S\. Geological Survey/);
      expect(html).toMatch(/© OpenStreetMap contributors/);
      expect(readFileSync(join(out, "LABEL.txt"), "utf8")).toMatch(/stays outside the repository \(D269\)/);
    },
    SLOW,
  );
});
