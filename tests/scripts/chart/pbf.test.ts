// The hand-written PBF reader (scripts/chart/pbf.ts) against fixture PBFs built here by an
// independent writer (pbfWriter.ts): PLAN CH0's "3-way, 1-relation fixture PBF built in the test".
//
// What this cannot see: writers' quirks the format allows and these fixtures do not exercise
// (DenseInfo, ChangeSets, an indexdata field, a lat_offset). The real extract's reading is checked
// in buildChart.test.ts, which rebuilds the committed chart byte for byte when the extract is present.
//
// Negative controls seen red once (L49), recorded in the CH0 commit: the `skip()` length-prefix bug
// that the first real run hit (`this.pos += this.varint()`) restored; zigzag decoded as plain varint;
// dense coordinates not delta-summed.
import { describe, expect, it } from "vitest";
import { PbfError, readPbf, type PbfNode, type PbfRelation, type PbfWay } from "../../../scripts/chart/pbf.ts";
import { concat, fileBlock, headerBlock, primitiveBlock, type BlockIn } from "./pbfWriter.ts";

const BIG = 13_000_000_123; // node ids pass 2^32 in today's OSM

const FIXTURE: BlockIn = {
  dense: [
    { id: BIG, lat: 6.515, lon: 73.054 },
    { id: BIG + 1, lat: 6.516, lon: 73.055, tags: { natural: "tree" } },
    { id: BIG + 7, lat: -0.69, lon: 73.15 },
    { id: BIG + 3, lat: 6.517, lon: 73.053, tags: { place: "islet", name: "މާވައިދޫ" } },
  ],
  nodes: [{ id: 42, lat: 4.175, lon: 73.509, tags: { place: "island" } }],
  ways: [
    { id: 19879672, refs: [BIG, BIG + 1, BIG + 3, BIG], tags: { natural: "coastline", place: "islet", name: "Maavaidhoo" } },
    { id: 19879671, refs: [BIG + 7, BIG + 1], tags: {} },
    { id: 900, refs: [BIG + 3, 42, BIG + 7, BIG + 3], tags: { natural: "wood" } },
  ],
  relations: [
    {
      id: 6599297,
      tags: { boundary: "administrative", admin_level: "4", "name:en": "South Thiladhunmathi" },
      members: [
        { type: "way", ref: 19879672, role: "outer" },
        { type: "way", ref: 900, role: "inner" },
        { type: "node", ref: BIG + 3, role: "admin_centre" },
        { type: "relation", ref: 5, role: "" },
      ],
    },
  ],
};

function read(file: Uint8Array): { nodes: PbfNode[]; ways: PbfWay[]; relations: PbfRelation[]; blocks: number } {
  const nodes: PbfNode[] = [];
  const ways: PbfWay[] = [];
  const relations: PbfRelation[] = [];
  const { blocks } = readPbf(file, { node: (n) => nodes.push(n), way: (w) => ways.push(w), relation: (r) => relations.push(r) });
  return { nodes, ways, relations, blocks };
}

const fixtureFile = (compression: "raw" | "zlib" = "zlib", granularity?: number): Uint8Array =>
  concat(fileBlock("OSMHeader", headerBlock(), compression), fileBlock("OSMData", primitiveBlock({ ...FIXTURE, ...(granularity ? { granularity } : {}) }), compression));

describe("the PBF reader on a fixture with 3 ways and 1 relation", () => {
  for (const compression of ["zlib", "raw"] as const) {
    it(`reads every entity, ${compression} blobs`, () => {
      const r = read(fixtureFile(compression));
      expect(r.blocks).toBe(1);
      expect(r.nodes.map((n) => n.id)).toEqual([BIG, BIG + 1, BIG + 7, BIG + 3, 42]);
      expect(r.ways.map((w) => w.id)).toEqual([19879672, 19879671, 900]);
      expect(r.relations.map((x) => x.id)).toEqual([6599297]);
    });
  }

  it("decodes dense coordinates exactly, including south of the equator, as integer nanodegrees", () => {
    const { nodes } = read(fixtureFile());
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get(BIG)).toMatchObject({ latE9: 6_515_000_000, lonE9: 73_054_000_000 });
    expect(byId.get(BIG + 7)).toMatchObject({ latE9: -690_000_000, lonE9: 73_150_000_000 });
    expect(byId.get(42)).toMatchObject({ latE9: 4_175_000_000, lonE9: 73_509_000_000 });
  });

  it("applies a block's granularity", () => {
    const { nodes } = read(fixtureFile("zlib", 1000));
    expect(nodes.find((n) => n.id === BIG)).toMatchObject({ latE9: 6_515_000_000, lonE9: 73_054_000_000 });
  });

  it("gives each dense node its own tags, and an untagged one none, including Thaana", () => {
    const { nodes } = read(fixtureFile());
    expect(nodes.find((n) => n.id === BIG)?.tags).toEqual({});
    expect(nodes.find((n) => n.id === BIG + 1)?.tags).toEqual({ natural: "tree" });
    expect(nodes.find((n) => n.id === BIG + 3)?.tags).toEqual({ place: "islet", name: "މާވައިދޫ" });
    expect(nodes.find((n) => n.id === 42)?.tags).toEqual({ place: "island" });
  });

  it("decodes way refs by delta, and way tags", () => {
    const { ways } = read(fixtureFile());
    expect(ways[0]).toEqual({ id: 19879672, refs: [BIG, BIG + 1, BIG + 3, BIG], tags: { natural: "coastline", place: "islet", name: "Maavaidhoo" } });
    expect(ways[2]?.refs).toEqual([BIG + 3, 42, BIG + 7, BIG + 3]);
  });

  it("decodes relation members with their types and roles", () => {
    const { relations } = read(fixtureFile());
    expect(relations[0]).toEqual({
      id: 6599297,
      tags: { boundary: "administrative", admin_level: "4", "name:en": "South Thiladhunmathi" },
      members: [
        { type: "way", ref: 19879672, role: "outer" },
        { type: "way", ref: 900, role: "inner" },
        { type: "node", ref: BIG + 3, role: "admin_centre" },
        { type: "relation", ref: 5, role: "" },
      ],
    });
  });
});

describe("the PBF reader refuses what it does not understand, rather than skipping it", () => {
  const data = fileBlock("OSMData", primitiveBlock(FIXTURE));

  it("a required feature it does not implement", () => {
    expect(() => readPbf(concat(fileBlock("OSMHeader", headerBlock(["OsmSchema-V0.6", "HistoricalInformation"])), data), {})).toThrow(/HistoricalInformation/);
  });

  it("an lzma blob", () => {
    expect(() => readPbf(concat(fileBlock("OSMHeader", headerBlock()), fileBlock("OSMData", primitiveBlock(FIXTURE), "lzma")), {})).toThrow(/lzma/);
  });

  it("a truncated file, at every cut inside the data block", () => {
    const whole = concat(fileBlock("OSMHeader", headerBlock()), data);
    const headerLen = whole.length - data.length;
    for (let cut = headerLen + 1; cut < whole.length; cut += 7) expect(() => readPbf(whole.subarray(0, cut), {}), `cut at ${cut}`).toThrow(PbfError);
  });

  it("data before the header, and a file with no header", () => {
    expect(() => readPbf(concat(data, fileBlock("OSMHeader", headerBlock())), {})).toThrow(/before the OSMHeader/);
    expect(() => readPbf(new Uint8Array(0), {})).toThrow(/no OSMHeader/);
  });
});
