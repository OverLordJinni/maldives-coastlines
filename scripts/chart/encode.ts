// The chart's binary writer: the inverse of `src/rules/chartData.ts` `decodeChart`, which documents
// the format. This is the only writer, and `tests/scripts/chart/encode.test.ts` holds that every
// chart it writes decodes to the same chart.
//
// It takes points already quantised to integers in 1e-5 degrees (the pipeline quantises once, PLAN
// Data model), so nothing here rounds. A non-integer is refused, because a writer that rounded
// silently would make "quantised once" a claim rather than a fact.
import { CHART_FORMAT, CHART_MAGIC, islandIdNumber, type AtollId, type IslandId } from "../../src/rules/chartData.ts";

/** A point as integers in 1e-5 degrees: [lon, lat]. */
export type QPoint = readonly [lon: number, lat: number];

export interface ChartToWrite {
  readonly id: string;
  readonly atolls: readonly { readonly id: AtollId; readonly name: string }[];
  readonly cloud: readonly (readonly QPoint[])[];
  readonly islands: readonly { readonly id: IslandId; readonly atoll: AtollId; readonly ring: readonly QPoint[] }[];
  readonly aliases: readonly (readonly [IslandId, IslandId])[];
}

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

  string(s: string): void {
    const b = new TextEncoder().encode(s);
    this.varint(b.length);
    for (const x of b) this.chunks.push(x);
  }

  ring(points: readonly QPoint[]): void {
    if (points.length < 3) throw new RangeError(`a ring of ${points.length} points`);
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

export function encodeChart(chart: ChartToWrite): Uint8Array {
  const w = new Writer();
  for (const ch of CHART_MAGIC) w.u8(ch.charCodeAt(0));
  w.u8(CHART_FORMAT);
  w.string(chart.id);
  const atollIndex = new Map(chart.atolls.map((a, i) => [a.id, i]));
  w.varint(chart.atolls.length);
  for (const a of chart.atolls) {
    w.string(a.id);
    w.string(a.name);
  }
  w.varint(chart.cloud.length);
  for (const r of chart.cloud) w.ring(r);
  w.varint(chart.islands.length);
  for (const i of chart.islands) {
    const a = atollIndex.get(i.atoll);
    if (a === undefined) throw new RangeError(`island ${i.id} is in atoll ${i.atoll}, which is not listed`);
    w.varint(islandIdNumber(i.id));
    w.varint(a);
    w.ring(i.ring);
  }
  w.varint(chart.aliases.length);
  for (const [from, to] of chart.aliases) {
    w.varint(islandIdNumber(from));
    w.varint(islandIdNumber(to));
  }
  return w.bytes();
}
