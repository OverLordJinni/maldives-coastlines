// The home island's transform (Maavaidhoo, OpenStreetMap way 19879672): the coastline's area centroid and the scale
// the game draws it at. Written by the game's scripts/reef/public-bundle.ts from its own tuning (ISLAND_SOURCE), so the
// reef built here lands where the game's does. scripts/reef/transform.ts says how the three numbers are used.
export const ISLAND_SOURCE = { lon0: 73.05400674322956, lat0: 6.515550846985493, scale: 0.17202807062455622 } as const;
