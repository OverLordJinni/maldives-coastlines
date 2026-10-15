// A reader for one window of a tiled GeoTIFF, written by hand for the traced reef (R75, D269, D283).
//
// Why by hand, as the chart's PBF reader is (scripts/chart/pbf.ts says it at length): every dependency is a reviewed
// row in `scripts/check-deps.ts` (AC36), and the method has to be re-runnable from the record in ten years (R57).
// Rejected: GDAL (`gdal_translate -projwin`), which would make the traced reef depend on what is installed on one Mac,
// and `geotiff` from npm, a dependency with its own decoders for a dozen codecs this needs none of.
//
// What it reads is exactly what Element84's `sentinel-cogs` bucket serves for Sentinel-2 L2A, and nothing else:
//   - classic TIFF (not BigTIFF), little-endian ("II", 42);
//   - one sample per pixel, 8 or 16 bits, unsigned (SampleFormat 1, or absent);
//   - tiled (TileWidth/TileLength, TileOffsets/TileByteCounts), the first image only (the full resolution; the COG's
//     overviews are later IFDs and are never read);
//   - Deflate (Compression 8 or 32946), or none (1); with horizontal differencing (Predictor 2) or none (1).
// **Anything else is refused, not guessed at** (`TiffError`): an LZW or JPEG tile decoded as Deflate would be noise that a
// threshold would happily turn into a reef.
//
// Pure (bytes in, numbers out), so the decoder is a unit test over a TIFF the test writes itself
// (tests/scripts/reef/tiff.test.ts).
import { inflateSync } from "node:zlib";

export class TiffError extends Error {
  override name = "TiffError";
}

/** The tags this reader understands, by number (TIFF 6.0 and the GeoTIFF spec). */
const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  samplesPerPixel: 277,
  predictor: 317,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
  sampleFormat: 339,
  modelPixelScale: 33550,
  modelTiepoint: 33922,
} as const;

/** Bytes per value of each TIFF field type this reader needs. */
const TYPE_SIZE: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 12: 8, 16: 8 };

export interface TiffImage {
  readonly width: number;
  readonly height: number;
  readonly bits: 8 | 16;
  readonly tileWidth: number;
  readonly tileLength: number;
  /** Where pixel (0, 0)'s top-left corner is, in the image's projected CRS, and the pixel size (y grows downwards). */
  readonly originX: number;
  readonly originY: number;
  readonly pixelX: number;
  readonly pixelY: number;
  readonly predictor: 1 | 2;
  readonly compressed: boolean;
  readonly tileOffsets: readonly number[];
  readonly tileByteCounts: readonly number[];
}

/** A window of pixels, row by row from its top-left. */
export interface TiffWindow {
  readonly x0: number;
  readonly y0: number;
  readonly width: number;
  readonly height: number;
  readonly values: Uint16Array;
}

function values(view: DataView, type: number, count: number, at: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = at + i * (TYPE_SIZE[type] ?? 1);
    if (type === 1 || type === 2) out.push(view.getUint8(p));
    else if (type === 3) out.push(view.getUint16(p, true));
    else if (type === 4) out.push(view.getUint32(p, true));
    else if (type === 12) out.push(view.getFloat64(p, true));
    else throw new TiffError(`field type ${type} is not one this reader needs`);
  }
  return out;
}

/** Reads the first image's directory. */
export function readTiff(bytes: Uint8Array): TiffImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || bytes[0] !== 0x49 || bytes[1] !== 0x49) throw new TiffError("not a little-endian TIFF");
  const magic = view.getUint16(2, true);
  if (magic === 43) throw new TiffError("BigTIFF is not read here");
  if (magic !== 42) throw new TiffError(`TIFF magic ${magic}, not 42`);
  const ifd = view.getUint32(4, true);
  const n = view.getUint16(ifd, true);
  const tags = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = view.getUint16(e, true);
    const type = view.getUint16(e + 2, true);
    const count = view.getUint32(e + 4, true);
    if (TYPE_SIZE[type] === undefined) continue; // a field this reader has no use for (ASCII metadata is type 2, sized above)
    const size = (TYPE_SIZE[type] as number) * count;
    const at = size <= 4 ? e + 8 : view.getUint32(e + 8, true);
    if (at + size > bytes.length) throw new TiffError(`tag ${tag} runs past the file`);
    tags.set(tag, values(view, type, count, at));
  }
  const one = (tag: number, fallback?: number): number => {
    const v = tags.get(tag);
    if (v === undefined || v.length === 0) {
      if (fallback !== undefined) return fallback;
      throw new TiffError(`tag ${tag} is missing`);
    }
    return v[0] as number;
  };
  const bits = one(TAG.bitsPerSample);
  if (bits !== 8 && bits !== 16) throw new TiffError(`${bits} bits per sample is not read here`);
  if (one(TAG.samplesPerPixel, 1) !== 1) throw new TiffError("more than one sample per pixel is not read here");
  if (one(TAG.sampleFormat, 1) !== 1) throw new TiffError("only unsigned integer samples are read here");
  const compression = one(TAG.compression, 1);
  if (compression !== 1 && compression !== 8 && compression !== 32946) throw new TiffError(`compression ${compression} is not Deflate or none`);
  const predictor = one(TAG.predictor, 1);
  if (predictor !== 1 && predictor !== 2) throw new TiffError(`predictor ${predictor} is not read here`);
  const scale = tags.get(TAG.modelPixelScale);
  const tie = tags.get(TAG.modelTiepoint);
  if (!scale || scale.length < 2 || !tie || tie.length < 6) throw new TiffError("no georeference (ModelPixelScale and ModelTiepoint)");
  // The tie point maps raster (i, j) to model (x, y); a COG ties raster (0, 0) to the image's corner.
  const [ti, tj, , tx, ty] = tie as [number, number, number, number, number];
  const offsets = tags.get(TAG.tileOffsets);
  const counts = tags.get(TAG.tileByteCounts);
  if (!offsets || !counts || offsets.length !== counts.length) throw new TiffError("not a tiled TIFF (no TileOffsets/TileByteCounts)");
  const image: TiffImage = {
    width: one(TAG.width),
    height: one(TAG.height),
    bits,
    tileWidth: one(TAG.tileWidth),
    tileLength: one(TAG.tileLength),
    pixelX: scale[0] as number,
    pixelY: scale[1] as number,
    originX: tx - ti * (scale[0] as number),
    originY: ty + tj * (scale[1] as number),
    predictor,
    compressed: compression !== 1,
    tileOffsets: offsets,
    tileByteCounts: counts,
  };
  const across = Math.ceil(image.width / image.tileWidth);
  const down = Math.ceil(image.height / image.tileLength);
  if (offsets.length !== across * down) throw new TiffError(`${offsets.length} tiles where a ${image.width} × ${image.height} image in ${image.tileWidth}-pixel tiles has ${across * down}`);
  return image;
}

/** One tile's samples, decompressed and un-differenced, `tileWidth × tileLength`. */
function tile(bytes: Uint8Array, image: TiffImage, index: number): Uint16Array {
  const offset = image.tileOffsets[index] as number;
  const count = image.tileByteCounts[index] as number;
  const n = image.tileWidth * image.tileLength;
  // A COG may leave an all-nodata tile out (offset and count 0): that is a tile of zeros, which is the nodata value.
  if (count === 0) return new Uint16Array(n);
  if (offset + count > bytes.length) throw new TiffError(`tile ${index} runs past the file`);
  const raw = bytes.subarray(offset, offset + count);
  const data = image.compressed ? new Uint8Array(inflateSync(raw)) : raw;
  const want = n * (image.bits / 8);
  if (data.length !== want) throw new TiffError(`tile ${index} holds ${data.length} bytes where ${want} were expected`);
  const out = new Uint16Array(n);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let k = 0; k < n; k++) out[k] = image.bits === 16 ? view.getUint16(k * 2, true) : (data[k] as number);
  if (image.predictor === 2) {
    // Horizontal differencing: each sample is stored as the difference from the one to its left, modulo the sample size.
    const mask = image.bits === 16 ? 0xffff : 0xff;
    for (let y = 0; y < image.tileLength; y++) {
      const row = y * image.tileWidth;
      for (let x = 1; x < image.tileWidth; x++) out[row + x] = ((out[row + x] as number) + (out[row + x - 1] as number)) & mask;
    }
  }
  return out;
}

/** The pixels of the window `[x0, x0 + width) × [y0, y0 + height)`, clipped to nothing outside the image (refused). */
export function readWindow(bytes: Uint8Array, image: TiffImage, x0: number, y0: number, width: number, height: number): TiffWindow {
  if (!(Number.isInteger(x0) && Number.isInteger(y0) && width > 0 && height > 0)) throw new TiffError("a window is whole pixels and not empty");
  if (x0 < 0 || y0 < 0 || x0 + width > image.width || y0 + height > image.height) throw new TiffError(`window ${x0},${y0} ${width}×${height} is not inside the ${image.width}×${image.height} image`);
  const out = new Uint16Array(width * height);
  const across = Math.ceil(image.width / image.tileWidth);
  const cache = new Map<number, Uint16Array>();
  for (let y = 0; y < height; y++) {
    const py = y0 + y;
    const ty = Math.floor(py / image.tileLength);
    for (let x = 0; x < width; x++) {
      const px = x0 + x;
      const tx = Math.floor(px / image.tileWidth);
      const index = ty * across + tx;
      let t = cache.get(index);
      if (t === undefined) {
        t = tile(bytes, image, index);
        cache.set(index, t);
      }
      out[y * width + x] = t[(py - ty * image.tileLength) * image.tileWidth + (px - tx * image.tileWidth)] as number;
    }
  }
  return { x0, y0, width, height, values: out };
}
