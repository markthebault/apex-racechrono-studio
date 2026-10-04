import { describe, expect, it } from "vitest";
import {
  readCameraTelemetry,
  readDjiMotion,
  readInsta360Motion,
  parseDjiPacket,
} from "./cameraTelemetry";
import { djiMp4, djiPayload, instaTrailer } from "./cameraTelemetry.fixture";
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
