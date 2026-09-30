import { describe, expect, it } from "vitest";
import { Color } from "three";
import { speedColor, brakeColor } from "./analysis";
import type { Trace } from "./model";
import {
  trackColor,
  trackFrame,
  trackSegments,
  trackPosition,
  project,
} from "./track3d";
function sample(): Trace {
  return {
    id: "test",
    sessionId: "test",
    label: "Test",
    lap: { id: "lap", number: 1, start: 0, end: 4000, issues: [] },
    times: Float64Array.from([0, 1000, 2000, 3000, 4000]),
    distance: Float64Array.from([0, 10, 20, 30, 40]),
    lat: Float64Array.from([50, 50.0001, 50.0002, 50.0003, 50.0004]),
    lon: Float64Array.from([6, 6, 6, 6, 6]),
    channels: { altitude: Float64Array.from([100, 105, 110, 115, 120]) },
    length: 40,
    issues: [],
  };
}
describe("3D elevation projection", () => {
  it("keeps metres and exaggerates only height, with north along negative Z", () => {
    const t = sample(),
      frame = trackFrame(t)!;
    expect(frame.relief).toBe(20);
    const real = project(t.lat[4], 6, 120, frame, 1),
      raised = project(t.lat[4], 6, 120, frame, 3);
    expect(real.y).toBe(20);
    expect(raised.y).toBe(60);
    expect(raised.x).toBe(real.x);
    expect(raised.z).toBe(real.z);
    expect(real.z).toBeLessThan(0);
    expect(trackPosition(t, 15, frame, 2)?.y).toBe(15);
  });
  it("splits at GPS outages and hides cars inside the outage", () => {
    const t = sample();
    t.times = Float64Array.from([0, 1000, 5000, 6000, 7000]);
    const frame = trackFrame(t)!;
    expect(
      trackSegments(t, frame, 1).map((s) => s.map((p) => p.index)),
    ).toEqual([
      [0, 1],
      [2, 3, 4],
    ]);
    expect(trackPosition(t, 15, frame, 1)).toBeUndefined();
  });
  it("omits missing fixes and altitude instead of drawing through them", () => {
    const t = sample();
    t.channels.altitude[2] = NaN;
    const frame = trackFrame(t)!;
    expect(frame.partialElevation).toBe(true);
    expect(
      trackSegments(t, frame, 1).map((s) => s.map((p) => p.index)),
    ).toEqual([
      [0, 1],
      [3, 4],
    ]);
    expect(trackPosition(t, 20, frame, 1)).toBeUndefined();
    t.lat[2] = NaN;
    expect(trackSegments(t, frame, 1)).toHaveLength(2);
  });
  it("uses an explicitly flat track when there is no elevation", () => {
    const t = sample();
    t.channels = {};
    const frame = trackFrame(t)!;
    expect(frame.hasElevation).toBe(false);
    expect(trackSegments(t, frame, 5)[0].every((p) => p.y === 0)).toBe(true);
    expect(trackPosition(t, 15, frame, 5)?.y).toBe(0);
  });
  it("rejects a trace with no usable coordinates", () => {
    const t = sample();
    t.lon.fill(NaN);
    expect(trackFrame(t)).toBeUndefined();
  });
});

it("converts the shared palettes to the actual WebGL colours", () => {
  for (const css of [
    speedColor(40),
    speedColor(170),
    speedColor(300),
    brakeColor(0),
    brakeColor(1),
  ]) {
    const color = new Color(trackColor(css));
    expect(color.getHex()).not.toBe(0xffffff);
  }
  expect(new Color(trackColor(speedColor(40))).getHexString()).toBe("f42525");
  expect(trackColor("#63e5d2")).toBe("#63e5d2");
});
