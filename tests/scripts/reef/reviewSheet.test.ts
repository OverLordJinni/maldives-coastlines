// The reefs' review figure (scripts/reef/review-sheet.ts, D389): never written inside the repository, because it holds
// imagery (D269); written outside, it shows every island, the doubtful first, with the credits the imagery asks for.
//
// Skipped where the real inputs are absent (CI among them): the figure is drawn from the scenes, which stay outside the
// repository. A skip is "could not run", not a pass. **Timeouts, measured** (L61): the sheet builds every part's reefs once
// (RF2's 130 among them, about a minute alone on this Mac, 2026-10-21) and draws RF1's four panels; 600 s, for parallel
// agents' load. RF2's own sheet (130 panels) is made by hand into archive/, not here.
//
// Seen red (L49), each once and reverted: the inside-the-repository guard removed (the guard case red: it wrote its PNGs
// into the worktree, which the control then deleted); the review order taken as the list's order (the order case red:
// Kumundhoo first, where Kandoodhoo's gap is larger); `--part` ignored (the RF1 case red: 130 more panels).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../../..");
const RAW = [process.env.REEFS_RAW, join(repo, "../assets-raw"), join(repo, "../../assets-raw")].find((d): d is string => d !== undefined && existsSync(join(d, "sentinel2-scl-candidates-2026-10-21/SHA256SUMS")));
const SLOW = 600_000;
const run = (...args: string[]) => spawnSync(process.execPath, [join(repo, "scripts/reef/review-sheet.ts"), ...args], { encoding: "utf8", cwd: repo });

describe("the review sheet's command", () => {
  it("could not run without its two directories, or with a part that is not one (exit 2)", () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/could not run, not a pass: usage/);
    expect(run("x", "y", "--part", "RF3").status).toBe(2);
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
    "outside it, shows one part's islands, the most doubtful first, and the kulhi, with the imagery's credits",
    () => {
      const out = join(mkdtempSync(join(tmpdir(), "kf-review-")), "sheet");
      const r = run(RAW as string, out, "--part", "RF1");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      const files = readdirSync(out).sort();
      // Kumundhoo w122946807, Kulhudhuffushi w19879671 (and its kulhi), Kandoodhoo w19879485.
      expect(files).toEqual(["LABEL.txt", "index.html", "w122946807-reef.png", "w19879485-reef.png", "w19879671-kulhi-1997.png", "w19879671-reef.png"]);
      const html = readFileSync(join(out, "index.html"), "utf8");
      const at = (id: string): number => html.indexOf(`<h2 id="${id}">`);
      expect(at("w19879485")).toBeGreaterThan(0);
      expect(at("w19879485")).toBeLessThan(at("w122946807"));
      expect(at("w122946807")).toBeLessThan(at("w19879671"));
      expect(html).toMatch(/<h2 id="w19879485">Kandoodhoo /);
      expect(html).toMatch(/Contains modified Copernicus Sentinel data 2025 and 2026/);
      expect(html).toMatch(/Landsat-5 image courtesy of the U\.S\. Geological Survey/);
      expect(html).toMatch(/© OpenStreetMap contributors/);
      expect(readFileSync(join(out, "LABEL.txt"), "utf8")).toMatch(/stays outside the repository \(D269\)/);
    },
    SLOW,
  );
});
