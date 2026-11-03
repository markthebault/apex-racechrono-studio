import { expect, test } from "vitest";
import { gestureAxis, panTimeline, pinchTimeline } from "./mobileAnalysis";
test("distinguishes intentional horizontal analysis from scrolling and tap jitter", () => {
  expect(gestureAxis(3, 5)).toBe("pending");
  expect(gestureAxis(10, 35)).toBe("scroll");
  expect(gestureAxis(35, 10)).toBe("horizontal");
});
test("pinch anchors the distance under the midpoint and combines zoom with pan", () => {
  const range: [number, number] = [100, 500];
  const initial = { x: 100, gap: 40 };
  const next = pinchTimeline(range, initial, { x: 120, gap: 80 }, 200, 1000);
  expect(next).toEqual([180, 380]);
  expect(next[0] + (120 / 200) * (next[1] - next[0])).toBe(300);
  expect(pinchTimeline(range, initial, { x: 50, gap: 40 }, 200, 1000)).toEqual([
    200, 600,
  ]);
});
test("pinch clamps both edges, minimum span and short laps without invalid ranges", () => {
  expect(
    pinchTimeline(
      [100, 500],
      { x: 100, gap: 100 },
      { x: 2000, gap: 100 },
      200,
      1000,
    ),
  ).toEqual([0, 400]);
  expect(
    pinchTimeline(
      [100, 500],
      { x: 100, gap: 100 },
      { x: -2000, gap: 100 },
      200,
      1000,
    ),
  ).toEqual([600, 1000]);
  expect(
    pinchTimeline(
      [100, 500],
      { x: 100, gap: 100 },
      { x: 100, gap: 1 },
      200,
      1000,
    ),
  ).toEqual([0, 1000]);
  const minimum = pinchTimeline(
    [100, 500],
    { x: 100, gap: 1 },
    { x: 100, gap: 1000 },
    200,
    1000,
  );
  expect(minimum[1] - minimum[0]).toBe(50);
  expect(
    pinchTimeline([0, 20], { x: 100, gap: 1 }, { x: 100, gap: 1000 }, 200, 20),
  ).toEqual([0, 20]);
});
test("pans a timeline without changing scale or escaping the recording", () => {
  expect(panTimeline([100, 300], -50, 200, 1000)).toEqual([150, 350]);
  expect(panTimeline([100, 300], 500, 200, 1000)).toEqual([0, 200]);
  expect(panTimeline([100, 300], -2000, 200, 1000)).toEqual([800, 1000]);
  expect(panTimeline([0, 1000], 50, 200, 1000)).toEqual([0, 1000]);
});
