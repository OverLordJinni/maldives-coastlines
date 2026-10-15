// The reef's build (scripts/reef/build-reef.ts): it refuses to run without inputs its records describe, and, where the
// OSM extract and the Sentinel-2 scene are on this machine, rebuilds the committed reef.json and its manifest byte for
// byte (R57: the record is the means to rebuild it exactly).
//
// **The rebuild is skipped wherever the inputs are absent, which includes CI**: 3.6 MB of ODbL data and 230 MB of
// Copernicus imagery stay outside the repository (D269: no pixel in the repository). A skip is "could not run", not a
// pass; vitest lists it as skipped. Set REEF_OSM and REEF_S2 to their directories to run it elsewhere.
// Seen red (L49): with the SHA256SUMS comparison removed from `checkedFiles`, a mismatched sum built (exit 0) and the
// "disagrees" case went red.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "../../../scripts/reef/build-reef.ts";

const repo = resolve(import.meta.dirname, "../../..");
const find = (env: string | undefined, name: string, file: string): string | undefined =>
  [env, join(repo, `../assets-raw/${name}`), join(repo, `../../assets-raw/${name}`)].find((d): d is string => d !== undefined && existsSync(join(d, file)));
const OSM = find(process.env.REEF_OSM, "osm-2026-10-14", "maldives-latest.osm.pbf");
const S2 = find(process.env.REEF_S2, "sentinel2-2026-04-20", "B03.tif");

const run = (...args: string[]) => spawnSync(process.execPath, [join(repo, "scripts/reef/build-reef.ts"), ...args], { encoding: "utf8", cwd: repo });

describe("pnpm reef refuses to run without inputs its records describe (exit 2, nothing written)", () => {
  it("no directories given", () => {
    const r = run();
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/could not run, not a pass: usage/);
  });

  it("a directory with no SHA256SUMS", () => {
    const dir = mkdtempSync(join(tmpdir(), "kf-reef-"));
    writeFileSync(join(dir, "maldives-latest.osm.pbf"), "not a pbf");
    const r = run(dir, dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/SHA256SUMS: missing/);
  });

  it("a file that SHA256SUMS disagrees with", () => {
    const dir = mkdtempSync(join(tmpdir(), "kf-reef-"));
    writeFileSync(join(dir, "maldives-latest.osm.pbf"), "not a pbf");
    writeFileSync(join(dir, "SHA256SUMS"), `${"0".repeat(64)}  maldives-latest.osm.pbf\n`);
    const r = run(dir, dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/is not the 0{64}/);
  });
});

describe.skipIf(OSM === undefined || S2 === undefined)("the committed reef rebuilds byte for byte from its inputs (skipped where they are absent)", () => {
  it("gives the same reef.json and reef-manifest.json", () => {
    const built = build(OSM as string, S2 as string);
    expect(built.data).toBe(readFileSync(join(repo, "src/assets/reef/reef.json"), "utf8"));
    expect(built.manifest).toBe(readFileSync(join(repo, "src/assets/reef/reef-manifest.json"), "utf8"));
  });

  it("refuses a scene its record does not describe", () => {
    const dir = mkdtempSync(join(tmpdir(), "kf-reef-s2-"));
    for (const f of ["B03.tif", "B08.tif", "item.json", "SHA256SUMS"]) copyFileSync(join(S2 as string, f), join(dir, f));
    writeFileSync(join(dir, "item.json"), "{}");
    const r = run(OSM as string, dir);
    expect(r.status).toBe(2);
  });
});
