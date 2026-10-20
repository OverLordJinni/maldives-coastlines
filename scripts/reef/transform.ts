// The home island's transform (D182, D186): longitude and latitude to the scene's metres, exactly as the island's outline
// was made from OpenStreetMap way 19879672 (src/rules/tuning.ts `ISLAND_SOURCE`, whose harmonics were fitted to this
// projection; tests/rules/maavaidhoo.test.ts holds the outline to it within 1.5 m).
//
// R75: "the reef is placed with exactly the transform the home island's outline uses, so it sits where it should round
// the shore." So this is that transform written once for the reef's build and its test, and nothing else.
//   - An equirectangular projection round the coastline's area centroid (`lon0`, `lat0`): 111,320 m per degree of
//     longitude times cos(lat0), 110,574 m per degree of latitude (the meridian's length per degree at the equator; at
//     6.5° N the true figure is 110,583 m, 0.008 % more, a few millimetres across the island). Not UTM: the island was not
//     made with it, and the reef must land on the island as the island was made.
//   - North to −z (the map's up), east to +x.
//   - Scaled by `scale` (0.172, about 1/5.81, D186's "1/6"), so the island keeps the old one's area.

import { ISLAND_SOURCE } from "../../src/rules/islandSource.ts";

export const METRES_PER_DEG_LAT = 110_574;
export const METRES_PER_DEG_LON_AT_EQUATOR = 111_320;

const mx = METRES_PER_DEG_LON_AT_EQUATOR * Math.cos((ISLAND_SOURCE.lat0 * Math.PI) / 180);
const mz = METRES_PER_DEG_LAT;

/** A point in scene metres: x east, z south. */
export type Scene = readonly [x: number, z: number];

export function toScene(lon: number, lat: number): Scene {
  return [(lon - ISLAND_SOURCE.lon0) * mx * ISLAND_SOURCE.scale, -(lat - ISLAND_SOURCE.lat0) * mz * ISLAND_SOURCE.scale];
}

/** The same point at true scale, metres from the centroid (x east, z south): `toScene` without the scale. */
export function toTrue(lon: number, lat: number): Scene {
  return [(lon - ISLAND_SOURCE.lon0) * mx, -(lat - ISLAND_SOURCE.lat0) * mz];
}

/** Where a frame is centred and how it is scaled: an island's area centroid and the scale the game draws it at. */
export interface FrameOrigin {
  readonly lon0: number;
  readonly lat0: number;
  readonly scale: number;
}

/** A frame's projections, each the home's arithmetic with another origin. */
export interface Frame {
  readonly origin: FrameOrigin;
  /** Longitude and latitude to scene metres: x east, z south, scaled. */
  toScene(lon: number, lat: number): Scene;
  /** Longitude and latitude to true metres from the origin: x east, z south. */
  toTrue(lon: number, lat: number): Scene;
  /** The inverse of `toTrue`. */
  fromTrue(x: number, z: number): readonly [lon: number, lat: number];
}

/**
 * **Each island's own transform** (RF, D375; PLAN v2.6 "The reefs of every island, traced"): the home island's projection
 * above with another island's area centroid as its origin, at the home scale, so every reef is measured and simplified in
 * the frame its island will be drawn in. The same expressions in the same order as `toScene` and `toTrue`, so the home's
 * own origin gives the same numbers to the last bit (tests/scripts/reef/transform.test.ts). Rejected: one frame for every
 * island (Maavaidhoo's, or UTM's): 110 km from the home at Kandoodhoo, an equirectangular frame centred on another island
 * is off by kilometres of curvature, and the game places each island round its own centroid.
 */
export function frameAt(origin: FrameOrigin): Frame {
  const fx = METRES_PER_DEG_LON_AT_EQUATOR * Math.cos((origin.lat0 * Math.PI) / 180);
  const fz = METRES_PER_DEG_LAT;
  return {
    origin,
    toScene: (lon, lat) => [(lon - origin.lon0) * fx * origin.scale, -(lat - origin.lat0) * fz * origin.scale],
    toTrue: (lon, lat) => [(lon - origin.lon0) * fx, -(lat - origin.lat0) * fz],
    fromTrue: (x, z) => [origin.lon0 + x / fx, origin.lat0 - z / fz],
  };
}
