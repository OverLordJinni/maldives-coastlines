// The kulhi on Kulhudhuffushi as it was (D362, D380, D388; R83, H50): the island's wetland placed from satellite images,
// not guessed. The pure steps; build-reefs.ts reads the files and calls these.
//
// **Which images** (RF1's first finding, 2026-10-20). PLAN v2.6 took "the open archive's first clear Sentinel-2 scene over
// the island" to be 2018-09-04 (L1C, 0.8 %). That item is tile 23XMJ, in the Arctic: its footprint in Earth Search is the
// whole globe (−180..180, −90..90), so a search by point matches it everywhere. Tile 43NBH's own archive starts on
// 2017-01-07, but until June 2021 every acquisition covered a sliver of the tile: all 42 of its 2017–2019 scenes under 20 %
// cloud that have a scene classification hold no data at all over the island's window (assets-raw/
// sentinel2-early-scl-2026-10-20/). The first Sentinel-2 images of Kulhudhuffushi are from June 2021, and Landsat shows the
// airport's runway across the kulhi by 2019-03-27 (it is not there on 2017-10-15). So no Sentinel-2 image shows the kulhi
// before the works, and D388 applies: **public-domain Landsat** (USGS Collection 2 Level-2, 30 m). Of 163 Landsat scenes
// over the island under 30 % cloud, 1982–2021, the earliest with its window clear over the island is **Landsat 5 TM,
// 1997-04-15** (the only earlier one, 1990-02-23, has cloud on 2,356 of the island's 2,795 pixels). It predates the airport
// (2017–2019) and the reclaimed strip along the west shore (there by 2015, not in 2000).
//
// **The method, and why it is this one.** In 1997 the kulhi is open water ringed by the island's own land: a lagoon cut
// off from the sea, which is what a kulhi is. So it is found by topology, not by a colour guessed at:
//   1. **Water** is MNDWI ≥ 0, the modified normalised difference water index (Xu 2006): (green − SWIR1) / (green +
//      SWIR1), TM bands 2 and 5 as surface reflectance. SWIR, not near-infrared (NDWI, as the reef's land rule uses): a
//      shallow, muddy, weedy pond can be bright in near-infrared, and SWIR is absorbed by any water a few centimetres deep.
//      0 is the index's own boundary, not a number tuned to this scene.
//   2. **Enclosed** water is water the open sea cannot reach through water: everything reached by a 4-connected flood from
//      the window's border is sea, lagoon or reef flat, and what is left is enclosed. 4-connected, so two pixels touching
//      only at a corner do not join a pond to the sea through a sand bar narrower than a pixel.
//   3. **The kulhi** is the largest enclosed region whose centre lies inside the island's charted outline, if it has at
//      least `MIN_PX` pixels. One region, because D362 and D380 name one wetland, "the kulhi": on 1997-04-15 the island
//      also encloses two pools of 4 and 9 pixels by its south-east shore, which no decision names, and drawing them as
//      marsh would add to the island what nobody asked for. Every other enclosed region is listed in the record, with
//      its size and centre, and not drawn.
//   4. **Its outline** is the contour at MNDWI = 0 by marching squares (trace.ts `contours`), sub-pixel, with every water
//      pixel that is not part of the kulhi held at −1 so only the kulhi's own shore is traced; then Douglas–Peucker at
//      15 m true (half a 30 m pixel, as the reef's 5 m is half a 10 m one).
// The build refuses (nothing written) if the island holds no enclosed water, or if the scene's quality band flags cloud,
// shadow or fill on the kulhi or the pixels round it.
//
// Rejected: tracing the kulhi on a recent Sentinel-2 scene (the airport and its fill cover most of it, D362's "as it was"
// is the point); drawing the ponds OSM maps today (11.5 ha, the remnant); Landsat 8 (2013–2017, 30 m, also before the
// airport) as the source, because 1997 is earlier and clear, and the west shore was already reclaimed by 2015; a
// classifier for mangrove (no labelled data for it, and 30 m mixes mangrove and palm).
//
// What it cannot see: the marsh's mangrove margin, which reads as land at 30 m; the water's extent in another season
// (1997-04-15 is the end of the dry north-east monsoon, so this is likely the kulhi at its smallest); anything narrower
// than about a pixel; and whether 1997 is "as it was" before 1153, which is H50's claim and the owner's to sign.
import type { Px } from "./trace.ts";
import { contours, inside } from "./trace.ts";

/** The smallest enclosed water drawn as a kulhi, pixels (2,700 m² at 30 m: a pond, not a well or a shadow). */
export const MIN_PX = 3;
/** Douglas–Peucker tolerance for the kulhi's outline, metres at true scale: half a 30 m pixel. */
export const KULHI_TOLERANCE_TRUE_M = 15;
/** MNDWI at or above this is water (the index's own boundary). */
export const WATER_MNDWI = 0;

/** The modified normalised difference water index from surface reflectances; both at or below 0 reads as water. */
export function mndwi(green: number, swir1: number): number {
  const sum = green + swir1;
  if (sum <= 0) return 1;
  return (green - swir1) / sum;
}

export interface Enclosed {
  /** Each enclosed region's pixel indices (row-major), in order of their first pixel. */
  readonly regions: readonly (readonly number[])[];
  /** Whether each pixel is water reached from the border. */
  readonly sea: Uint8Array;
}

/** Water the border cannot reach through 4-connected water, as regions (step 2 of the header). */
export function enclosedWater(water: Uint8Array, width: number, height: number): Enclosed {
  const sea = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (k: number): void => {
    if (water[k] === 1 && sea[k] === 0) {
      sea[k] = 1;
      stack.push(k);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  const flood = (seen: Uint8Array, region: number[] | null): void => {
    while (stack.length > 0) {
      const k = stack.pop() as number;
      region?.push(k);
      const x = k % width;
      const y = (k - x) / width;
      const next = [x > 0 ? k - 1 : -1, x < width - 1 ? k + 1 : -1, y > 0 ? k - width : -1, y < height - 1 ? k + width : -1];
      for (const n of next) {
        if (n < 0 || water[n] !== 1 || seen[n] === 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  };
  flood(sea, null);
  const done = new Uint8Array(width * height);
  const regions: number[][] = [];
  for (let k = 0; k < width * height; k++) {
    if (water[k] !== 1 || sea[k] === 1 || done[k] === 1) continue;
    const region: number[] = [];
    done[k] = 1;
    stack.push(k);
    flood(done, region);
    regions.push(region.sort((a, b) => a - b));
  }
  return { regions, sea };
}

/**
 * The kulhi's loops in pixel coordinates (trace.ts's: pixel centres at +0.5) from the window's MNDWI, the regions to draw,
 * and the window's size: the contour at `WATER_MNDWI` with every other water pixel held at −1 (step 4 of the header).
 * One loop per region: the smallest loop holding the region's first pixel, which is its own shore (an islet in the pond is a
 * loop that does not hold it); null for a region with no closed loop.
 */
export function kulhiLoops(index: Float64Array, keep: readonly (readonly number[])[], width: number, height: number): (Px[] | null)[] {
  const kept = new Uint8Array(width * height);
  for (const r of keep) for (const k of r) kept[k] = 1;
  const field = Float64Array.from(index, (v, k) => (v >= WATER_MNDWI && kept[k] !== 1 ? -1 : v));
  const loops = contours(field, width, height, WATER_MNDWI);
  return keep.map((r) => {
    const k = r[0] as number;
    const p: Px = [(k % width) + 0.5, Math.floor(k / width) + 0.5];
    let best: Px[] | null = null;
    let bestArea = -1;
    for (const l of loops) {
      if (!inside(p, l)) continue;
      let a = 0;
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) a += (l[j] as Px)[0] * (l[i] as Px)[1] - (l[i] as Px)[0] * (l[j] as Px)[1];
      if (best === null || Math.abs(a) < bestArea) {
        best = l;
        bestArea = Math.abs(a);
      }
    }
    return best;
  });
}
