import { describe, it, expect } from "vitest";
import { proposeGpsClock, proposeGpsRoute } from "./videoGpsSync";
import { parseGpmf } from "./videoTelemetry";
import type { Session } from "./model";
import { join, u32, text } from "./videoTelemetry.fixture";
function klv(
  key: string,
  type: string,
  size: number,
  count: number,
  data: Uint8Array,
) {
  return join(
    text(key),
    new Uint8Array([type.charCodeAt(0), size, count >> 8, count & 255]),
    data,
    new Uint8Array((4 - (data.length % 4)) % 4),
  );
}
const start = Date.UTC(2026, 0, 1, 12);
const session = {
  start,
  end: start + 20000,
  times: Float64Array.from({ length: 201 }, (_, i) => start + i * 100),
  lat: Float64Array.from({ length: 201 }, (_, i) => 50 + i * 0.00001),
  lon: Float64Array.from({ length: 201 }, () => 6),
} as Session;
const points = Array.from({ length: 12 }, (_, i) => ({
  t: i,
  utc: start + (i + 2) * 1000,
  lat: 50 + (i + 2) * 0.0001,
  lon: 6,
  fix: 3,
  speed: 10,
}));
describe("camera GPS sync", () => {
  it("proposes a known offset while accounting for clip start", () => {
    const p = proposeGpsClock(points, session, 12);
    expect(p.anchor).toEqual({
      videoSeconds: 12,
      sessionTimestamp: start + 2000,
    });
    expect(p.distanceMetres).toBeCloseTo(0);
  });
  it("matches a moving route without trusting the camera clock", () => {
    const p = proposeGpsRoute(
      points.map((p) => ({ ...p, utc: undefined })),
      session,
      0,
    );
    expect(p.anchor.sessionTimestamp).toBe(start + 2000);
  });
  it("rejects no fix, GPS outages, different recordings and inconsistent UTC", () => {
    expect(() =>
      proposeGpsClock(
        points.map((p) => ({ ...p, fix: 0 })),
        session,
        0,
      ),
    ).toThrow("three");
    expect(() =>
      proposeGpsClock(
        points.map((p) => ({ ...p, utc: p.utc + 86400000 })),
        session,
        0,
      ),
    ).toThrow("overlap");
    expect(() =>
      proposeGpsClock(
        points.map((p) => ({ ...p, lat: 40 })),
        session,
        0,
      ),
    ).toThrow("routes");
    expect(() =>
      proposeGpsClock(
        points.map((p, i) => ({ ...p, utc: p.utc + (i % 2 ? 3000 : 0) })),
        session,
        0,
      ),
    ).toThrow("inconsistent");
  });
  it("rejects an ambiguous route repeated on several laps", () => {
    const repeated = {
      ...session,
      end: start + 45000,
      times: Float64Array.from([
        ...session.times,
        ...Array.from(session.times, (t) => t + 25000),
      ]),
      lat: Float64Array.from([...session.lat, ...session.lat]),
      lon: Float64Array.from([...session.lon, ...session.lon]),
    };
    expect(() => proposeGpsRoute(points, repeated, 0)).toThrow("Several laps");
  });
  it("decodes GPS5 scales, UTC and fix status independently of motion", () => {
    const value = new Uint8Array(40),
      d = new DataView(value.buffer);
    [
      500000000, 60000000, 100000, 10000, 1000, 500001000, 60000000, 100000,
      10000, 1000,
    ].forEach((v, i) => d.setInt32(i * 4, v));
    const body = join(
      klv("SCAL", "l", 4, 5, u32(1e7, 1e7, 1000, 1000, 100)),
      klv("GPSF", "L", 4, 1, u32(3)),
      klv("GPSU", "U", 16, 1, text("260101120002.000")),
      klv("GPS5", "l", 20, 2, value),
    );
    const p = parseGpmf(klv("STRM", "\0", 1, body.length, body), 0, 1);
    expect(p.gps).toHaveLength(2);
    expect(p.gps![0]).toMatchObject({
      t: 0,
      lat: 50,
      lon: 6,
      utc: start + 2000,
      fix: 3,
    });
    expect(p.gps![1].utc).toBe(start + 2500);
  });
  it("decodes mixed-type GPS9 records used by newer GoPros", () => {
    const b = new Uint8Array(32),
      d = new DataView(b.buffer),
      days = ((start - Date.UTC(2000, 0, 1)) / 86400000) | 0;
    [500000000, 60000000, 100000, 10000, 1000, days, 43202000].forEach((v, i) =>
      d.setInt32(i * 4, v),
    );
    d.setUint16(28, 100);
    d.setUint16(30, 3);
    const body = join(
      klv("TYPE", "c", 9, 1, text("lllllllSS")),
      klv("SCAL", "l", 4, 9, u32(1e7, 1e7, 1000, 1000, 100, 1, 1000, 100, 1)),
      klv("GPS9", "?", 32, 1, b),
    );
    expect(
      parseGpmf(klv("STRM", "\0", 1, body.length, body), 0, 1).gps![0],
    ).toMatchObject({ lat: 50, utc: start + 2000, fix: 3, dop: 1 });
  });
});
