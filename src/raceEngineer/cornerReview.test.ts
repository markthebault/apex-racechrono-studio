import { describe, it, expect } from "vitest";
import type { Session, Trace } from "../model";
import {
  emptySettings,
  validateReport,
  validateSettings,
  type Snapshot,
  type Report,
  type Evidence,
} from "./contracts";
import { cornerPasses, cornerReview, mergeReviews } from "./cornerReview";
import { forceAxes } from "./gforces";
import { G, normalize, sample } from "./signals";
import { buildSnapshot } from "./pipeline";
import { AnalysisService } from "./service";
import { initialMessages } from "./provider";
function circle() {
  const times = Float64Array.from({ length: 401 }, (_, i) => i * 100),
    distance = Float64Array.from(times, (t) => (t / 1000) * 20);
  const session: Session = {
    id: "session",
    filename: "synthetic.rcz",
    size: 0,
    track: "Synthetic circle",
    trackId: 1,
    start: 0,
    end: 40000,
    importedOptimal: 0,
    times,
    lat: Float64Array.from(distance, (d) => (Math.sin(d / 100) * 100) / 111195),
    lon: Float64Array.from(distance, (d) => (Math.cos(d / 100) * 100) / 111195),
    channels: [
      {
        id: "speed",
        name: "GPS speed",
        unit: "m/s",
        source: "synthetic",
        times,
        values: Float64Array.from(times, () => 20),
      },
    ],
    laps: [{ id: "lap-1", number: 1, start: 0, end: 40000, issues: [] }],
    unknown: [],
  };
  const t: Trace = {
    id: "lap-1",
    sessionId: session.id,
    label: "Lap 1",
    lap: session.laps[0],
    length: 800,
    issues: [],
    channels: {},
    distance,
    rawDistance: distance,
    times,
    lat: session.lat,
    lon: session.lon,
  };
  return { session, t };
}
function fixture() {
  const metric = (value: number, unit: string) => ({
    value,
    unit,
    kind: "observed" as const,
    method: "test",
    channel: "synthetic",
    reasons: [],
  });
  const laps = [90000, 100000, 80000, 110000].map((durationMs, i) => ({
    id: `lap-${i + 1}`,
    sessionId: "session",
    number: i + 1,
    durationMs,
    issues: [],
    coachingEligible: true,
  }));
  const evidence: Evidence[] = [7000, 5000, 6000, 4000].map((time, i) => ({
    id: `source-${i + 1}`,
    snapshotId: "snapshot",
    sessionId: "session",
    lapId: laps[i].id,
    cornerId: "corner-1",
    time: [0, time],
    distance: [100, 200],
    quality: [],
    uncertainty: "Test",
    metrics: {
      elapsed: metric(time, "ms"),
      entrySpeed: metric(30, "m/s"),
      minimumSpeed: metric(20, "m/s"),
      exitSpeed: metric(25, "m/s"),
    },
  }));
  const snapshot: Snapshot = {
    version: 1,
    id: "snapshot",
    algorithm: "test",
    referenceId: "lap-1",
    sessionIds: ["session"],
    contexts: {},
    capabilities: {},
    laps,
    evidence,
    corners: [
      {
        id: "corner-1",
        name: "Review window 1",
        start: 100,
        end: 200,
        direction: "left",
      },
      {
        id: "corner-2",
        name: "Review window 2",
        start: 200,
        end: 300,
        direction: "left",
      },
    ],
    priorities: [],
    envelope: {
      status: "unavailable",
      bins: [],
      method: "none",
      limitations: [],
    },
    modeled: { status: "unavailable", reasons: [] },
    warnings: [],
  };
  return snapshot;
}
function report(s: Snapshot): Report {
  return {
    format: "apex-engineer-report",
    version: 1,
    snapshotId: s.id,
    priorities: [],
    cornerReviews: [
      {
        cornerId: "corner-1",
        evidenceIds: ["e4", "e2", "e3"],
        observation: "Compare all three passes.",
        possibleMistakes: "Working hypothesis; inputs unknown.",
        advice: "Repeat a comfortable reference.",
        successCheck: "Compare repeatability with this baseline.",
        limitations: "GPS estimate, not tyre force.",
      },
    ],
  };
}
describe("corner coaching and G-force evidence", () => {
  it("ranks the three quickest section passes, independently of whole-lap pace", () => {
    const s = fixture();
    expect(
      cornerPasses(s, "corner-1")
        .slice(0, 3)
        .map((e) => e.lapId),
    ).toEqual(["lap-4", "lap-2", "lap-3"]);
    const d = cornerReview(s, [], emptySettings(), "corner-1");
    expect(d.topThreeIds).toEqual(["source-4", "source-2", "source-3"]);
    expect(d.passes.at(-1)?.isReviewLap).toBe(true);
  });
  it("excludes unreliable windows and unverified coaching laps, but keeps unaffected GPS-gap windows", () => {
    const s = fixture();
    s.evidence[3].quality = ["GPS gap"];
    s.laps[1].issues = ["GPS gap elsewhere"];
    s.laps[2].coachingEligible = false;
    expect(cornerPasses(s, "corner-1").map((e) => e.lapId)).toEqual([
      "lap-2",
      "lap-1",
    ]);
    const d = cornerReview(s, [], emptySettings(), "corner-1");
    expect(d.topThreeIds).toHaveLength(2);
    expect(d.eligiblePasses).toBe(2);
  });
  it("does not count duplicate evidence as another pass", () => {
    const s = fixture();
    s.evidence.push({
      ...s.evidence[3],
      id: "duplicate",
      metrics: {
        ...s.evidence[3].metrics,
        elapsed: { ...s.evidence[3].metrics.elapsed, value: 3000 },
      },
    });
    expect(cornerPasses(s, "corner-1")).toHaveLength(4);
    expect(cornerPasses(s, "corner-1")[0].id).toBe("duplicate");
  });
  it("computes a signed GPS lateral estimate from physical curvature and labels its source", () => {
    const { session, t } = circle();
    const axes = forceAxes(t, normalize(session, []));
    expect(axes.lateral.source).toBe("gps-derived");
    expect(sample(axes.lateral.channel, 10000) / G).toBeCloseTo(4 / G, 2);
    expect(sample(axes.longitudinal.channel, 10000)).toBeCloseTo(0, 6);
  });
  it("keeps the longitudinal sign and converts acceleration to g without inventing pedal inputs", () => {
    const { session, t } = circle();
    session.channels[0].values = Float64Array.from(
      t.times,
      (time) => 10 + (time / 1000) * 2,
    );
    const axes = forceAxes(t, normalize(session, []));
    expect(sample(axes.longitudinal.channel, 10000) / G).toBeCloseTo(2 / G, 6);
  });
  it("prefers recorded mapped zero and g units over GPS estimates", () => {
    const { session, t } = circle();
    session.channels.push({
      id: "lat-sensor",
      name: "Sensor",
      unit: "g",
      times: session.times,
      values: new Float64Array(session.times.length),
      source: "synthetic sensor",
    });
    const axes = forceAxes(
      t,
      normalize(session, [
        {
          channel: "lat-sensor",
          semantic: "lateral",
          unit: "g",
          scale: 1,
          offset: 0,
          confirmed: true,
        },
      ]),
    );
    expect(axes.lateral.source).toBe("recorded");
    expect(sample(axes.lateral.channel, 10000)).toBe(0);
  });
  it("breaks GPS G estimates at outages instead of bridging them", () => {
    const { session, t } = circle();
    const i = 100;
    t.times = Float64Array.from(t.times, (v, j) => (j >= i ? v + 3000 : v));
    session.times = t.times;
    session.channels[0] = { ...session.channels[0], times: t.times };
    const a = forceAxes(t, normalize(session, []));
    expect(Number.isNaN(sample(a.lateral.channel, 11500))).toBe(true);
    expect(Number.isNaN(sample(a.longitudinal.channel, 11500))).toBe(true);
  });
  it("stores G summaries as P95 with provenance and supplies signed aligned traces", async () => {
    const { session } = circle(),
      settings = emptySettings();
    settings.corners["lap-1"] = [
      {
        id: "corner-1",
        name: "Turn 1",
        start: 100,
        end: 200,
        direction: "left",
      },
    ];
    const s = await buildSnapshot({
      sessions: [session],
      referenceId: "lap-1",
      lapIds: ["lap-1"],
      settings,
    });
    const e = s.evidence[0];
    expect(e.metrics.lateralG95.unit).toBe("g");
    expect(e.metrics.lateralG95.kind).toBe("derived");
    expect(e.metrics.lateralG95.value).toBeCloseTo(4 / G, 2);
    expect(e.metrics.lateralG95.method).toContain("95th percentile");
    const d = cornerReview(s, [session], settings, "corner-1", 48);
    expect(d.passes[0].rows).toHaveLength(48);
    expect(
      d.passes[0].rows.filter((r) => r[3] !== null).length,
    ).toBeGreaterThan(40);
    expect(JSON.stringify(d)).not.toMatch(/"(?:lat|lon|filename)":/);
  });
  it("requires every available top-three pass and rejects cross-corner advice", () => {
    const s = fixture();
    expect(validateReport(report(s), s).cornerReviews![0].evidenceIds).toEqual([
      "source-4",
      "source-2",
      "source-3",
    ]);
    const r = report(s);
    r.cornerReviews![0].evidenceIds = ["e4", "e2"];
    expect(() => validateReport(r, s)).toThrow(/all available top-three/);
    s.evidence.push({ ...s.evidence[0], id: "other", cornerId: "corner-2" });
    r.cornerReviews![0].evidenceIds = ["e4", "e2", "e3", "other"];
    expect(() => validateReport(r, s)).toThrow(/another section/);
  });
  it("rejects an unreliable extra reference even when all best passes are linked", () => {
    const s = fixture(),
      r = report(s);
    s.evidence[0].quality = ["GPS gap in this window"];
    r.cornerReviews![0].evidenceIds.push("e1");
    expect(() => validateReport(r, s)).toThrow(/unreliable comparison window/);
  });
  it("accepts known corner and lap labels and small clean-pass counts in practical advice", () => {
    const s = fixture(),
      r = report(s);
    s.corners[0].name = "Section 10";
    r.cornerReviews![0].advice =
      "Repeat Section 10 for 3 clean passes using one comfortable approach.";
    r.cornerReviews![0].successCheck =
      "Compare the passes with Lap 2 and Lap 3.";
    expect(validateReport(r, s).cornerReviews![0].advice).toContain(
      "3 clean passes",
    );
    s.corners[0].name = "Review window 10";
    expect(() => validateReport(r, s)).not.toThrow();
    r.cornerReviews![0].advice = "Repeat for 3.5 clean passes.";
    expect(() => validateReport(r, s)).toThrow(/numerical driving targets/);
    r.cornerReviews![0].advice = "Target 3 g for 3 clean passes in Section 10.";
    expect(() => validateReport(r, s)).toThrow(/numerical driving targets/);
    r.cornerReviews![0].advice = "Compare with Lap 99.";
    expect(() => validateReport(r, s)).toThrow(/numerical driving targets/);
  });
  it("rejects invented numerical driving targets and raw SI speed prose", () => {
    const s = fixture(),
      r = report(s);
    r.cornerReviews![0].advice = "Use a braking marker at 1600 m.";
    r.cornerReviews![0].successCheck = "Stay within 0.5 m/s of the best.";
    expect(() => validateReport(r, s)).toThrow(/numerical driving targets/);
    r.cornerReviews![0].advice = "Brake later and accelerate harder.";
    r.cornerReviews![0].successCheck = "Compare against the baseline.";
    expect(() => validateReport(r, s)).toThrow(/Do not prescribe/);
    r.cornerReviews![0].advice = "Repeat the same comfortable reference.";
    r.cornerReviews![0].observation = "Entry speed was 20 m/s.";
    expect(() => validateReport(r, s)).toThrow(/dashboard speed units/);
  });
  it("uses nonzero mapped sensor g correctly for both axes instead of deriving them from GPS", async () => {
    const { session } = circle(),
      settings = emptySettings();
    session.channels.push(
      {
        id: "sensor-lat",
        name: "Lateral sensor",
        unit: "g",
        source: "synthetic sensor",
        times: session.times,
        values: Float64Array.from(session.times, () => 1.2),
      },
      {
        id: "sensor-long",
        name: "Longitudinal sensor",
        unit: "g",
        source: "synthetic sensor",
        times: session.times,
        values: Float64Array.from(session.times, () => -0.5),
      },
    );
    settings.mappings[session.id] = [
      {
        channel: "sensor-lat",
        semantic: "lateral",
        unit: "g",
        scale: 1,
        offset: 0,
        confirmed: true,
      },
      {
        channel: "sensor-long",
        semantic: "longitudinal",
        unit: "g",
        scale: 1,
        offset: 0,
        confirmed: true,
      },
    ];
    settings.corners["lap-1"] = [
      {
        id: "corner-1",
        name: "Turn 1",
        start: 100,
        end: 200,
        direction: "left",
      },
    ];
    const s = await buildSnapshot({
      sessions: [session],
      referenceId: "lap-1",
      lapIds: ["lap-1"],
      settings,
    });
    expect(s.evidence[0].metrics.lateralG95.value).toBeCloseTo(1.2, 6);
    expect(s.evidence[0].metrics.brakingG95.value).toBeCloseTo(0.5, 6);
    expect(s.evidence[0].metrics.lateralG95.kind).toBe("observed");
    const d = cornerReview(s, [session], settings, "corner-1");
    expect(d.passes[0].forces.lateral.source).toBe("recorded");
    expect(d.passes[0].rows[10][2]).toBe(-0.5);
    expect(d.passes[0].rows[10][3]).toBe(1.2);
  });
  it("merges corner advice without removing the existing session debrief or earlier corners", () => {
    const s = fixture(),
      a = validateReport(report(s), s);
    a.debrief = {
      headline: "Session",
      assessment: "Assessment",
      findings: [],
      practicePlan: [],
    };
    const b = {
      ...a,
      cornerReviews: [
        {
          ...a.cornerReviews![0],
          cornerId: "corner-2",
          advice: "Second corner",
        },
      ],
      debrief: undefined,
    };
    const merged = mergeReviews(a, b);
    expect(merged.cornerReviews).toHaveLength(2);
    expect(merged.debrief?.headline).toBe("Session");
    expect(
      validateSettings({ ...emptySettings(), reports: [merged] }).reports[0]
        .cornerReviews,
    ).toHaveLength(2);
  });
  it("gates the new tool, rejects a misleading single-lap filter, and initializes a targeted all-three/G review", async () => {
    const s = fixture(),
      service = new AnalysisService(s, [], emptySettings());
    await expect(
      service.query("corner_review", {
        snapshotId: s.id,
        cornerId: "corner-1",
      }),
    ).rejects.toThrow();
    service.grant();
    await expect(
      service.query("corner_review", {
        snapshotId: s.id,
        cornerId: "corner-1",
        lapId: "lap-1",
      }),
    ).rejects.toThrow(/invalid_arguments/);
    const messages = await initialMessages(service, s, "mph", "corner-1");
    const data = JSON.parse(
      messages[1].content!.split("\n").slice(1).join("\n"),
    );
    expect(data.cornerReview.topThreeIds).toHaveLength(3);
    expect(data.displayUnits.acceleration).toBe("g");
    expect(data.sessionDebrief).toBeUndefined();
    expect(messages[0].content).toContain("EVERY available top-three");
    service.revoke();
    await expect(
      service.query("corner_review", {
        snapshotId: s.id,
        cornerId: "corner-1",
      }),
    ).rejects.toThrow();
  });
});
