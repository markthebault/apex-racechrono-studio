import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { trace, align } from "../analysis";
import type { Session, Channel } from "../model";
import {
  G,
  derivative,
  normalize,
  physicalCurvature,
  quality,
  median,
  quantile,
} from "./signals";
import { buildSnapshot, snapshotKey, detectCorners } from "./pipeline";
import {
  emptySettings,
  validateReport,
  validateSettings,
  type Mapping,
  type Report,
} from "./contracts";
import { AnalysisService, bounded } from "./service";
import { connect, type ModelContext } from "./webmcp";
import {
  corridor,
  validateBoundary,
  insideCorridor,
  type BoundaryAsset,
  type Point,
} from "./boundaries";
import { optimize, qp } from "./optimizer";
import { speedProfile } from "./speedProfile";
import {
  readEngineerCache,
  writeEngineerCache,
  work,
  createProject,
  readProject,
  removeSession,
  saveSession,
} from "../storage";
import { unzipSync, strFromU8 } from "fflate";
import loadHighs from "highs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
export function synthetic({
  id = "s",
  radius = 100,
  speed = 20,
  step = 100,
  duration = 40,
  straight = false,
}: {
  id?: string;
  radius?: number;
  speed?: number;
  step?: number;
  duration?: number;
  straight?: boolean;
} = {}): Session {
  const n = Math.round((duration * 1000) / step) + 1,
    times = Float64Array.from({ length: n }, (_, i) => i * step),
    lat = Float64Array.from(times, (t) =>
      straight
        ? 0
        : (Math.sin(((t / 1000) * speed) / radius) * radius) / 111195,
    ),
    lon = Float64Array.from(times, (t) =>
      straight
        ? ((t / 1000) * speed) / 111195
        : (Math.cos(((t / 1000) * speed) / radius) * radius) / 111195,
    );
  return {
    id,
    filename: "synthetic.rcz",
    size: 0,
    track: "Synthetic",
    trackId: 1,
    start: 0,
    end: duration * 1000,
    importedOptimal: 0,
    times,
    lat,
    lon,
    channels: [
      {
        id: "speed",
        name: "GPS speed",
        unit: "km/h",
        times,
        values: Float64Array.from(times, () => speed * 3.6),
        source: "synthetic",
      },
    ],
    laps: [
      { id: id + ":1", number: 1, start: 0, end: duration * 1000, issues: [] },
    ],
    unknown: [],
  };
}
export function circleAsset(n = 100): BoundaryAsset {
  const circle = (r: number): Point[] =>
    Array.from({ length: n }, (_, i) => [
      r * Math.cos((i * 2 * Math.PI) / n),
      r * Math.sin((i * 2 * Math.PI) / n),
    ]);
  return {
    format: "apex-boundaries",
    version: 1,
    layoutId: "1",
    direction: "counterclockwise",
    topology: "closed",
    coordinates: "local-metric-xy",
    units: "m",
    origin: [0, 0],
    spine: circle(100),
    left: circle(94),
    right: circle(106),
    source: "Synthetic circles",
    date: "2026-01-01",
    accuracyM: 0,
    license: "CC0",
    redistribution: "permitted",
    permittedUse: true,
  };
}
const input = () => {
  const s = synthetic();
  return {
    sessions: [s],
    referenceId: s.laps[0].id,
    lapIds: [s.laps[0].id],
    settings: emptySettings(),
  };
};
describe("engineering signal contracts", () => {
  it("uses interpolated quantiles so small lap sets do not hide spread or mislabel the median", () => {
    expect(median([14, 16])).toBe(15);
    expect(quantile([14, 14.1, 16.4], 0.9)).toBeCloseTo(15.94);
    expect(
      quantile([14, 14.1, 16.4], 0.9) - quantile([14, 14.1, 16.4], 0.1),
    ).toBeCloseTo(1.92);
    expect(quantile([], 0.5)).toBeNaN();
  });
  it("normalizes units, preserves raw values, distinguishes throttle from accelerator and rejects unknown units", () => {
    const s = synthetic();
    s.channels.push({
      ...s.channels[0],
      id: "zero",
      unit: "raw",
      values: Float64Array.from(s.times, () => 0),
    });
    const mappings: Mapping[] = [
      {
        channel: "zero",
        semantic: "brakePressure",
        unit: "kPa",
        scale: 2,
        offset: 0,
        confirmed: true,
      },
      {
        channel: "zero",
        semantic: "lateral",
        unit: "unknown",
        scale: 1,
        offset: 0,
        confirmed: true,
      },
    ];
    const signals = normalize(s, mappings);
    expect(
      signals.find((s) => s.semantic === "speed")!.channel.values[0],
    ).toBeCloseTo(20);
    expect(
      signals.find((s) => s.semantic === "brakePressure")!.channel.values[0],
    ).toBe(0);
    expect(
      signals.some(
        (s) => s.semantic === "accelerator" || s.semantic === "lateral",
      ),
    ).toBe(false);
    expect(s.channels[0].values[0]).toBe(72);
    mappings[1].unit = "g";
    mappings[1].offset = 1;
    expect(
      normalize(s, mappings).find((s) => s.semantic === "lateral")!.channel
        .values[0],
    ).toBeCloseTo(G);
  });
  it.each([50, 100, 200])(
    "derives a known native braking ramp at %i ms without edge artifacts",
    (step) => {
      const s = synthetic({ step, straight: true }),
        c = {
          ...s.channels[0],
          unit: "m/s",
          values: Float64Array.from(s.times, (t) => 40 - (0.5 * t) / 1000),
        },
        d = derivative(c);
      expect(d.values[0]).toBeNaN();
      expect(d.values[20]).toBeCloseTo(-0.5, 8);
    },
  );
  it("abstains for low sampling rates and gaps", () => {
    const s = synthetic({ step: 1000 }),
      d = derivative(s.channels[0]);
    expect(d.values.every(Number.isNaN)).toBe(true);
    const c = synthetic().channels[0];
    c.times = c.times.slice();
    for (let i = 100; i < c.times.length; i++) c.times[i] += 3000;
    expect(quality(c).gaps).toBe(1);
    expect(derivative(c).values[99]).toBeNaN();
  });
  it("uses physical arc length for curvature, invariant to alignment", () => {
    const s = synthetic(),
      t = trace(s, s.laps[0]),
      k = physicalCurvature(t);
    expect(k[100]).toBeCloseTo(0.01, 4);
    expect(20 * 20 * k[100]).toBeCloseTo(4, 2);
    const ref = synthetic({ id: "ref", radius: 105 });
    const a = align(t, trace(ref, ref.laps[0]));
    expect(a.rawDistance).toEqual(t.rawDistance);
    expect(physicalCurvature(a)[100]).toBe(k[100]);
    const straight = synthetic({ straight: true });
    expect(
      physicalCurvature(trace(straight, straight.laps[0]))[100],
    ).toBeCloseTo(0, 8);
  });
});
describe("snapshots, evidence and access controls", () => {
  it("bounds connected turning regions without presenting distance windows as individual corners", () => {
    const s = synthetic({ duration: 200 });
    const ref = trace(s, s.laps[0]);
    const windows = detectCorners(ref, physicalCurvature(ref));
    expect(windows.length).toBeGreaterThan(5);
    for (const [i, w] of windows.entries()) {
      expect(w.end - w.start).toBeLessThanOrEqual(400.000001);
      expect(w.name).toMatch(/^Review window /);
      if (i) expect(w.start).toBeGreaterThanOrEqual(windows[i - 1].end);
    }
  });
  it("keeps unverified other recordings out of coaching and envelope pooling while preserving their measurements", async () => {
    const i = input();
    const other = synthetic({ id: "other" });
    i.sessions.push(other);
    i.lapIds.push(other.laps[0].id);
    const unverified = await buildSnapshot(i);
    expect(
      unverified.laps.find((l) => l.sessionId === "other")?.coachingEligible,
    ).toBe(false);
    expect(
      unverified.evidence
        .filter((e) => e.sessionId === "other")
        .every((e) => e.quality.some((q) => q.includes("Cross-recording"))),
    ).toBe(true);
    expect(
      unverified.evidence.find((e) => e.sessionId === "other")?.metrics.elapsed
        .value,
    ).not.toBeNull();
    expect(unverified.priorities).toEqual([]);
    const known = {
      vehicle: "test car",
      setup: "standard",
      tires: "test tires",
      conditions: "dry" as const,
      notes: "",
    };
    i.settings.contexts.s = known;
    i.settings.contexts.other = known;
    const verified = await buildSnapshot(i);
    expect(verified.laps.every((l) => l.coachingEligible)).toBe(true);
    expect(
      verified.evidence.every(
        (e) => !e.quality.some((q) => q.includes("Cross-recording")),
      ),
    ).toBe(true);
  });
  it("produces a GPS-only review with no invented measured pedal metrics or gain", async () => {
    const s = await buildSnapshot(input());
    expect(s.corners.length).toBeGreaterThan(0);
    expect(s.evidence.length).toBeGreaterThan(0);
    expect(s.priorities).toEqual([]);
    expect(s.evidence[0].metrics.brakePeak).toBeUndefined();
    expect(s.modeled.status).toBe("unavailable");
    expect(s.envelope.bins.every((b) => b.acceleration === null)).toBe(true);
  });
  it("preserves an all-zero verified brake measurement instead of claiming pedal action", async () => {
    const i = input(),
      s = i.sessions[0];
    s.channels.push({
      ...s.channels[0],
      id: "brake",
      values: new Float64Array(s.times.length),
    });
    i.settings.mappings.s = [
      {
        channel: "brake",
        semantic: "brakePressure",
        unit: "bar",
        scale: 1,
        offset: 0,
        confirmed: true,
      },
    ];
    const result = await buildSnapshot(i);
    expect(result.evidence[0].metrics.brakePeak.value).toBe(0);
    expect(result.evidence[0].metrics.brakeOnset.value).toBeNull();
  });
  it("ranks common non-overlapping windows and measures the actual delta", async () => {
    const a = synthetic({ duration: 40, speed: 20 }),
      b = synthetic({ id: "b", duration: 32, speed: 25 }),
      i = {
        sessions: [a, b],
        referenceId: "s:1",
        lapIds: ["s:1", "b:1"],
        settings: emptySettings(),
      };
    i.settings.corners["s:1"] = [
      { id: "c", name: "Test", start: 100, end: 500, direction: "left" },
    ];
    const context = {
      vehicle: "test car",
      setup: "standard",
      tires: "test tires",
      conditions: "dry" as const,
      notes: "",
    };
    i.settings.contexts.s = context;
    i.settings.contexts.b = context;
    const result = await buildSnapshot(i);
    expect(result.priorities).toHaveLength(1);
    expect(result.priorities[0].observedDeltaMs).toBeCloseTo(4000, 0);
    expect(result.priorities[0].potentialGainMs).toBeNull();
  });
  it("invalidates snapshot for mapping/context/lap edits but not reviewed reports", async () => {
    const i = input(),
      a = await snapshotKey(i);
    i.settings.contexts.s = {
      vehicle: "car",
      setup: "",
      tires: "",
      conditions: "unknown",
      notes: "",
    };
    expect(await snapshotKey(i)).not.toBe(a);
    const b = await snapshotKey(i);
    i.settings.reports.push({
      format: "apex-engineer-report",
      version: 1,
      snapshotId: "old",
      priorities: [],
    });
    expect(await snapshotKey(i)).toBe(b);
    i.sessions[0].laps[0].issues.push("Marked invalid");
    expect(await snapshotKey(i)).not.toBe(b);
  });
  it("keys paid review history to selected laps, added sessions, mappings and corner edits", async () => {
    const i = input();
    i.sessions.push(synthetic({ id: "second" }));
    i.lapIds.push("second:1");
    const key = await snapshotKey(i);
    const deselected = structuredClone(i);
    deselected.lapIds = [i.referenceId];
    expect(await snapshotKey(deselected)).not.toBe(key);
    const added = structuredClone(i);
    added.sessions.push(synthetic({ id: "added" }));
    added.lapIds.push("added:1");
    expect(await snapshotKey(added)).not.toBe(key);
    const mapped = structuredClone(i);
    mapped.settings.mappings.s = [
      {
        semantic: "speed",
        channel: "speed",
        unit: "m/s",
        scale: 1,
        offset: 0,
        confirmed: true,
      },
    ];
    expect(await snapshotKey(mapped)).not.toBe(key);
    const corners = structuredClone(i);
    corners.settings.corners[i.referenceId] = [
      { id: "edited", name: "Turn 1", start: 100, end: 250, direction: "left" },
    ];
    expect(await snapshotKey(corners)).not.toBe(key);
    const pooling = structuredClone(i);
    pooling.settings.crossDay = true;
    expect(await snapshotKey(pooling)).not.toBe(key);
  });
  it("rejects incompatible pooling and preserves lap flags", async () => {
    const i = input(),
      b = synthetic({ id: "b" });
    i.sessions.push(b);
    i.lapIds.push("b:1");
    i.settings.contexts.b = {
      vehicle: "other",
      setup: "",
      tires: "",
      conditions: "unknown",
      notes: "",
    };
    await expect(buildSnapshot(i)).rejects.toThrow("Contexts differ");
    expect(b.laps[0].issues).toEqual([]);
  });
  it("requires scoped consent, checks stale ids, bounds telemetry and revokes pending calls", async () => {
    const i = input(),
      s = await buildSnapshot(i),
      service = new AnalysisService(s, i.sessions, i.settings);
    await expect(
      service.query("summary", { snapshotId: s.id }),
    ).rejects.toThrow("not_approved");
    service.grant();
    expect(await service.query("summary", { snapshotId: s.id })).toHaveProperty(
      "snapshotId",
      s.id,
    );
    await expect(
      service.query("summary", { snapshotId: "old" }),
    ).rejects.toThrow("stale");
    await expect(
      service.query("comparison", {
        snapshotId: s.id,
        lapId: "unrelated",
        comparisonLapId: "s:1",
      }),
    ).rejects.toThrow("outside_scope");
    await expect(
      service.query("telemetry", {
        snapshotId: s.id,
        lapId: "s:1",
        channel: "speed",
        start: 10,
        end: 100,
        points: 1001,
      }),
    ).rejects.toThrow("resolution");
    const p = service.query("summary", { snapshotId: s.id });
    service.revoke();
    await expect(p).rejects.toThrow();
    service.grant();
    service.dispose();
    await expect(
      service.query("summary", { snapshotId: s.id }),
    ).rejects.toThrow("stale");
    expect(() => bounded({ text: "x".repeat(65537) })).toThrow("too_large");
  });
  it("returns bounded gap-aware normalized telemetry and no raw coordinates", async () => {
    const i = input(),
      s = await buildSnapshot(i),
      service = new AnalysisService(s, i.sessions, i.settings);
    service.grant();
    const result = (await service.query("telemetry", {
      snapshotId: s.id,
      lapId: "s:1",
      channel: "speed",
      start: 100,
      end: 200,
      points: 10,
    })) as any;
    expect(result.values).toHaveLength(10);
    expect(result.values[0].value).toBeCloseTo(20);
    expect(result.unit).toBe("m/s");
    expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|filename/);
  });
  it("validates evidence report references and does not trust imported consent", async () => {
    const s = await buildSnapshot(input());
    const r: Report = {
      format: "apex-engineer-report",
      version: 1,
      snapshotId: s.id,
      priorities: [
        {
          category: "telemetry-comparison",
          evidenceIds: [s.evidence[0].id],
          observation: "Measured",
          explanation: "Hypothesis",
          experiment: "Compare",
          limitations: "Unknown traffic",
        },
      ],
    };
    expect(validateReport(r, s)).toEqual(r);
    expect(() => validateReport({ ...r, snapshotId: "old" }, s)).toThrow(
      "Stale",
    );
    r.priorities[0].evidenceIds = ["foreign"];
    expect(() => validateReport(r, s)).toThrow("Unknown");
    const v = validateSettings({
      ...emptySettings(),
      sharing: true,
      boundary: { private: true },
    });
    expect(v).not.toHaveProperty("sharing");
    expect(v).not.toHaveProperty("boundary");
  });
  it("registers tools once, swaps scoped services and blocks after cleanup", async () => {
    const tools: any[] = [],
      context: ModelContext = {
        registerTool: (t) => {
          tools.push(t);
        },
      },
      i = input(),
      s = await buildSnapshot(i),
      service = new AnalysisService(s, i.sessions, i.settings);
    const stop = connect(context, service);
    await new Promise((r) => setTimeout(r, 0));
    expect(tools).toHaveLength(9);
    service.grant();
    const summary = tools.find((t) => t.name === "apex_summary");
    expect(await summary.execute({ snapshotId: s.id })).toHaveProperty(
      "snapshotId",
      s.id,
    );
    stop();
    expect(await summary.execute({ snapshotId: s.id })).toHaveProperty("error");
    const next = new AnalysisService(s, i.sessions, i.settings);
    connect(context, next);
    await Promise.resolve();
    expect(tools).toHaveLength(9);
  });
});
describe("licensed corridor and numerical models", () => {
  it("validates metric normal correspondence and checks segment interiors", async () => {
    const c = await corridor(circleAsset(), "1", 1.8, 0.5, 100);
    expect(c.lower.every((x) => x < 0)).toBe(true);
    expect(c.upper.every((x) => x > 0)).toBe(true);
    expect(insideCorridor(c.points, c)).toBe(true);
    expect(
      insideCorridor(
        c.points.map((p) => [p[0] * 2, p[1] * 2]),
        c,
      ),
    ).toBe(false);
  });
  it("rejects incorrect layout, crossed geometry, inadequate clearance and missing permission", async () => {
    expect(() => validateBoundary(circleAsset(), "other")).toThrow();
    const b = circleAsset();
    b.permittedUse = false;
    expect(() => validateBoundary(b, "1")).toThrow();
    await expect(corridor(circleAsset(), "1", 4, 5, 100)).rejects.toThrow(
      "narrow",
    );
    const c = circleAsset();
    c.left[4] = c.left[20];
    expect(() => validateBoundary(c, "1")).toThrow();
  });
  it("solves a convex curvature QP, validates actual containment and improves a circle", async () => {
    const c = await corridor(circleAsset(200), "1", 1.8, 0.5, 100);
    const model = qp(c);
    expect(model.hessian!.values.length).toBeLessThan(600);
    const highs = await loadHighs({
      wasmBinary: readFileSync(
        createRequire(import.meta.url).resolve("highs/runtime"),
      ),
    });
    const sanity = highs.createModel({
      numCols: 1,
      numRows: 0,
      colCost: [-4],
      colLower: [-10],
      colUpper: [10],
      rowLower: [],
      rowUpper: [],
      matrix: {
        format: "csc",
        numCols: 1,
        numRows: 0,
        starts: [0, 0],
        indices: [],
        values: [],
      },
      hessian: {
        format: "triangular",
        dimension: 1,
        starts: [0, 1],
        indices: [0],
        values: [2],
      },
    });
    try {
      sanity.options.set({ output_flag: false });
      sanity.run();
      expect(sanity.getSolution().colValue[0]).toBeCloseTo(2, 5);
    } finally {
      sanity.dispose();
    }
    const line = await optimize(c, highs);
    expect(line.diagnostics.objectiveAfter).toBeLessThan(
      line.diagnostics.objectiveBefore,
    );
    expect(insideCorridor(line.points, c)).toBe(true);
    const profile = speedProfile(line, {
      acceleration: 2,
      braking: 4,
      lateral: 4,
      maxSpeed: 50,
      source: "synthetic conservative",
    });
    expect(profile.speedMps[0]).toBeCloseTo(
      Math.sqrt(4 / Math.abs(line.curvature[0])),
      1,
    );
    const low = speedProfile(line, {
      acceleration: 2,
      braking: 4,
      lateral: 2,
      maxSpeed: 50,
      source: "lower grip",
    });
    expect(low.totalMs).toBeGreaterThan(profile.totalMs);
  }, 30000);
});
describe("persistence and worker cancellation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("never creates a worker for a pre-aborted signal", async () => {
    const Worker = vi.fn();
    vi.stubGlobal("Worker", Worker);
    const c = new AbortController();
    c.abort();
    await expect(work("engineer", {}, undefined, c.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(Worker).not.toHaveBeenCalled();
  });
  it("terminates an active worker and removes abort listeners", async () => {
    let instance: any;
    class FakeWorker {
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        instance = this;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const c = new AbortController(),
      remove = vi.spyOn(c.signal, "removeEventListener"),
      p = work("engineer", {}, undefined, c.signal);
    c.abort();
    await expect(p).rejects.toThrow("cancelled");
    expect(instance.terminate).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalled();
  });
  it("caches disposable analysis without touching source sessions", async () => {
    expect(await writeEngineerCache("test", { test: 1 }, ["synthetic"])).toBe(
      true,
    );
    expect(await readEngineerCache("test")).toEqual({ test: 1 });
  });
});

describe("open sections and linked corners", () => {
  it("keeps an open straight open, preserves endpoints, and honors explicit endpoint speeds", async () => {
    const b = circleAsset();
    b.topology = "open";
    b.spine = Array.from({ length: 21 }, (_, i) => [i * 10, 0]);
    b.left = b.spine.map((p) => [p[0], 6]);
    b.right = b.spine.map((p) => [p[0], -6]);
    const c = await corridor(b, "1", 1.8, 0.5, 21),
      highs = await loadHighs({
        wasmBinary: readFileSync(
          createRequire(import.meta.url).resolve("highs/runtime"),
        ),
      }),
      line = await optimize(c, highs);
    expect(line.closed).toBe(false);
    expect(line.points[0]).toEqual([0, 0]);
    expect(line.points.at(-1)).toEqual([200, 0]);
    expect(line.length).toBeCloseTo(200);
    expect(() =>
      speedProfile(line, {
        acceleration: 2,
        braking: 4,
        lateral: 4,
        maxSpeed: 50,
        source: "synthetic",
      }),
    ).toThrow("entry");
    const p = speedProfile(line, {
      acceleration: 2,
      braking: 4,
      lateral: 4,
      maxSpeed: 50,
      entrySpeed: 10,
      finishSpeed: 10,
      source: "synthetic",
    });
    expect(p.speedMps[0]).toBe(10);
    expect(p.speedMps.at(-1)).toBe(10);
    expect(p.cumulativeMs).toHaveLength(21);
    for (let i = 0; i < p.accelerationMps2.length; i++)
      expect(p.accelerationMps2[i]).toBeLessThanOrEqual(2.00001);
  });
  it("handles unequal/reversed edge sampling deterministically and rejects intersecting edges", async () => {
    const b = circleAsset(100),
      c = await corridor(b, "1", 1.8, 0.5, 50);
    const reversed = {
      ...b,
      left: [...b.left].reverse(),
      right: b.right.filter((_, i) => i % 2 === 0).reverse(),
    };
    const r = await corridor(reversed, "1", 1.8, 0.5, 50);
    expect(r.points).toEqual(c.points);
    expect(insideCorridor(r.points, r)).toBe(true);
    const invalid = circleAsset();
    invalid.right = invalid.right.map((p, i) => (i === 0 ? [90, 0] : p));
    expect(() => validateBoundary(invalid, "1")).toThrow("cross");
  });
  it("invalidates only the affected corner on a GPS outage", async () => {
    const i = input(),
      s = i.sessions[0];
    s.times = s.times.slice();
    for (let j = 100; j < s.times.length; j++) s.times[j] += 3000;
    s.channels = s.channels.map((c) => ({ ...c, times: s.times }));
    s.laps[0].end = s.times.at(-1)!;
    i.settings.corners["s:1"] = [
      { id: "first", name: "First", start: 30, end: 120, direction: "left" },
      { id: "gap", name: "Outage", start: 180, end: 300, direction: "left" },
    ];
    const result = await buildSnapshot(i);
    expect(result.evidence[0].quality).toEqual([]);
    expect(result.evidence[1].quality.join()).toMatch(/GPS gap/);
  });
  it("rejects an unknown report claim category even with valid evidence", async () => {
    const s = await buildSnapshot(input());
    expect(() =>
      validateReport(
        {
          format: "apex-engineer-report",
          version: 1,
          snapshotId: s.id,
          priorities: [
            {
              category: "measured-brake-release",
              evidenceIds: [s.evidence[0].id],
              observation: "x",
              explanation: "x",
              experiment: "x",
              limitations: "x",
            },
          ],
        },
        s,
      ),
    ).toThrow("Only evidence-linked");
  });
});

describe("release persistence and numerical checks", () => {
  it("round-trips engineer metadata in old-format project archives without permissions or boundaries", async () => {
    const session = synthetic({ id: "a".repeat(64) }),
      engineer = emptySettings();
    engineer.contexts[session.id] = {
      vehicle: "Synthetic vehicle",
      setup: "A",
      tires: "Example",
      conditions: "dry",
      notes: "Untrusted text <script>do not execute</script>",
    };
    engineer.reports = [
      {
        format: "apex-engineer-report",
        version: 1,
        snapshotId: "saved",
        sessionIds: [session.id],
        priorities: [],
        debrief: {
          headline: "Collect a baseline",
          assessment: "No supported recurring mistake yet.",
          findings: [],
          practicePlan: [],
        },
      },
    ];
    const settings: import("../model").Settings = {
      a: session.laps[0].id,
      b: "",
      speedUnit: "mph",
      colors: ["#ff0000", "#00ff00"],
      videoHeight: 280,
      charts: [],
      excluded: [],
      included: [],
      layouts: [],
      mode: "distance",
      mapHeight: 300,
      collection: [],
      engineer: {
        ...engineer,
        sharing: true,
        boundary: { raw: "restricted" },
      } as any,
    };
    const sync: import("../model").SyncFile = {
      format: "apex-sync",
      version: 1,
      bindings: [],
    };
    const blob = await createProject(settings, sync, [
        { session, file: new Blob(["synthetic"]) },
      ]),
      archive = unzipSync(new Uint8Array(await blob.arrayBuffer())),
      manifest = JSON.parse(strFromU8(archive["project.json"]));
    expect(manifest.version).toBe(1);
    expect(manifest.settings.engineer).not.toHaveProperty("sharing");
    expect(manifest.settings.engineer).not.toHaveProperty("boundary");
    const project = await readProject(
      new File([blob], "synthetic.apex.zip"),
      async () => session,
    );
    expect(project.manifest.settings.engineer.contexts).toEqual(
      engineer.contexts,
    );
    expect(project.manifest.settings.engineer.reports).toEqual(
      engineer.reports,
    );
    await saveSession(session, new Blob(["synthetic"]));
    await writeEngineerCache("owned", { derived: true }, [session.id]);
    await writeEngineerCache("shared-geometry", { shared: true }, []);
    const removed = await removeSession(session, settings, sync);
    expect(removed.settings.engineer!.contexts).not.toHaveProperty(session.id);
    expect(removed.settings.engineer!.reports).toEqual([]);
    expect(await readEngineerCache("owned")).toBeUndefined();
    expect(await readEngineerCache("shared-geometry")).toEqual({
      shared: true,
    });
  });
  it("cleans up a timed-out worker and rejects late results", async () => {
    vi.useFakeTimers();
    let instance: any;
    class FakeWorker {
      terminate = vi.fn();
      postMessage = vi.fn();
      onmessage: any;
      constructor() {
        instance = this;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    try {
      const p = work("engineer", {}),
        result = p.catch((e) => e.message);
      await vi.advanceTimersByTimeAsync(120000);
      expect(await result).toMatch("timed out");
      expect(instance.terminate).toHaveBeenCalledOnce();
      instance.onmessage({ data: { result: "late" } });
      expect(instance.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it.skipIf(!process.env.APEX_BENCHMARK)(
    "records 250/1000/4000-node WASM benchmarks with bounded solve time",
    async () => {
      const { writeFileSync, mkdirSync } = await import("node:fs"),
        os = await import("node:os"),
        highs = await loadHighs({
          wasmBinary: readFileSync(
            createRequire(import.meta.url).resolve("highs/runtime"),
          ),
        }),
        results: unknown[] = [];
      for (const nodes of [250, 1000, 4000]) {
        const started = performance.now(),
          before = process.memoryUsage();
        try {
          const c = await corridor(circleAsset(500), "1", 1.8, 0.5, nodes),
            line = await optimize(c, highs);
          results.push({
            nodes,
            status: "available",
            elapsedMs: performance.now() - started,
            diagnostics: line.diagnostics,
            memoryBefore: before,
            memoryAfter: process.memoryUsage(),
          });
        } catch (e) {
          results.push({
            nodes,
            status: "unavailable",
            reason: (e as Error).message,
            elapsedMs: performance.now() - started,
            memoryBefore: before,
            memoryAfter: process.memoryUsage(),
          });
        }
      }
      if (process.env.APEX_EVIDENCE) {
        mkdirSync(process.env.APEX_EVIDENCE, { recursive: true });
        writeFileSync(
          joinForEvidence(
            process.env.APEX_EVIDENCE,
            "stage1-solver-benchmark.json",
          ),
          JSON.stringify(
            {
              runtime: process.version,
              platform: os.platform(),
              arch: os.arch(),
              cpu: os.cpus()[0]?.model,
              wasmBytes: readFileSync(
                createRequire(import.meta.url).resolve("highs/runtime"),
              ).length,
              results,
            },
            null,
            2,
          ),
        );
      }
      expect(results).toHaveLength(3);
    },
    120000,
  );
});
function joinForEvidence(directory: string, file: string) {
  return directory.replace(/\/$/, "") + "/" + file;
}

describe("synthetic boundary shapes", () => {
  function around(spine: Point[]): BoundaryAsset {
    const offset = (amount: number): Point[] =>
      spine.map((p, i) => {
        const a = spine[Math.max(0, i - 1)],
          b = spine[Math.min(spine.length - 1, i + 1)],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          norm = Math.hypot(dx, dy);
        return [p[0] - (dy / norm) * amount, p[1] + (dx / norm) * amount];
      });
    return {
      ...circleAsset(),
      topology: "open",
      spine,
      left: offset(6),
      right: offset(-6),
    };
  }
  it.each(["hairpin", "chicane"])(
    "normalizes and solves a %s corridor",
    async (shape) => {
      const spine: Point[] =
        shape === "chicane"
          ? Array.from({ length: 101 }, (_, i) => [
              i * 4,
              15 *
                Math.sin((i / 100) * 4 * Math.PI) *
                Math.sin((i / 100) * Math.PI),
            ])
          : [
              ...Array.from({ length: 20 }, (_, i) => [i * 5, 0] as Point),
              ...Array.from({ length: 41 }, (_, i) => {
                const angle = -Math.PI / 2 + (i * Math.PI) / 40;
                return [
                  100 + 50 * Math.cos(angle),
                  50 + 50 * Math.sin(angle),
                ] as Point;
              }),
              ...Array.from(
                { length: 20 },
                (_, i) => [95 - i * 5, 100] as Point,
              ),
            ];
      const c = await corridor(around(spine), "1", 1.8, 0.5, 100),
        runtime = await loadHighs({
          wasmBinary: readFileSync(
            createRequire(import.meta.url).resolve("highs/runtime"),
          ),
        });
      expect(insideCorridor(c.points, c)).toBe(true);
      const result = await optimize(c, runtime);
      expect(result.diagnostics.objectiveAfter).toBeLessThanOrEqual(
        result.diagnostics.objectiveBefore + 1e-10,
      );
      expect(insideCorridor(result.points, c)).toBe(true);
    },
    30000,
  );
});

describe("optional CAN and conservative modeling gates", () => {
  it("uses the native high-rate pressure timeline and keeps throttle angle distinct from accelerator", async () => {
    const i = input(),
      s = i.sessions[0],
      times = Float64Array.from({ length: 2001 }, (_, j) => j * 20),
      values = Float64Array.from(times, (t) =>
        t < 1000 || t > 3000 ? 0 : t < 2000 ? (t - 1000) / 10 : (3000 - t) / 10,
      );
    s.channels.push(
      {
        id: "pressure",
        name: "Verified pressure",
        unit: "bar",
        times,
        values,
        source: "synthetic pressure",
      },
      {
        ...s.channels[0],
        id: "throttle",
        unit: "%",
        values: Float64Array.from(s.times, () => 50),
      },
    );
    i.settings.mappings.s = [
      {
        channel: "pressure",
        semantic: "brakePressure",
        unit: "bar",
        scale: 1,
        offset: 0,
        confirmed: true,
      },
    ];
    i.settings.corners["s:1"] = [
      { id: "turn", name: "Turn", start: 10, end: 180, direction: "left" },
    ];
    const snapshot = await buildSnapshot(i),
      metrics = snapshot.evidence[0].metrics;
    expect(metrics.brakePeak.value).toBeGreaterThan(70);
    expect(metrics.brakeReleaseDuration.value).toBeGreaterThan(700);
    expect(metrics.brakeReleaseDuration.value).toBeLessThan(1000);
    expect(metrics.brakeTurningOverlap.value).toBeGreaterThan(1500);
    expect(metrics.acceleratorPeak).toBeUndefined();
    expect(metrics.throttleAnglePeak.value).toBe(50);
  });
  it("keeps wheel identities and refuses unknown wheel units", () => {
    const s = synthetic();
    const maps: Mapping[] = (
      ["wheelFL", "wheelFR", "wheelRL", "wheelRR"] as const
    ).map((semantic, j) => {
      s.channels.push({ ...s.channels[0], id: `w${j}` });
      return {
        channel: `w${j}`,
        semantic,
        unit: j === 3 ? "unknown" : "km/h",
        scale: 1,
        offset: 0,
        confirmed: true,
      };
    });
    const mapped = normalize(s, maps);
    expect(
      mapped
        .filter((s) => s.semantic.startsWith("wheel"))
        .map((s) => s.semantic),
    ).toEqual(["wheelFL", "wheelFR", "wheelRL"]);
  });
  it("applies declared local reductions and exposes active constraints without faster results", async () => {
    const runtime = await loadHighs({
        wasmBinary: readFileSync(
          createRequire(import.meta.url).resolve("highs/runtime"),
        ),
      }),
      line = await optimize(
        await corridor(circleAsset(100), "1", 1.8, 0.5, 100),
        runtime,
      ),
      limits = {
        acceleration: 2,
        braking: 4,
        lateral: 4,
        maxSpeed: 50,
        source: "synthetic conservative",
      },
      baseline = speedProfile(line, limits),
      reduced = speedProfile(line, {
        ...limits,
        reductions: [{ startM: 0, endM: line.length, factor: 0.5 }],
      });
    expect(reduced.totalMs).toBeGreaterThan(baseline.totalMs);
    expect(
      reduced.activeConstraints.every((a) => a.includes("local reduction")),
    ).toBe(true);
    expect(() =>
      speedProfile(line, {
        ...limits,
        reductions: [{ startM: 0, endM: line.length, factor: 2 }],
      }),
    ).toThrow("reductions");
  });
  it("does not silently extrapolate incomplete envelope axes", async () => {
    const { limitsFromEnvelope } = await import("./speedProfile");
    const snapshot = await buildSnapshot(input());
    expect(limitsFromEnvelope(snapshot.envelope)).toBeUndefined();
  });
});

describe("cache failure isolation", () => {
  it("keeps the source session when a disposable cache write hits quota", async () => {
    const { load } = await import("../storage"),
      session = synthetic({ id: "quota-source" });
    await saveSession(session, new Blob(["source"]));
    const original = IDBObjectStore.prototype.put,
      spy = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementation(function (
          this: IDBObjectStore,
          value: unknown,
          key?: IDBValidKey,
        ) {
          if (typeof key === "string" && key.startsWith("engineer-cache:"))
            throw new DOMException("Synthetic quota", "QuotaExceededError");
          return original.call(this, value, key);
        });
    try {
      expect(
        await writeEngineerCache("quota", { derived: true }, [session.id]),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(
      (await load()).records.some((r) => r.session.id === session.id),
    ).toBe(true);
  });
});
