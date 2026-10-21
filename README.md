# Maldives island outlines, simplified (derived from OpenStreetMap)

**© OpenStreetMap contributors.** This data is derived from OpenStreetMap and is made available under
the **Open Database Licence (ODbL) 1.0**: https://opendatacommons.org/licenses/odbl/1-0/. Any rights in
individual contents of the database are licensed under the Database Contents Licence:
https://opendatacommons.org/licenses/dbcl/1-0/. You are free to copy, distribute, transmit and adapt it,
as long as you credit OpenStreetMap and its contributors, and if you alter or build upon it you may
distribute the result only under the same licence. See https://www.openstreetmap.org/copyright.

**Contains modified Copernicus Sentinel data 2026.** The reef round Maavaidhoo (`src/assets/reef/`) is OpenStreetMap
data whose shape was traced from a Copernicus Sentinel-2 scene. Copernicus Sentinel data are free and open (Commission
Delegated Regulation (EU) No 1159/2013 and the Sentinel Data Legal Notice,
https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice); anything made from these files
carries the line above as well as the OpenStreetMap credit. No Sentinel-2 image or pixel is in this repository: only the
outlines traced from one.

It is published here because a game in development ships it inside the app, and the ODbL's share-alike
asks that a derived database used publicly be offered under the ODbL. This repository holds that
derived database and the scripts that build it, and nothing else.

## What is here

| File | What it is |
|---|---|
| `src/assets/chart/maldives.bin` | 909 islands of the Maldives: each one's coastline, the administrative atoll it is in (today's name, e.g. "Haa Dhaalu"), and the outlines of the natural atolls. Binary, 70,147 bytes, sha256 `897f24e1c1d99af3a25e9acac3b5b4ff167424c151c2e55d47b4a9a702648b53` |
| `src/assets/chart/chart-manifest.json` | The record: the source extract and its hashes, the method, the counts, every OSM coastline ring that was left out and why, and island names as OSM has them |
| `scripts/chart/excluded.json` | The hand-kept list of reclaimed or artificial islands left out, each with its reason and evidence |
| `scripts/chart/atolls.json` | Today's administrative atoll names, keyed by the OSM relation each was written against |
| `src/assets/reef/reef.json` | The coral reef round Maavaidhoo (Haa Dhaalu atoll): its edge, where it drops to open water, and its crest, two closed rings in metres of a local frame (see "The reef round Maavaidhoo" below) |
| `src/assets/reef/reefs.bin` | The reefs of the other islands the game lands on (see "The reefs of the islands the game lands on" below): each one's edge and crest, traced or, where it would not trace, drawn, and Kulhudhuffushi's kulhi, rings in degrees in the binary format `src/rules/reefData.ts` documents |
| `src/assets/reef/reefs-manifest.json` | Their record: per island the Sentinel-2 scene and its hashes, why that scene, the frame and window, the thresholds, OpenStreetMap's reef and how far each is from it, or why it would not trace; the kulhi's Landsat scene and method |
| `src/assets/reef/reef-manifest.json` | The reef's record: the OpenStreetMap relation and the Sentinel-2 scene it came from, their hashes, the method and its thresholds, the frame, and how far the traced reef is from OpenStreetMap's, bearing by bearing |

**Island names are not in `maldives.bin`.** The manifest carries them as OSM has them.

## The source

Geofabrik's extract of OpenStreetMap for the Maldives, `https://download.geofabrik.de/asia/maldives-latest.osm.pbf`,
fetched 2026-10-14T12:48:06Z: 3,653,360 bytes, MD5 `edb25771ae143da5a637f0edf5610fc1`, sha256
`858582dd024b7bf5fc46f6f2118a684f78508992075c5f890ed64a2863ec6ba6`. Geofabrik does not keep old extracts
for long; the hashes let you confirm a copy, and OpenStreetMap's full history can reproduce the state of
that day.

## The method (filter version 1, tolerance 5 m: chart id `osm-2026-10-14.f1.t5`)

1. Every `natural=coastline` way is joined end to end into closed rings (1,351 rings).
2. Each ring's id is the OSM element tagged `place=island` or `place=islet` for it, else the lowest
   coastline way id in it (`w<id>` for a way, `r<id>` for a relation).
3. A ring is **left out** for the first of these that applies, and kept otherwise:
   1. it is drawn clockwise (land outside it);
   2. it is on the hand list of reclaimed or artificial islands (`excluded.json`);
   3. it is tagged `natural=sand`, `shoal` or `reef`, `landcover=sand`, or any `man_made=*`;
   4. it is under 1,000 m²;
   5. it has no name, no mapped vegetation (`natural=wood|scrub|grassland|heath`,
      `landuse=forest|farmland|meadow|orchard`, or `natural=tree` nodes) and no buildings.
   The aim is natural islands with plants. OpenStreetMap does not record "natural" or "vegetated"
   directly, so this is an approximation, and the manifest lists its doubtful cases.
4. Each island is assigned to the `admin_level=4` boundary that holds it, named with today's
   administrative name. The capital's own unit (Malé) is listed under Kaafu, the atoll it lies in.
5. The natural atolls' outlines are `place=archipelago` elements tagged `natural=atoll` or `natural=reef`.
6. Rings are simplified by Douglas–Peucker (5 m for islands, 200 m for atolls) in a local equirectangular
   projection, then rounded once to 10⁻⁵ degrees.

## The binary format (version 1)

```
"KFCH"       4 bytes
format       u8 = 1
chartId      string
atolls       varint n, then n × { id: string, name: string }
cloud        varint n, then n × ring              (natural atoll outlines)
islands      varint n, then n × { id: varint, atoll: varint index, ring }
aliases      varint n, then n × { from: varint id, to: varint id }

string       varint byte length, then UTF-8
island id    varint: osm id × 2, + 1 for a relation
ring         varint point count (≥ 3), then per point the zig-zag varint delta of
             longitude and latitude in 10⁻⁵ degrees from the previous point (the first
             from 0, 0); rings are open, the closing edge implied
```

Varints are unsigned LEB128, as in Protocol Buffers; zig-zag maps n to 2n for n ≥ 0 and to −2n − 1
otherwise.

## The reef round Maavaidhoo (method version 1: id `osm-858582dd.r7124282+S2C_43NBH_20260420_0_L2A.m1`)

**The sources.** OpenStreetMap relation 7124282 (`natural=reef`, `reef=coral`), from the same extract as the chart: its
outer way 484029944 is the reef as mapped, its inner way 19879672 the island's coastline. OpenStreetMap gives the reef's
area; its outer way has 13 points and cuts across the reef by up to about 40 m, so the **shape** is traced from
Sentinel-2 scene `S2C_43NBH_20260420_0_L2A` (Sentinel-2C L2A, sensed 2026-04-20, 0.34 % cloud over the tile; bands B03 and
B08, from Element84 Earth Search, https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2C_43NBH_20260420_0_L2A).

**The method** (`scripts/reef/trace.ts` says why each step):
1. A 160 × 160 pixel (1.6 km) window round the island, reflectance DN / 10,000. Land is where B08 > B03.
2. The **edge** is the contour of B03 at the open sea's median plus 6 robust sigma, measured on the window's 8-pixel
   frame; the **crest** is the contour at Otsu's threshold on ln(B03) over the water inside the edge. Both on B03 blurred
   by a 1-pixel Gaussian, land held above every threshold, keeping the loop round the island.
3. The loops are projected, simplified by Douglas–Peucker at 5 m, and rounded to 1 cm in the frame below.
4. The build refuses if OpenStreetMap's relation changes its members, or if the traced reef's area is more than 10 % from
   OpenStreetMap's. It is +2.4 % (524,188 m² against 511,784 m², less the island); on every 5° bearing from the island's
   centre the traced edge is within 50 m of the mapped one, and the manifest lists the 27 of 72 bearings beyond 20 m.

**The frame.** The rings are in metres of a local equirectangular frame round the coastline's area centroid
(`src/rules/islandSource.ts`: lon0 73.05400674322956, lat0 6.515550846985493), x east and z **south**, multiplied by
`scale` 0.17202807062455622, the size the game draws the island at:

```
x =  (lon − lon0) × 111,320 × cos(lat0) × scale
z = −(lat − lat0) × 110,574 × scale
```

Divide by `scale` for true metres, or invert for longitude and latitude.

**Not in it:** depth. No open source gives this reef's depth; the game draws its own, and that is game tuning, not data.

**Rebuilding it** needs the extract above and the scene's B03, B08 and `item.json` (about 110 MB; the STAC item above
lists their URLs), each directory with a `SHA256SUMS`:

```
npm run reef -- <directory holding maldives-latest.osm.pbf> <directory holding B03.tif, B08.tif, item.json>
```

With the same inputs it reproduces both files byte for byte, which `tests/scripts/reef/buildReef.test.ts` checks wherever
the inputs are found (set `REEF_OSM` and `REEF_S2`); elsewhere that test is skipped, which is not a pass.

## The reefs of the islands the game lands on (id `osm-858582dd.s2-ecc71584.m1+osm-858582dd.s2-bdaeae48.m1`)

The game traces the reef of every island its player can land on, by the method above generalised from one island to many.
The first three were **Kumundhoo and Kulhudhuffushi (Haa Dhaalu) and Kandoodhoo (Noonu)**; the other 130 followed, atoll by
atoll (Haa Dhaalu, Shaviyani, Noonu, Raa). All of them: **133 islands, 130 traced and 3 drawn**, in
`src/assets/reef/reefs.bin` (57,104 bytes, sha256 `36d5cbc9420950d1578a4580e2b8f265568613d89e90f0c8899029dc9d87f090`) with their record,
`src/assets/reef/reefs-manifest.json`: per island its scene, its frame and window, its thresholds, OpenStreetMap's reef and
how far the trace is from it. Many traced reefs are more than 10 % larger than OpenStreetMap's polygon (round Kandoodhoo,
for one, OpenStreetMap follows the reef flat's rim rather than its drop-off). The game's owner judged the first three right
on the imagery and chose them; for the rest each record says the gap waits for his judgement. An island whose reef would
not trace has a **drawn band** instead (`kind` drawn), and its record says why.

- `scripts/reef/build-reefs.ts` (`npm run reefs -- <a directory holding the inputs below>`): per island, its outline from
  `src/assets/chart/maldives.bin`, a local frame round its area centroid, a square window 340 m beyond its farthest point,
  the clearest Sentinel-2 L2A scene for that window by the scene classification (cloud over the water counted, bright
  sand and roofs set aside; a scene that cannot show the window, or that still carries the L2A offset, passed over), the
  trace above, Douglas–Peucker at 5 m, and OpenStreetMap's smallest `natural=reef` polygon round the island to hold it to
  (its area within 10 %, every bearing over 20 m apart listed). Where the reef runs past the window, or the window's frame
  lies on a reef flat rather than open sea, the window grows by a quarter at a time, to 20 km at most. A reef more than
  10 % from OpenStreetMap's is shipped only as a disagreement the owner judged, or recorded as awaiting his judgement while
  he has given none for its batch; it is refused otherwise.
- `scripts/reef/drawn-band.ts`: for an island whose reef would not trace (it runs on round an atoll's rim, or no scene
  shows it), a band round its own coast, the crest 81 m and the edge 174 m off it.
- `scripts/reef/kulhi.ts`: Kulhudhuffushi's kulhi (its wetland) as it was before the island's airport, traced from a
  **Landsat 5 TM scene of 1997-04-15** (USGS Collection 2 Level-2, 30 m): the largest water the island's own land enclosed.
  No Sentinel-2 image of the island predates June 2021, after the airport.
- `src/rules/reefData.ts` documents the reefs' binary format (the chart's encoding: rings in 1e-5 degrees as zig-zag
  delta varints) and decodes it; `scripts/reef/encode-reefs.ts` writes it.
- `scripts/reef/review-sheet.ts` draws the figure the traces are judged on: each island's scene with its traced edge, its
  crest and OpenStreetMap's reef. It holds imagery, so it is never written into this repository.

**The inputs**, each directory with a `SHA256SUMS` the build checks first: the OpenStreetMap extract above; the scene
classification bands and STAC items of the candidate scenes (Element84 Earth Search, `sentinel-2-l2a`); the chosen scenes'
B03, B08 and SCL; the Landsat quality bands of the kulhi's candidates and the chosen scene's bands 2 and 5 (Microsoft
Planetary Computer's `landsat-c2-l2`). `scripts/reef/reef-islands.ts` names the directories.

**Credits.** The reefs' shapes contain modified Copernicus Sentinel data 2025 and 2026; the kulhi is from a Landsat-5 image
courtesy of the U.S. Geological Survey (Landsat data are in the public domain); the polygons they are held to are
© OpenStreetMap contributors, ODbL 1.0. No pixel of any image is in this repository.

## Corrections

If an outline is wrong, the fix belongs in OpenStreetMap itself (https://www.openstreetmap.org), where it
helps everyone; the next extract will carry it here.

## Rebuilding it

Node 24 or later. The scripts read Geofabrik's extract and write `src/assets/chart/`:

```
npm install
npm run chart -- <directory holding maldives-latest.osm.pbf and its SHA256SUMS>
npm run check:chart
npm test
```

The build refuses to run if the extract's sha256 disagrees with `SHA256SUMS` in that directory. With the
same extract it reproduces `maldives.bin` byte for byte.

## Licences

- **The data** (`src/assets/chart/`, `src/assets/reef/`, `scripts/chart/excluded.json`, `scripts/chart/atolls.json`):
  ODbL 1.0, © OpenStreetMap contributors, as above. The reef's shape also contains modified Copernicus Sentinel data
  2026 (free and open, as above).
- **The scripts and tests** (`scripts/`, `src/rules/`, `tests/`): MIT, see `LICENSE`.

