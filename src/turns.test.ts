import { expect, test } from "vitest";
import type { Trace } from "./model";
import { detectTurns } from "./turns";
function fixture(n = 301) {
  const d = Float64Array.from({ length: n }, (_, i) => i * 2);
  return {
    id: "ref",
    distance: d,
    rawDistance: d,
    times: Float64Array.from(d, (v) => v * 30),
    channels: { speed: Float64Array.from(d, () => 90) },
    length: d.at(-1)!,
  } as unknown as Trace;
}
test("numbers separate left/right bends in driving order, without splitting a long bend into review windows", () => {
  const ref = fixture(701),
    k = Float64Array.from(ref.distance, (d) =>
      d >= 50 && d <= 150
        ? 0.012
        : d >= 190 && d <= 290
          ? -0.015
          : d >= 500 && d <= 1200
            ? 0.005
            : 0,
    );
  const turns = detectTurns(ref, k);
  expect(turns.map((t) => [t.id, t.direction])).toEqual([
    ["T1", "left"],
    ["T2", "right"],
    ["T3", "left"],
  ]);
  expect(turns[2].end - turns[2].start).toBeGreaterThan(400);
  expect(turns.every((t) => t.position >= t.start && t.position <= t.end)).toBe(
    true,
  );
});
test("rejects short jitter, shallow direction noise, straight roads and missing curvature", () => {
  const ref = fixture();
  expect(detectTurns(ref, new Float64Array(ref.distance.length))).toEqual([]);
  expect(
    detectTurns(
      ref,
      Float64Array.from(ref.distance, (d) =>
        d >= 30 && d <= 35 ? 0.1 : d >= 200 && d <= 260 ? 0.002 : NaN,
      ),
    ),
  ).toEqual([]);
});
test("does not bridge a GPS outage into one turn", () => {
  const ref = fixture();
  const times = ref.times;
  for (let i = 100; i < times.length; i++) times[i] += 3000;
  const turns = detectTurns(
    ref,
    Float64Array.from(ref.distance, (d) => (d >= 100 && d <= 300 ? 0.012 : 0)),
  );
  expect(turns).toHaveLength(2);
  expect(turns[0].end).toBeLessThan(turns[1].start);
});
test("physical curvature uses physical arc length rather than aligned reference progress", () => {
  const ref = fixture();
  ref.distance = Float64Array.from(ref.distance, (d) => d * 2);
  ref.length *= 2;
  const turns = detectTurns(
    ref,
    Float64Array.from(ref.distance, (d) => (d >= 100 && d <= 300 ? 0.004 : 0)),
  );
  expect(turns).toHaveLength(1);
  expect(turns[0].start).toBe(100);
});

test("separates two same-direction corners across a short straight that the noise-joining tolerance bridges", () => {
  const ref = fixture();
  const curvature = Float64Array.from(ref.distance, (d) =>
    d >= 50 && d <= 150
      ? -0.025
      : d > 150 && d < 168
        ? -0.0001
        : d >= 168 && d <= 280
          ? -0.02
          : 0,
  );
  const turns = detectTurns(ref, curvature);
  expect(turns).toHaveLength(2);
  expect(turns.map((t) => t.direction)).toEqual(["right", "right"]);
  expect(turns[0].position).toBeLessThan(150);
  expect(turns[1].position).toBeGreaterThanOrEqual(168);
});
test("retains a single-lobed changing-radius bend and ignores a one-sample curvature dip", () => {
  const ref = fixture();
  const curvature = Float64Array.from(ref.distance, (d) =>
    d >= 50 && d <= 300
      ? d === 180
        ? 0
        : 0.006 + 0.006 * (1 - Math.abs(d - 175) / 125)
      : 0,
  );
  expect(detectTurns(ref, curvature)).toHaveLength(1);
});
test("splits only valleys with enough turning on both sides, regardless of GPS sampling density", () => {
  const low = fixture(),
    high = fixture(601);
  high.distance = Float64Array.from(high.distance, (d) => d / 2);
  high.rawDistance = high.distance;
  high.times = Float64Array.from(high.distance, (d) => d * 30);
  high.length = high.distance.at(-1)!;
  const curve = (d: number) =>
    d >= 50 && d <= 150
      ? 0.025
      : d > 150 && d < 168
        ? 0
        : d >= 168 && d <= 280
          ? 0.02
          : 0;
  expect(detectTurns(low, Float64Array.from(low.distance, curve))).toHaveLength(
    2,
  );
  expect(
    detectTurns(high, Float64Array.from(high.distance, curve)),
  ).toHaveLength(2);
  const short = Float64Array.from(low.distance, (d) =>
    d >= 50 && d <= 150
      ? 0.025
      : d > 150 && d < 168
        ? 0
        : d >= 168 && d <= 180
          ? 0.02
          : 0,
  );
  expect(detectTurns(low, short)).toHaveLength(1);
});

test("puts a constant-radius hairpin label in the body of the bend rather than on its entry", () => {
  const ref = fixture();
  const curvature = Float64Array.from(ref.distance, (d) =>
    d >= 100 && d <= 300 ? -0.015 : 0,
  );
  const turns = detectTurns(ref, curvature);
  expect(turns).toHaveLength(1);
  expect(turns[0].position).toBeCloseTo(200, 0);
});
test("a short sharp entry sample does not steal the label from the sustained bend", () => {
  const ref = fixture();
  const curvature = Float64Array.from(ref.distance, (d) =>
    d >= 100 && d <= 300
      ? d >= 106 && d <= 110
        ? 0.06
        : d >= 170 && d <= 280
          ? 0.02
          : 0.012
      : 0,
  );
  const turns = detectTurns(ref, curvature);
  expect(turns).toHaveLength(1);
  expect(turns[0].position).toBeGreaterThan(180);
  expect(turns[0].position).toBeLessThan(250);
});
test("maps the physical half-turn point back to reference progress", () => {
  const ref = fixture();
  ref.distance = Float64Array.from(ref.distance, (d) => d * 1.5);
  ref.length *= 1.5;
  const curvature = Float64Array.from(ref.distance, (d) =>
    d >= 150 && d <= 450 ? -0.015 : 0,
  );
  const turns = detectTurns(ref, curvature);
  expect(turns).toHaveLength(1);
  expect(turns[0].position).toBeCloseTo(300, 0);
});

test("numbers both sustained lobes of a connected same-direction compound bend", () => {
  const ref = fixture();
  const shape = (d: number) =>
    d >= 50 && d <= 300
      ? 0.009 +
        0.011 * Math.exp(-(((d - 110) / 22) ** 2)) +
        0.011 * Math.exp(-(((d - 210) / 22) ** 2))
      : 0;
  const turns = detectTurns(ref, Float64Array.from(ref.distance, shape));
  expect(turns).toHaveLength(2);
  expect(turns.map((t) => t.direction)).toEqual(["left", "left"]);
  expect(turns[0].position).toBeLessThan(160);
  expect(turns[1].position).toBeGreaterThan(160);
});
test("does not create another turn from a weak shoulder on a dominant bend", () => {
  const ref = fixture();
  const shape = (d: number) =>
    d >= 50 && d <= 300
      ? 0.009 +
        0.013 * Math.exp(-(((d - 120) / 35) ** 2)) +
        0.003 * Math.exp(-(((d - 230) / 25) ** 2))
      : 0;
  expect(detectTurns(ref, Float64Array.from(ref.distance, shape))).toHaveLength(
    1,
  );
});
