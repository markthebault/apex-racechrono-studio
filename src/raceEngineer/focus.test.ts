import { describe, expect, it } from "vitest";
import type { Trace } from "../model";
import type { Corner, Evidence, Report, Snapshot } from "./contracts";
import {
  focusItems,
  focusCue,
  metricValue,
  trackPicture,
  trackOverview,
} from "./focus";

const corners: Corner[] = [
  { id: "a", name: "Review window 1", start: 20, end: 40, direction: "left" },
  { id: "b", name: "Turn 2", start: 40, end: 80, direction: "right" },
];
function evidence(
  id: string,
  lapId: string,
  cornerId: string,
  time: number,
): Evidence {
  const metric = (value: number, unit: string) => ({
    value,
    unit,
    kind: "observed" as const,
    method: "test",
    channel: "speed",
    reasons: [],
  });
  return {
    id,
    lapId,
    cornerId,
    snapshotId: "snapshot",
    sessionId: "session",
    time: [0, time],
    distance: [20, 40],
    quality: [],
    uncertainty: "GPS",
    metrics: {
      elapsed: metric(time, "ms"),
      entrySpeed: metric(20, "m/s"),
      minimumSpeed: metric(lapId === "ref" ? 10 : 15, "m/s"),
      exitSpeed: metric(21, "m/s"),
    },
  };
}
const snapshot = () =>
  ({
    referenceId: "ref",
    corners,
    priorities: [],
    evidence: [
      evidence("ar", "ref", "a", 4000),
      evidence("ac", "other", "a", 3000),
      evidence("br", "ref", "b", 7000),
      evidence("bc", "other", "b", 6000),
    ],
  }) as unknown as Snapshot;
const report: Report = {
  format: "apex-engineer-report",
  version: 1,
  snapshotId: "snapshot",
  priorities: [
    {
      category: "telemetry-comparison",
      evidenceIds: ["ar", "ac", "br", "bc"],
      observation: "Combined observation",
      explanation: "Cause unknown",
      experiment: "Inspect both sections",
      limitations: "GPS only",
    },
  ],
};
function recordedTrace(): Trace {
  return {
    id: "ref",
    sessionId: "session",
    label: "Lap 1",
    lap: { id: "ref", number: 1, start: 0, end: 2000, issues: [] },
    length: 100,
    issues: [],
    channels: {},
    times: Float64Array.from({ length: 11 }, (_, i) => i * 200),
    distance: Float64Array.from({ length: 11 }, (_, i) => i * 10),
    lat: Float64Array.from(
      { length: 11 },
      (_, i) => Math.sin((i / 10) * Math.PI) * 0.0001,
    ),
    lon: Float64Array.from({ length: 11 }, (_, i) => i * 0.00008),
  };
}
describe("visual section reviews", () => {
  it("splits legacy multi-window priorities into separate maps and never mixes their lap measurements", () => {
    const items = focusItems(snapshot(), report);
    expect(items.map((i) => i.corner.id)).toEqual(["a", "b"]);
    expect(items.map((i) => i.reference?.id)).toEqual(["ar", "br"]);
    expect(items.map((i) => i.comparison?.id)).toEqual(["ac", "bc"]);
    expect(items.every((i) => i.combined)).toBe(true);
    expect(focusCue(items[0])?.at).toBe("minimum");
  });
  it("does not pick poor-quality evidence as the visual comparison or fall back after an AI abstention", () => {
    const s = snapshot();
    s.evidence[1].quality.push("unverified context");
    expect(focusItems(s, report)[0].comparison).toBeUndefined();
    expect(focusCue(focusItems(s, report)[0])).toBeUndefined();
    expect(focusItems(s, { ...report, priorities: [] })).toEqual([]);
    s.evidence[0].metrics.entrySpeed.unit = "raw";
    expect(metricValue(s.evidence[0], "entrySpeed", "m/s")).toBeUndefined();
  });
  it("projects recorded coordinates and uses the reference minimum position without inventing an apex", () => {
    const picture = trackPicture(recordedTrace(), corners[1], 60)!;
    expect(picture.section).not.toMatch(/NaN|Infinity/);
    expect(picture.markers.minimum).toBeDefined();
    expect(picture.markers.entry).not.toEqual(picture.markers.exit);
    expect(
      trackPicture(recordedTrace(), corners[1], 5)?.markers.minimum,
    ).toBeUndefined();
  });
  it("breaks GPS outage segments and abstains when no continuous section path is available", () => {
    const t = recordedTrace();
    for (let i = 5; i < t.times.length; i++) t.times[i] += 5000;
    const picture = trackPicture(t, { ...corners[1], start: 20, end: 80 });
    expect(picture?.section.match(/M/g)?.length).toBe(2);
    expect(
      trackPicture(t, { ...corners[1], start: 40, end: 50 }),
    ).toBeUndefined();
    t.lat.fill(NaN);
    expect(trackPicture(t, corners[1])).toBeUndefined();
  });
});

it("keeps overview regions in one projection and separates their labels", () => {
  const t = recordedTrace();
  const overview = trackOverview(t, corners, { a: 30, b: 30 })!;
  expect(overview.regions.map((r) => r.id)).toEqual(["a", "b"]);
  expect(overview.whole).not.toMatch(/NaN|Infinity/);
  expect(overview.regions[0].anchor).toEqual(overview.regions[1].anchor);
  expect(overview.regions[0].label).not.toEqual(overview.regions[1].label);
  expect(overview.regions.every((r) => r.path.includes("L"))).toBe(true);
});
it("retains gaps on the full track and omits labels inside an outage", () => {
  const t = recordedTrace();
  for (let i = 5; i < t.times.length; i++) t.times[i] += 5000;
  const overview = trackOverview(t, [{ ...corners[0], start: 20, end: 80 }], {
    a: 45,
  })!;
  expect(overview.whole.match(/M/g)).toHaveLength(2);
  expect(overview.regions[0].path.match(/M/g)).toHaveLength(2);
  expect(overview.regions[0].anchor).toBeUndefined();
  t.lat.fill(NaN);
  expect(trackOverview(t, corners)).toBeUndefined();
});
