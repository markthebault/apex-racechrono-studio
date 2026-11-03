import { expect, test } from "vitest";
import { gestureAxis, panTimeline } from "./mobileAnalysis";
test("distinguishes intentional horizontal analysis from scrolling and tap jitter", () => {
  expect(gestureAxis(3, 5)).toBe("pending");
  expect(gestureAxis(10, 35)).toBe("scroll");
  expect(gestureAxis(35, 10)).toBe("horizontal");
});
test("pans a timeline without changing scale or escaping the recording", () => {
  expect(panTimeline([100, 300], -50, 200, 1000)).toEqual([150, 350]);
  expect(panTimeline([100, 300], 500, 200, 1000)).toEqual([0, 200]);
  expect(panTimeline([100, 300], -2000, 200, 1000)).toEqual([800, 1000]);
  expect(panTimeline([0, 1000], 50, 200, 1000)).toEqual([0, 1000]);
});
