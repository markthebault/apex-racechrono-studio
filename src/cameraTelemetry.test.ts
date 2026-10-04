import { describe, expect, it } from "vitest";
import {
  readCameraTelemetry,
  readDjiMotion,
  readInsta360Motion,
  parseDjiPacket,
  readCammMotion,
} from "./cameraTelemetry";
import {
  djiMp4,
  djiPayload,
  instaTrailer,
  metadataTrack,
} from "./cameraTelemetry.fixture";
import { join, box } from "./videoTelemetry.fixture";
import { fakeMotionMp4 } from "./videoTelemetry.fixture";
import { protobuf } from "./protobuf";
import type { CameraMotion } from "./videoTelemetry";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
const blob = (bytes: Uint8Array) => new Blob([bytes as BlobPart]);
describe("multi-camera telemetry", () => {
  it.each(["dvtm_ac203.proto", "dvtm_ac204.proto", "dvtm_ac206.proto"])(
    "reads Action metadata %s",
    async (schema) => {
      const data = await readDjiMotion(blob(djiMp4(schema)));
      expect(data.acceleration).toHaveLength(12);
      expect(data.acceleration[4]).toEqual({
        t: 4,
        v: [0, expect.closeTo(-0.7, 5), 1],
      });
      expect(data.gyro).toHaveLength(0);
      expect(data.gps?.[0].utc).toBe(Date.UTC(2026, 0, 1, 12, 0, 2));
      expect(data.gps?.[0].fix).toBe(3);
    },
  );
  it.each([false, true])(
    "reads Insta360 IMU and anchored GPS (raw=%s)",
    async (raw) => {
      const data = await readInsta360Motion(blob(instaTrailer(raw)));
      expect(data.acceleration).toHaveLength(240);
      expect(data.gyro).toHaveLength(240);
      expect(data.acceleration[80].t).toBe(4);
      expect(data.acceleration[80].v[1]).toBeCloseTo(-0.7, 3);
      expect(data.gyro[80].v[2]).toBeCloseTo(0.2, 2);
      expect(data.gps?.[0].t).toBe(0.5);
    },
  );
  it("does not invent GPS timing when its reference is missing", async () => {
    const data = await readInsta360Motion(blob(instaTrailer(false, false)));
    expect(data.gps).toEqual([]);
    expect(data.warnings?.[0]).toMatch(/timing reference/);
  });
  it("rejects retimed Insta360 files, absent trailers and unknown DJI schemas", async () => {
    await expect(
      readInsta360Motion(blob(instaTrailer(false, true, true))),
    ).rejects.toThrow(/retimed/);
    await expect(readInsta360Motion(blob(djiMp4()))).rejects.toThrow(
      /original recording/,
    );
    await expect(readDjiMotion(blob(djiMp4("unknown.proto")))).rejects.toThrow(
      /Unsupported DJI/,
    );
  });
  it("auto-detects all three formats", async () => {
    for (const bytes of [djiMp4(), instaTrailer(), fakeMotionMp4()]) {
      expect(
        (await readCameraTelemetry(blob(bytes), "auto")).acceleration.length,
      ).toBeGreaterThan(0);
    }
  });
  it("reads CAMM gyro, acceleration units and GPS with recorded presentation times", async () => {
    const packet = (type: number, length: number) => {
      const b = new Uint8Array(length),
        d = new DataView(b.buffer);
      d.setUint16(2, type, true);
      return { b, d };
    };
    const acc = packet(3, 16);
    acc.d.setFloat32(4, 9.80665, true);
    acc.d.setFloat32(12, -4.903325, true);
    const gyro = packet(2, 16);
    gyro.d.setFloat32(8, 0.5, true);
    const gps = packet(6, 60);
    gps.d.setFloat64(4, 123456, true);
    gps.d.setInt32(12, 3, true);
    gps.d.setFloat64(16, 50, true);
    gps.d.setFloat64(24, 6, true);
    const packets = [acc.b, gyro.b, gps.b];
    const bytes = join(
      box("mdat", join(...packets)),
      box("moov", metadataTrack("camm", packets, 8)),
    );
    for (const camera of ["auto", "insta360"] as const) {
      const data = await readCameraTelemetry(blob(bytes), camera);
      expect(data.acceleration[0].v).toEqual([
        expect.closeTo(1, 5),
        0,
        expect.closeTo(-0.5, 5),
      ]);
      expect(data.gyro[0]).toEqual({ t: 1, v: [0, 0.5, 0] });
      expect(data.gps?.[0]).toMatchObject({ t: 2, lat: 50, lon: 6, fix: 3 });
      expect(data.gps?.[0].utc).toBeUndefined();
    }
    const bad = join(
      box("mdat", new Uint8Array([0, 0, 3, 0, 0])),
      box("moov", metadataTrack("camm", [new Uint8Array(5)], 8)),
    );
    await expect(readCammMotion(blob(bad))).rejects.toThrow(/Truncated CAMM/);
  });
  it("reads ten minutes of high-rate CAMM without individual sample reads", async () => {
    const packet = new Uint8Array(16),
      d = new DataView(packet.buffer);
    d.setUint16(2, 3, true);
    d.setFloat32(4, 9.80665, true);
    const packets = Array.from({ length: 120000 }, () => packet);
    const payload = new Uint8Array(packets.length * packet.length);
    packets.forEach((p, i) => payload.set(p, i * p.length));
    const file = blob(
      join(
        box("mdat", payload),
        box("moov", metadataTrack("camm", packets, 8, 5)),
      ),
    );
    let reads = 0;
    const slice = file.slice.bind(file);
    file.slice = (...args) => {
      reads++;
      return slice(...args);
    };
    const data = await readCammMotion(file);
    expect(data.acceleration).toHaveLength(120000);
    expect(data.acceleration.at(-1)?.t).toBeCloseTo(599.995, 3);
    expect(reads).toBeLessThan(20);
  });
  it("rejects malformed protobuf and honours cancellation", async () => {
    expect(() => protobuf(new Uint8Array([10, 255]))).toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(readDjiMotion(blob(djiMp4()), abort.signal)).rejects.toThrow();
    await expect(
      readInsta360Motion(blob(instaTrailer()), abort.signal),
    ).rejects.toThrow();
  });
  it("does not reuse a different camera schema", () => {
    const out: CameraMotion = { acceleration: [], gyro: [], gps: [] };
    parseDjiPacket(djiPayload(0), 0, 1, out);
    expect(() =>
      parseDjiPacket(djiPayload(1, "unknown.proto"), 1, 1, out),
    ).toThrow(/Unsupported/);
  });
  it.skipIf(
    !process.env.APEX_FIXTURES ||
      !existsSync(process.env.APEX_FIXTURES + "/dji-action6-gps.bin"),
  )("reads the public DJI Action 6 metadata fixture", async () => {
    const bytes = await readFile(
      process.env.APEX_FIXTURES + "/dji-action6-gps.bin",
    );
    const out: CameraMotion = { acceleration: [], gyro: [], gps: [] };
    parseDjiPacket(bytes, 0, 0, out);
    expect(out.acceleration).toHaveLength(99718);
    expect(out.gps).toHaveLength(99718);
    expect(out.acceleration[0].v[0]).toBeCloseTo(-0.858682, 5);
    expect(out.gps?.[0].lat).toBeCloseTo(44.7167074, 7);
    expect(out.gps?.at(-1)?.t).toBeCloseTo(1994.433068, 5);
  });
});
