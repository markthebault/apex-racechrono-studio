import { describe, it, expect } from "vitest";
import type { Trace, Session } from "./model";
import {
  availableChannels,
  brakingPoints,
  matchBrakePoints,
} from "./telemetry";
import { advanceReplay, replayWindow } from "./replay";
import { lapConsistency } from "./summary";
function trace(channels: Record<string, number[]> = {}): Trace {
  return {
    id: "lap",
    sessionId: "session",
    label: "Test",
    lap: { id: "lap", number: 1, start: 0, end: 7000, issues: [] },
    times: Float64Array.from([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000]),
    distance: Float64Array.from([0, 10, 20, 30, 40, 50, 60, 70]),
    lat: new Float64Array(8).fill(50),
    lon: new Float64Array(8).fill(6),
    channels: Object.fromEntries(
      Object.entries(channels).map(([key, values]) => [
        key,
        Float64Array.from(values),
      ]),
    ),
    length: 70,
    issues: [],
  };
}
describe("available telemetry", () => {
  it("keeps zero readings and comparison-only channels, omitting missing values", () => {
    const a = trace({
      speed: [0, 0],
      rpm: [NaN, NaN],
      empty: [],
      corrupt: [Infinity, -Infinity],
    });
    const b = trace({ rpm: [NaN, 5000], throttle: [0] });
    expect([...availableChannels([a, undefined])]).toEqual(["speed"]);
    expect([...availableChannels([a, b])]).toEqual([
      "speed",
      "rpm",
      "throttle",
    ]);
  });
});
describe("section replay", () => {
  it("applies each playback speed to elapsed time", () => {
    expect(advanceReplay(1000, 800, 0.25, [0, 10000], false).time).toBe(1200);
    expect(advanceReplay(1000, 800, 0.5, [0, 10000], false).time).toBe(1400);
    expect(advanceReplay(1000, 800, 1, [0, 10000], false).time).toBe(1800);
    expect(advanceReplay(1000, 800, 2, [0, 10000], false).time).toBe(2600);
  });
  it("wraps the selected section and preserves excess time even over several loops", () => {
    expect(advanceReplay(1900, 200, 1, [1000, 2000], true)).toEqual({
      time: 1100,
      ended: false,
    });
    expect(advanceReplay(1900, 1700, 2, [1000, 2000], true)).toEqual({
      time: 1300,
      ended: false,
    });
    expect(advanceReplay(1900, 100, 1, [1000, 2000], true).time).toBe(1000);
  });
  it("stops at the finish in normal playback", () => {
    expect(advanceReplay(1900, 200, 1, [0, 2000], false)).toEqual({
      time: 2000,
      ended: true,
    });
  });
  it("includes stationary time when choosing a section and the whole lap", () => {
    const t = trace();
    t.distance = Float64Array.from([0, 10, 20, 20, 20, 50, 70, 70]);
    expect(replayWindow(t, [20, 50])).toEqual([2000, 5000]);
    expect(replayWindow(t, [0, 70])).toEqual([0, 7000]);
  });
  it("rejects section endpoints inside a GPS outage", () => {
    const t = trace();
    t.times = Float64Array.from([0, 1000, 5000, 6000, 7000, 8000, 9000, 10000]);
    expect(replayWindow(t, [15, 60])).toBeUndefined();
    expect(replayWindow(t, [20, 60])).toEqual([5000, 9000]);
  });
});
describe("braking onset comparison", () => {
  it("finds recorded braking onsets but omits unobserved starts after a GPS gap", () => {
    const t = trace({ brake: [0, 100, 100, 0, 0, 100, 100, 0] });
    expect(brakingPoints(t)).toEqual([
      { start: 10, end: 20 },
      { start: 50, end: 60 },
    ]);
    const gap = {
      ...t,
      times: Float64Array.from([0, 1000, 2000, 3000, 4000, 8000, 9000, 10000]),
    };
    expect(brakingPoints(gap)).toEqual([{ start: 10, end: 20 }]);
    const missing = { ...t, lat: t.lat.slice() };
    missing.lat[4] = NaN;
    expect(brakingPoints(missing)).toEqual([{ start: 10, end: 20 }]);
  });
  it("keeps extra or distant braking events unmatched instead of shifting every corner", () => {
    const point = (start: number) => ({ start, end: start + 30 });
    const a = [point(100), point(500), point(900)],
      b = [point(110), point(280), point(480), point(1100)];
    expect(matchBrakePoints(a, b)).toEqual([
      { a: a[0], b: b[0] },
      { b: b[1] },
      { a: a[1], b: b[2] },
      { a: a[2] },
      { b: b[3] },
    ]);
    expect(
      matchBrakePoints([point(100), point(130)], [point(125)]).filter(
        (pair) => pair.a && pair.b,
      ),
    ).toHaveLength(1);
  });
});
describe("lap consistency", () => {
  const session = (times: [number, string[]][]) =>
    ({
      laps: times.map(([time, issues], i) => ({
        id: String(i),
        number: i + 1,
        start: 0,
        end: time,
        issues,
      })),
    }) as Session;
  it("uses only complete uninterrupted lap times and reports the sample count", () => {
    const s = session([
      [100000, []],
      [102000, []],
      [600000, ["Interrupted lap: unusually long duration"]],
      [95000, ["Marked invalid by RaceChrono"]],
      [110000, ["GPS gap longer than 2 seconds"]],
      [99000, ["Incomplete GPS coverage"]],
    ]);
    expect(lapConsistency(s)).toEqual({
      count: 2,
      excluded: 4,
      spread: 2000,
      deviation: 1000,
      median: 101000,
    });
    expect(s.laps).toHaveLength(6);
  });
  it("does not invent consistency from one lap and accepts identical times", () => {
    expect(lapConsistency(session([[100000, []]]))).toEqual({
      count: 1,
      excluded: 0,
    });
    expect(
      lapConsistency(
        session([
          [100000, []],
          [100000, []],
        ]),
      ).spread,
    ).toBe(0);
  });
});
