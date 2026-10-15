// WGS 84 longitude and latitude to and from UTM (the Sentinel-2 tile's grid, EPSG:326xx), for the traced reef.
//
// Snyder's series (USGS Professional Paper 1395, "Map Projections: A Working Manual", 1987, pp. 61–64), as every GIS
// library writes them. Maavaidhoo lies about 2° west of zone 43's central meridian (75° E), where the series is good to
// well under a millimetre, far below a 10 m pixel. Rejected: a library (proj4js) for two formulas, for the reasons
// tiff.ts gives.
//
// Pure.

const A = 6_378_137;
const F = 1 / 298.257_223_563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const FALSE_EASTING = 500_000;

const e4 = E2 * E2;
const e6 = e4 * E2;
const M1 = 1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
const M2 = (3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024;
const M3 = (15 * e4) / 256 + (45 * e6) / 1024;
const M4 = (35 * e6) / 3072;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** The central meridian of a UTM zone, degrees. */
export function centralMeridian(zone: number): number {
  return zone * 6 - 183;
}

/** Easting and northing (metres) of a point in the northern hemisphere, in `zone`. */
export function toUtm(lon: number, lat: number, zone: number): { readonly x: number; readonly y: number } {
  const phi = rad(lat);
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const n = A / Math.sqrt(1 - E2 * s * s);
  const t = Math.tan(phi) ** 2;
  const cc = EP2 * c * c;
  const a = (rad(lon) - rad(centralMeridian(zone))) * c;
  const m = A * (M1 * phi - M2 * Math.sin(2 * phi) + M3 * Math.sin(4 * phi) - M4 * Math.sin(6 * phi));
  const x = K0 * n * (a + ((1 - t + cc) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * cc - 58 * EP2) * a ** 5) / 120) + FALSE_EASTING;
  const y = K0 * (m + n * Math.tan(phi) * (a ** 2 / 2 + ((5 - t + 9 * cc + 4 * cc * cc) * a ** 4) / 24 + ((61 - 58 * t + t * t + 600 * cc - 330 * EP2) * a ** 6) / 720));
  return { x, y };
}

/** The inverse of `toUtm`. */
export function fromUtm(x: number, y: number, zone: number): { readonly lon: number; readonly lat: number } {
  const m = y / K0;
  const mu = m / (A * M1);
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1);
  const c = Math.cos(phi1);
  const c1 = EP2 * c * c;
  const t1 = Math.tan(phi1) ** 2;
  const n1 = A / Math.sqrt(1 - E2 * s * s);
  const r1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5;
  const d = (x - FALSE_EASTING) / (n1 * K0);
  const phi = phi1 - ((n1 * Math.tan(phi1)) / r1) * (d ** 2 / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
  const lambda = rad(centralMeridian(zone)) + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) / c;
  return { lon: deg(lambda), lat: deg(phi) };
}
