# Maldives island outlines, simplified (derived from OpenStreetMap)

**© OpenStreetMap contributors.** This data is derived from OpenStreetMap and is made available under
the **Open Database Licence (ODbL) 1.0**: https://opendatacommons.org/licenses/odbl/1-0/. Any rights in
individual contents of the database are licensed under the Database Contents Licence:
https://opendatacommons.org/licenses/dbcl/1-0/. You are free to copy, distribute, transmit and adapt it,
as long as you credit OpenStreetMap and its contributors, and if you alter or build upon it you may
distribute the result only under the same licence. See https://www.openstreetmap.org/copyright.

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

- **The data** (`src/assets/chart/`, `scripts/chart/excluded.json`, `scripts/chart/atolls.json`): ODbL 1.0,
  © OpenStreetMap contributors, as above.
- **The scripts and tests** (`scripts/`, `src/rules/`, `tests/`): MIT, see `LICENSE`.

