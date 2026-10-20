// The reefs' binary writer: the inverse of `src/rules/reefData.ts` `decodeReefs`, which documents the format. This is the
// only writer, and tests/rules/reefData.test.ts holds that what it writes decodes to what it was given.
//
// Points arrive already quantised to integers in 1e-5 degrees (build-reefs.ts quantises once, as the chart's pipeline
// does), so nothing here rounds: a non-integer is refused, because a writer that rounded silently would make "quantised
// once" a claim rather than a fact. Islands are written in ascending order of their id's number, which the decoder
// requires, so the same reefs always give the same bytes whatever order they were built in.
//
// The varint writer is the chart's (scripts/chart/encode.ts) written again: that one is private to the chart's file, which
// is another slice's path. Rejected: importing scripts/chart/encode.ts and reaching into its class (not exported).
import { islandIdNumber, type IslandId } from "../../src/rules/chartData.ts";
import { REEFS_FORMAT, REEFS_MAGIC, type ReefKind } from "../../src/rules/reefData.ts";

/** A point as integers in 1e-5 degrees: [lon, lat]. */
export type QPoint = readonly [lon: number, lat: number];

export interface IslandReefToWrite {
  readonly id: IslandId;
  readonly kind: ReefKind;
  readonly edge: readonly QPoint[];
  readonly crest: readonly QPoint[];
  readonly marsh: readonly (readonly QPoint[])[];
}

export interface ReefsToWrite {
  readonly id: string;
  readonly islands: readonly IslandReefToWrite[];
}

const KIND_BYTE: Readonly<Record<ReefKind, number>> = { traced: 0, drawn: 1 };

class Writer {
  private chunks: number[] = [];

  u8(n: number): void {
    this.chunks.push(n & 0xff);
  }

  varint(n: number): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`varint ${n}: not a non-negative safe integer`);
    while (n >= 0x80) {
      this.chunks.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    this.chunks.push(n);
  }

  zigzag(n: number): void {
    if (!Number.isSafeInteger(n)) throw new RangeError(`zigzag ${n}: not an integer (points are quantised before writing)`);
    this.varint(n >= 0 ? n * 2 : -n * 2 - 1);
  }

  ascii(s: string): void {
    if (!/^[\x20-\x7e]*$/.test(s)) throw new RangeError(`"${s}" is not printable ASCII (reefData.ts reads nothing else)`);
    this.varint(s.length);
    for (let i = 0; i < s.length; i++) this.chunks.push(s.charCodeAt(i));
  }

  ring(points: readonly QPoint[], what: string): void {
    if (points.length < 3) throw new RangeError(`${what}: a ring of ${points.length} points`);
    this.varint(points.length);
    let lon = 0;
    let lat = 0;
    for (const [x, y] of points) {
      this.zigzag(x - lon);
      this.zigzag(y - lat);
      lon = x;
      lat = y;
    }
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

export function encodeReefs(reefs: ReefsToWrite): Uint8Array {
  if (reefs.id === "") throw new RangeError("an empty reefs id");
  const sorted = [...reefs.islands].sort((a, b) => islandIdNumber(a.id) - islandIdNumber(b.id));
  for (let i = 1; i < sorted.length; i++) if ((sorted[i] as IslandReefToWrite).id === (sorted[i - 1] as IslandReefToWrite).id) throw new RangeError(`island ${(sorted[i] as IslandReefToWrite).id} twice`);
  const w = new Writer();
  for (const ch of REEFS_MAGIC) w.u8(ch.charCodeAt(0));
  w.u8(REEFS_FORMAT);
  w.ascii(reefs.id);
  w.varint(sorted.length);
  for (const i of sorted) {
    w.varint(islandIdNumber(i.id));
    w.u8(KIND_BYTE[i.kind]);
    w.ring(i.edge, `island ${i.id} edge`);
    w.ring(i.crest, `island ${i.id} crest`);
    w.varint(i.marsh.length);
    i.marsh.forEach((m, j) => w.ring(m, `island ${i.id} marsh ${j}`));
  }
  return w.bytes();
}
