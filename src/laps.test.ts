import { describe, expect, it } from "vitest";
import { lapsFromLine } from "./laps";
import type { FinishLine } from "./model";

// Repeated northbound runs, with an untimed return south of the start.
const times = [
  0, 10000, 30000, 40000, 50000, 60000, 80000, 90000, 100000, 110000,
];
const lat = [
  -0.001, 0.001, 0.003, 0.005, -0.001, 0.001, 0.003, 0.005, -0.001, 0.001,
];
const lon = times.map(() => 0);
const line: FinishLine = { lat: 0, lon: 0, heading: 0, source: "user" };
const finish: FinishLine = { ...line, lat: 0.004 };

describe("separate timing lines", () => {
  it("pairs each start with the next finish and drops unfinished runs", () => {
    const laps = lapsFromLine("run", times, lat, lon, { ...line, finish });
    expect(laps.map(({ start, end }) => [start, end])).toEqual([
      [5000, 35000],
      [55000, 85000],
    ]);
    expect(laps.map((l) => l.number)).toEqual([1, 2]);
  });
  it("keeps shared-line timing when separate finish is disabled", () => {
    const laps = lapsFromLine("run", times, lat, lon, line);
    expect(laps.map(({ start, end }) => [start, end])).toEqual([
      [5000, 55000],
      [55000, 105000],
    ]);
  });
  it("respects finish rotation and a full 360 degree rotation", () => {
    const reversed = lapsFromLine("run", times, lat, lon, {
      ...line,
      finish: { ...finish, heading: 180 },
    });
    expect(reversed[0].end).toBeCloseTo(41666.6667, 3);
    expect(
      lapsFromLine("run", times, lat, lon, {
        ...line,
        heading: 360,
        finish: { ...finish, heading: 360 },
      }),
    ).toEqual(lapsFromLine("run", times, lat, lon, { ...line, finish }));
  });
  it("does not pair a finish before the start or reuse a finish across starts", () => {
    const laps = lapsFromLine("run", times, lat, lon, {
      ...finish,
      finish: line,
    });
    expect(laps.map(({ start, end }) => [start, end])).toEqual([
      [35000, 55000],
      [85000, 105000],
    ]);
  });
});
