import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  cameraAcceleration,
  parseGpmf,
  readGoProMotion,
  sessionAcceleration,
} from "./videoTelemetry";
import { fakeMotionMp4, fakePayload } from "./videoTelemetry.fixture";
import { validateSync, videoTime, stampAtVideo } from "./storage";
import type { Session } from "./model";
describe("video braking alignment", () => {
  it("reads scaled acceleration and gyro from a timed GPMF MP4 track", async () => {
    const motion = await readGoProMotion(new Blob([fakeMotionMp4()]));
    expect(motion.acceleration).toHaveLength(240);
    expect(motion.gyro).toHaveLength(240);
    expect(motion.acceleration[80].t).toBe(4);
    expect(motion.acceleration[80].v[2]).toBeCloseTo(-0.7, 3);
    expect(motion.acceleration[0].v[0]).toBeCloseTo(1, 3);
    expect(motion.gyro[80].v[2]).toBeCloseTo(Math.sin(4) * 0.2, 3);
    expect(motion.acceleration.at(-1)!.t).toBeCloseTo(11.95);
  });
  it("does not manufacture acceleration from a gyro-only video", async () => {
    const motion = await readGoProMotion(new Blob([fakeMotionMp4(true)]));
    expect(motion.acceleration).toEqual([]);
    expect(motion.gyro.length).toBeGreaterThan(0);
  });
  it("rejects missing, truncated and cancelled telemetry", async () => {
    await expect(
      readGoProMotion(new Blob([new Uint8Array(8)])),
    ).rejects.toThrow("No MP4");
    expect(() => parseGpmf(fakePayload(0).slice(0, 20), 0, 1)).toThrow(
      "Truncated",
    );
    const abort = new AbortController();
    abort.abort();
    await expect(
      readGoProMotion(new Blob([fakeMotionMp4()]), abort.signal),
    ).rejects.toThrow("Cancelled");
  });
  it("derives acceleration from speed without crossing GPS outages", () => {
    const session = {
      channels: [
        {
          id: "speed",
          unit: "km/h",
          times: Float64Array.from([0, 1000, 2000, 6000, 7000]),
          values: Float64Array.from([100, 64.69606, 29.39212, 20, 20]),
        },
      ],
    } as Session;
    const points = sessionAcceleration(session);
    expect(points[1].g).toBeCloseTo(-1, 4);
    expect(points[2].g).toBeNaN();
    expect(points[3].g).toBeNaN();
  });
  it("applies a mounting baseline and sign while leaving samples unchanged", () => {
    const samples = [
      { t: 0, v: [1, 2, 3] as [number, number, number] },
      { t: 0.05, v: [1, 2, 5] as [number, number, number] },
    ];
    expect(cameraAcceleration(samples, 2, true, 1)).toEqual([{ t: 0, g: -3 }]);
    expect(samples[0].v[2]).toBe(3);
  });
  it("keeps camera calibration per clip in portable sync and honors split-clip timing", () => {
    const identity = { sha256: "a".repeat(64), name: "synthetic", size: 1 };
    const data = {
      format: "apex-sync",
      version: 1,
      bindings: [
        {
          session: identity,
          clips: [
            {
              ...identity,
              duration: 12,
              start: 0,
              motion: { camera: "gopro", axis: 2, invert: true, baseline: 0.1 },
            },
            {
              ...identity,
              sha256: "b".repeat(64),
              duration: 12,
              start: 12,
              motion: { camera: "none", axis: 0, invert: false, baseline: 0 },
            },
          ],
          anchors: [{ videoSeconds: 16, sessionTimestamp: 100000 }],
        },
      ],
    };
    const saved = validateSync(data);
    expect(saved.bindings[0].clips[0].motion?.camera).toBe("gopro");
    expect(saved.bindings[0].clips[1].motion?.camera).toBe("none");
    expect(videoTime(saved.bindings[0], 100000)).toBe(16);
    expect(stampAtVideo(saved.bindings[0], 16)).toBe(100000);
    data.bindings[0].clips[0].motion.axis = 4;
    expect(() => validateSync(data)).toThrow("camera telemetry");
  });
});
