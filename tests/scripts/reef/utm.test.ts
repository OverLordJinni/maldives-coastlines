// WGS 84 to UTM and back (scripts/reef/utm.ts), held to properties that do not come from Snyder's series it implements:
// UTM's own definition (the central meridian at 500,000 E, the equator at 0 N), the scale factor k0 = 0.9996 along the
// central meridian (a degree of latitude there is k0 times the meridian's length per degree, from the standard
// series 111,132.954 − 559.822 cos 2φ + 1.175 cos 4φ), and a degree of longitude across it at k0 × N cos φ. No GIS
// library is on this machine to compare against (pyproj is not installed), so these are the instruments.
// Seen red (L49): with the A⁵ term of the easting dropped, the round trip at 77.9° E was 1.1 cm off; with k0 set to 1,
// the meridian and parallel checks each failed by 44 m a degree.
import { describe, expect, it } from "vitest";
import { centralMeridian, fromUtm, toUtm } from "../../../scripts/reef/utm.ts";

const rad = (d: number): number => (d * Math.PI) / 180;

describe("utm", () => {
  it("puts the central meridian at 500,000 E and the equator at 0 N", () => {
    const p = toUtm(centralMeridian(43), 0, 43);
    expect(p.x).toBeCloseTo(500_000, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it("round-trips points across the zone to under a millimetre", () => {
    for (const [lon, lat] of [[73.054, 6.5155], [72.1, 1.2], [77.9, 9.9], [75, 4]] as const) {
      const p = toUtm(lon, lat, 43);
      const q = fromUtm(p.x, p.y, 43);
      expect(Math.abs(q.lon - lon) * 111_320).toBeLessThan(0.001);
      expect(Math.abs(q.lat - lat) * 110_574).toBeLessThan(0.001);
    }
  });

  it("scales the central meridian by k0: a degree of latitude at 6.5° N is 0.9996 of the meridian's degree", () => {
    const lat = 6.5155;
    const a = toUtm(75, lat - 0.005, 43).y;
    const b = toUtm(75, lat + 0.005, 43).y;
    const perDeg = 111_132.954 - 559.822 * Math.cos(rad(2 * lat)) + 1.175 * Math.cos(rad(4 * lat));
    expect((b - a) / 0.01).toBeCloseTo(0.9996 * perDeg, 0);
  });

  it("measures a small step of longitude at Maavaidhoo as the ellipsoid's parallel does, with UTM's scale there", () => {
    const lat = 6.5155;
    const e2 = (1 / 298.257_223_563) * (2 - 1 / 298.257_223_563);
    const n = 6_378_137 / Math.sqrt(1 - e2 * Math.sin(rad(lat)) ** 2);
    const lon = 73.054;
    const dx = toUtm(lon + 0.0005, lat, 43).x - toUtm(lon - 0.0005, lat, 43).x;
    // UTM's scale 2° from the meridian: k ≈ k0 (1 + (Δλ cos φ)² / 2 · (1 + ep² cos² φ)); to 1e-6 here.
    const dl = rad(lon - 75) * Math.cos(rad(lat));
    const k = 0.9996 * (1 + (dl * dl) / 2);
    expect(dx / 0.001).toBeCloseTo(k * n * Math.cos(rad(lat)) * rad(1), 0);
  });
});
