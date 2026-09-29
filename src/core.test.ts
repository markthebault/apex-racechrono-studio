import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { decode } from "./decoder";
import {
  trace,
  align,
  optimal,
  interpolate,
  blocksOptimal,
  isBraking,
  bearing,
  elapsedDelta,
  nearestOnTrace,
  stepCursor,
  opportunities,
  optimalWith,
  STEP_MS,
  SHIFT_STEP_FACTOR,
  BRAKE_G,
} from "./analysis";
import type { Trace, Session } from "./model";
import {
  groupSessions,
  toggleSessions,
  onlySessions,
  selectionState,
  isSelected,
  opportunityScope,
} from "./groups";
import { summarize, formatGap } from "./summary";
import { classifyFile, describeImport } from "./files";
import { hoverBus } from "./hover";
import { readCreationTime, matchVideoStart } from "./mp4";
import { parseLapTime } from "./model";
import { lapStatus, explainIssue, canInclude, STATUS_LABEL } from "./lapStatus";
import { validateSync, videoTime, stampAtVideo } from "./storage";
import { formatWallClock, parseWallClock } from "./wallclock";
// Real recordings are private and are not in the repository. Set APEX_FIXTURES to a
// folder that holds them under these names to run the tests that need them. Without
// it those tests are skipped.
const FIXTURES = {
  morning: "session_20260927_075844_nordschleife_btg.rcz",
  midday: "session_20260927_094024_nordschleife_btg.rcz",
  afternoon: "session_20260927_134035_nordschleife_btg.rcz",
};
const fixtureDir = process.env.APEX_FIXTURES ?? "";
const fixture = (name: string) => join(fixtureDir, name);
const haveFixtures =
  !!fixtureDir && Object.values(FIXTURES).every((n) => existsSync(fixture(n)));
const paths = [fixture(FIXTURES.morning), fixture(FIXTURES.afternoon)];
const sessions = haveFixtures
  ? paths.map((p, i) => {
      const bytes = readFileSync(p);
      return decode(
        bytes,
        `session${i}.rcz`,
        createHash("sha256").update(bytes).digest("hex"),
      );
    })
  : [];
describe("archive validation", () => {
  it("rejects corrupt archives", () => {
    expect(() => decode(new Uint8Array([1, 2, 3]), "bad", "x")).toThrow();
  });
});
describe.skipIf(!haveFixtures)("real RaceChrono recordings", () => {
  it("preserves samples and exact lap times", () => {
    expect(sessions.map((s) => s.times.length)).toEqual([64562, 183615]);
    expect(sessions.map((s) => s.laps.map((l) => l.end - l.start))).toEqual([
      [571603, 551502, 587855],
      [622227, 5648218, 539516, 577519],
    ]);
  });
  it("decodes GPS and OBD in physical units", () => {
    const s = sessions[0];
    expect(s.lat[0]).toBeCloseTo(50.34727967);
    expect(s.lon[0]).toBeCloseTo(6.96589017);
    const max = (id: string) =>
      Math.max(...s.channels.find((c) => c.id === id)!.values);
    expect(max("rpm")).toBe(7329.5);
    expect(max("throttle")).toBeCloseTo(90.196078);
    expect(max("coolant")).toBe(106);
    expect(max("speed")).toBeCloseTo(203.3604);
  });
  it("flags the interrupted afternoon lap", () => {
    expect(sessions[1].laps[1].issues).toContain(
      "Interrupted lap: unusually long duration",
    );
    expect(sessions[1].laps[2].issues).toContain(
      "GPS gap longer than 2 seconds",
    );
  });
  it("aligns clean laps and preserves sector provenance", () => {
    const ref = trace(sessions[1], sessions[1].laps[3]);
    const t = align(trace(sessions[0], sessions[0].laps[0]), ref);
    expect(t.issues).toEqual([]);
    expect(t.distance[0]).toBe(0);
    expect(t.distance.at(-1)).toBe(ref.length);
    const gates = Array.from({ length: 20 }, (_, i) => (ref.length * i) / 19);
    const sectors = optimal([ref, t], gates);
    expect(sectors).toHaveLength(19);
    expect(sectors.reduce((n, s) => n + s.time, 0)).toBeLessThanOrEqual(571603);
    expect(sectors.every((s) => [ref.id, t.id].includes(s.source.id))).toBe(
      true,
    );
    console.log(
      "Reference distance",
      ref.length,
      "combined optimal",
      sectors.reduce((n, s) => n + s.time, 0),
    );
  });
  it("rejects incompatible gates", () => {
    const ref = trace(sessions[0], sessions[0].laps[0]);
    const other = {
      ...ref,
      id: "other",
      lat: Float64Array.from(ref.lat, (v) => v + 1),
    };
    expect(align(other, ref).issues).toContain(
      "Incompatible start or finish gates",
    );
  });
});
describe("interpolation", () => {
  it("never fills long time gaps", () => {
    expect(interpolate([0, 100, 10000], [0, 10, 20], 500, 2000)).toBeNaN();
    expect(interpolate([0, 100], [0, 10], 50)).toBe(5);
    expect(interpolate([0, 100], [0, 10], 200)).toBeNaN();
  });
});
describe("portable sync", () => {
  const identity = { sha256: "a".repeat(64), name: "session.rcz", size: 10 };
  const binding = {
    session: identity,
    clips: [{ ...identity, name: "video.mp4", duration: 100, start: 0 }],
    anchors: [
      { videoSeconds: 10, sessionTimestamp: 1000000 },
      { videoSeconds: 70, sessionTimestamp: 1061000 },
    ],
  };
  it("roundtrips without binary data and corrects drift", () => {
    const v = validateSync(
      JSON.parse(
        JSON.stringify({
          format: "apex-sync",
          version: 1,
          bindings: [binding],
        }),
      ),
    );
    expect(videoTime(v.bindings[0], 1030500)).toBe(40);
    expect(v.bindings[0].session.sha256).toBe(identity.sha256);
  });
  it("rejects malformed hashes and backwards anchors", () => {
    expect(() =>
      validateSync({
        format: "apex-sync",
        version: 1,
        bindings: [{ ...binding, session: { ...identity, sha256: "bad" } }],
      }),
    ).toThrow();
    expect(() =>
      validateSync({
        format: "apex-sync",
        version: 1,
        bindings: [
          { ...binding, anchors: [binding.anchors[1], binding.anchors[0]] },
        ],
      }),
    ).toThrow();
  });
  it("rejects overlapping clips", () => {
    expect(() =>
      validateSync({
        format: "apex-sync",
        version: 1,
        bindings: [
          {
            ...binding,
            clips: [...binding.clips, { ...binding.clips[0], start: 50 }],
          },
        ],
      }),
    ).toThrow();
  });
});

describe("gap and sector integrity", () => {
  it("keeps every sector unavailable when no eligible laps exist", () => {
    expect(optimal([], [0, 100, 200])).toEqual([]);
  });
  it.skipIf(!haveFixtures)(
    "does not count a sector spanning a recording outage",
    () => {
      const ref = trace(sessions[0], sessions[0].laps[1]);
      const sectors = optimal([ref], [0, ref.length]);
      expect(sectors).toEqual([]);
    },
  );
  it.skipIf(!haveFixtures)(
    "preserves the exact total when dividing one clean lap",
    () => {
      const t = trace(sessions[0], sessions[0].laps[0]);
      const gates = Array.from({ length: 20 }, (_, i) => (t.length * i) / 19);
      expect(
        optimal([t], gates).reduce((total, s) => total + s.time, 0),
      ).toBeCloseTo(t.lap.end - t.lap.start, 5);
    },
  );
  it("strips nonportable properties from imported synchronization metadata", () => {
    const v = validateSync({
      format: "apex-sync",
      version: 1,
      localPath: "/private",
      bindings: [
        {
          session: {
            sha256: "a".repeat(64),
            name: "s.rcz",
            size: 1,
            path: "/private",
          },
          clips: [],
          anchors: [],
          objectUrl: "blob:private",
        },
      ],
    });
    expect(JSON.stringify(v)).not.toContain("private");
  });
});

describe("saved projects and cursor gaps", () => {
  it.skipIf(!haveFixtures)(
    "does not interpolate cursor values through an outage",
    async () => {
      const { atDistance } = await import("./analysis");
      const t = trace(sessions[0], sessions[0].laps[1]);
      const i = Array.from(t.times).findIndex(
        (time, i) => i > 0 && time - t.times[i - 1] > 2000,
      );
      expect(i).toBeGreaterThan(0);
      expect(
        atDistance(
          t,
          t.channels.speed,
          (t.distance[i] + t.distance[i - 1]) / 2,
        ),
      ).toBeNaN();
    },
  );
  it.skipIf(!haveFixtures)(
    "stores duplicate session hashes only once",
    async () => {
      const { saveSession, load } = await import("./storage");
      const file = new Blob([readFileSync(paths[0])]);
      await saveSession(sessions[0], file);
      await saveSession(sessions[0], file);
      expect((await load()).records).toHaveLength(1);
    },
  );
  it.skipIf(!haveFixtures)(
    "restores sessions, settings and sync in one transaction",
    async () => {
      const { commitProject, load } = await import("./storage");
      const settings = {
        a: sessions[0].laps[0].id,
        b: "",
        charts: [],
        excluded: [],
        included: [],
        layouts: [],
        mode: "distance" as const,
        mapHeight: 340,
        collection: [],
        speedUnit: "km/h" as const,
        colors: ["#63e5d2", "#f8a36b"] as [string, string],
        videoHeight: 280,
      };
      await commitProject(
        sessions.map((session, i) => ({
          session,
          file: new Blob([readFileSync(paths[i])]),
        })),
        settings,
        { format: "apex-sync", version: 1, bindings: [] },
      );
      const d = await load();
      expect(d.records).toHaveLength(2);
      expect(d.settings?.a).toBe(settings.a);
      expect(d.sync?.version).toBe(1);
    },
  );
  it("rejects invalid project settings before restoring", async () => {
    const { validateSettings } = await import("./storage");
    expect(() =>
      validateSettings({
        a: "",
        b: "",
        mode: "distance",
        excluded: [],
        included: [],
        collection: [],
        charts: [{ id: "x", channels: ["speed"], height: -1 }],
        layouts: [],
        mapHeight: 340,
      }),
    ).toThrow("Invalid saved charts");
  });
});

describe("optimal lap eligibility", () => {
  it("keeps outage and interrupted laps, but not unreviewed problems", () => {
    expect(blocksOptimal([])).toBe(false);
    expect(blocksOptimal(["GPS gap longer than 2 seconds"])).toBe(false);
    expect(
      blocksOptimal([
        "Interrupted lap: unusually long duration",
        "GPS gap longer than 2 seconds",
      ]),
    ).toBe(false);
    expect(blocksOptimal(["Marked invalid by RaceChrono"])).toBe(true);
    expect(blocksOptimal(["Incomplete GPS coverage"])).toBe(true);
    expect(
      blocksOptimal([
        "GPS gap longer than 2 seconds",
        "Ambiguous GPS alignment",
      ]),
    ).toBe(true);
  });
});

describe("delta and map picking", () => {
  const mk = (id: string, start: number, seconds: number[]): Trace => ({
    id,
    sessionId: id,
    label: id,
    lap: { id, number: 1, start, end: start + seconds[4] * 1000, issues: [] },
    distance: Float64Array.from([0, 100, 200, 300, 400]),
    times: Float64Array.from(seconds.map((x) => start + x * 1000)),
    lat: Float64Array.from([50, 50.001, 50.002, 50.003, 50.004]),
    lon: Float64Array.from([7, 7, 7, 7, 7]),
    channels: {},
    length: 400,
    issues: [],
  });
  it("is A minus B in elapsed time, independent of clock offsets", () => {
    const a = mk("a", 1_000_000, [0, 5, 10, 15, 20]),
      b = mk("b", 50_000, [0, 4, 9, 13, 18]);
    expect(elapsedDelta(a, b, 0)).toBe(0);
    expect(elapsedDelta(a, b, 100)).toBe(1000);
    expect(elapsedDelta(a, b, 150)).toBe(1000);
    expect(elapsedDelta(a, b, 400)).toBe(2000);
    expect(elapsedDelta(b, a, 400)).toBe(-2000);
    expect(elapsedDelta(a, b, 500)).toBeNaN();
  });
  it("finds the nearest sample and respects the visible range", () => {
    const t = mk("t", 0, [0, 5, 10, 15, 20]);
    expect(nearestOnTrace(t, 50.0021, 7.00001)?.distance).toBe(200);
    expect(nearestOnTrace(t, 50.0021, 7.00001, [250, 400])?.distance).toBe(300);
    expect(nearestOnTrace(t, 50, 7, [1000, 2000])).toBeUndefined();
  });
});

describe("keyboard stepping", () => {
  // 10 m/s for 10 s, then stopped for 10 s, then 20 m/s for 5 s.
  const t = {
    id: "t",
    sessionId: "t",
    label: "t",
    lap: { id: "t", number: 1, start: 5000, end: 30000, issues: [] },
    distance: Float64Array.from([0, 100, 100, 200]),
    times: Float64Array.from([5000, 15000, 25000, 30000]),
    lat: new Float64Array(4),
    lon: new Float64Array(4),
    channels: {},
    length: 200,
    issues: [],
  } as Trace;
  it("moves by elapsed time, not distance", () => {
    expect(STEP_MS).toBe(200);
    expect(SHIFT_STEP_FACTOR).toBe(10);
    expect(stepCursor(t, 0, STEP_MS)).toBeCloseTo(2, 6);
    expect(stepCursor(t, 50, -STEP_MS)).toBeCloseTo(48, 6);
    expect(stepCursor(t, 150, STEP_MS)).toBeCloseTo(154, 6);
    expect(stepCursor(t, 0, STEP_MS * SHIFT_STEP_FACTOR)).toBeCloseTo(20, 6);
  });
  it("stays put while the car is stopped and never leaves the lap or the range", () => {
    expect(stepCursor(t, 100, STEP_MS)).toBeCloseTo(100, 6);
    expect(stepCursor(t, 0, -STEP_MS)).toBe(0);
    expect(stepCursor(t, 190, 60000)).toBe(200);
    expect(stepCursor(t, 60, 60000, [0, 90])).toBe(90);
    expect(stepCursor(t, 60, -60000, [40, 90])).toBe(40);
    expect(stepCursor(t, NaN, STEP_MS)).toBeNaN();
  });
});

describe("braking and heading", () => {
  const t = (accel: number[]): Trace => ({
    id: "t",
    sessionId: "t",
    label: "t",
    lap: { id: "t", number: 1, start: 0, end: 4000, issues: [] },
    distance: Float64Array.from([0, 100, 200, 300, 400]),
    times: Float64Array.from([0, 1000, 2000, 3000, 4000]),
    lat: Float64Array.from([50, 50.001, 50.002, 50.002, 50.002]),
    lon: Float64Array.from([7, 7, 7, 7.001, 7.002]),
    channels: { acceleration: Float64Array.from(accel) },
    length: 400,
    issues: [],
  });
  it("marks braking at the threshold and below, not above", () => {
    const x = t([0.3, BRAKE_G, -0.5, -0.19, NaN]);
    expect(isBraking(x, 0)).toBe(false);
    expect(isBraking(x, 100)).toBe(true);
    expect(isBraking(x, 200)).toBe(true);
    expect(isBraking(x, 300)).toBe(false);
    expect(isBraking(x, 400)).toBe(false);
    expect(isBraking({ ...x, channels: {} }, 100)).toBe(false);
  });
  it("points north, then east", () => {
    const x = t([0, 0, 0, 0, 0]);
    expect(bearing(x, 50)).toBeCloseTo(0, 0);
    expect(bearing(x, 350)).toBeCloseTo(90, 0);
    expect(bearing(x, 250)).toBeGreaterThan(0);
  });
});

const day = [FIXTURES.morning, FIXTURES.midday, FIXTURES.afternoon].map(
  fixture,
);
describe("track day, three sessions", () => {
  if (!haveFixtures) {
    it.skip("needs APEX_FIXTURES, see the comment at the top of this file");
    return;
  }
  const all = day.map((p, i) => {
    const bytes = readFileSync(p);
    return decode(bytes, `day${i}.rcz`, `day${i}`);
  });
  const raw = all.flatMap((s) => s.laps.map((l) => trace(s, l)));
  const ref = raw
    .filter((t) => !t.issues.length)
    .sort((a, b) => a.lap.end - a.lap.start - (b.lap.end - b.lap.start))[0];
  const traces = raw.map((t) => align(t, ref));
  const usable = traces.filter(
    (t) =>
      !t.issues.some(
        (i) => i.includes("Incompatible") || i.includes("Ambiguous"),
      ) && !blocksOptimal(t.issues),
  );
  const gates = Array.from({ length: 20 }, (_, i) => (ref.length * i) / 19);
  const sectors = optimal(usable, gates);
  const total = sectors.reduce((n, s) => n + s.time, 0);
  it("uses all eleven laps, including the red-flag lap", () => {
    expect(usable).toHaveLength(11);
    expect(usable.some((t) => t.lap.end - t.lap.start > 90 * 60000)).toBe(true);
  });
  it("finds a complete theoretical lap well below the best recorded lap", () => {
    expect(sectors).toHaveLength(19);
    const best = Math.min(...usable.map((t) => t.lap.end - t.lap.start));
    expect(best).toBe(539516);
    expect(total).toBeLessThan(best - 15000);
    expect(total).toBeGreaterThan(8 * 60000 + 35000);
    expect(total).toBeLessThan(8 * 60000 + 41000);
    console.log("Track-day theoretical lap, 19 sectors:", total);
  });
  it("ends the cumulative delta at the difference of the lap times", () => {
    const a = traces.find((t) => t.id === "day1:4")!,
      b = traces.find((t) => t.id === "day2:1")!;
    expect(elapsedDelta(a, b, ref.length) / 1000).toBeCloseTo(
      (a.lap.end - a.lap.start - (b.lap.end - b.lap.start)) / 1000,
      2,
    );
    expect(elapsedDelta(a, b, 0)).toBeCloseTo(0, 5);
  });
  it("never picks the sector where the car stood still", () => {
    expect(sectors.every((s) => s.time < 60000)).toBe(true);
  });
  it("uses fast laps with GPS outages for sectors that are not affected", () => {
    const sources = new Set(sectors.map((s) => s.source.id));
    expect(sources.has("day2:3")).toBe(true);
  });
  it("estimates braking on a real lap at a plausible share of the distance", () => {
    const t = traces.find((x) => x.id === ref.id)!;
    let braking = 0,
      n = 0;
    for (let d = 0; d < t.length; d += 10, n++) if (isBraking(t, d)) braking++;
    const share = braking / n;
    console.log(
      "Braking share of reference lap:",
      (share * 100).toFixed(1) + "%",
    );
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.3);
  });
});

describe("session groups and selection", () => {
  const day = (d: number, h: number) => new Date(2026, 8, d, h, 0, 0).getTime();
  const mkS = (id: string, trackId: number, track: string, start: number) =>
    ({ id, trackId, track, start, laps: [] }) as unknown as Session;
  const all = [
    mkS("n1", 117, "Nordschleife BTG", day(27, 8)),
    mkS("s1", 5, "Spa", day(20, 10)),
    mkS("n2", 117, "Nordschleife BTG", day(27, 14)),
    mkS("n3", 117, "Nordschleife BTG", day(3, 9)),
  ];
  const ids = all.map((s) => s.id);
  it("groups by track, A to Z, oldest session first", () => {
    const g = groupSessions(all, "track");
    expect(g.map((x) => x.label)).toEqual(["Nordschleife BTG", "Spa"]);
    expect(g[0].sessions.map((s) => s.id)).toEqual(["n3", "n1", "n2"]);
  });
  it("groups by calendar day, newest first, keeping tracks separate inside", () => {
    const g = groupSessions(all, "date");
    expect(g.map((x) => x.sessions.map((s) => s.id))).toEqual([
      ["n1", "n2"],
      ["s1"],
      ["n3"],
    ]);
    expect(g[0].label).toContain("27 September 2026");
  });
  it("treats an empty collection as everything", () => {
    expect(isSelected([], "n1")).toBe(true);
    expect(selectionState([], ["n1", "s1"])).toBe("all");
    expect(selectionState(["n1"], ["n1", "s1"])).toBe("some");
    expect(selectionState(["n1"], ["s1"])).toBe("none");
  });
  it("selects sessions across tracks and dates", () => {
    let c = toggleSessions(ids, [], ["s1", "n3"], false);
    expect(c.sort()).toEqual(["n1", "n2"]);
    c = toggleSessions(ids, c, ["s1"], true);
    expect(c).toEqual(["n1", "s1", "n2"]);
    expect(toggleSessions(ids, c, ["n3"], true)).toEqual([]);
  });
  it("never empties the analyzer", () => {
    const c = toggleSessions(ids, [], ["n1", "n2", "n3"], false);
    expect(c).toEqual(["s1"]);
    expect(toggleSessions(ids, c, ["s1"], false)).toEqual(["s1"]);
  });
  it("analyzes only one group", () => {
    expect(onlySessions(ids, ["n1", "n2", "n3"])).toEqual(["n1", "n2", "n3"]);
    expect(onlySessions(ids, ids)).toEqual([]);
    expect(onlySessions(ids, [])).toEqual([]);
  });
});

describe("opportunities", () => {
  // A lap with a GPS sample every 10 m; each 100 m sector takes the given seconds.
  const lap = (id: string, sectorSeconds: number[]): Trace => {
    const distance: number[] = [],
      times: number[] = [];
    let elapsed = 0;
    sectorSeconds.forEach((sec, k) => {
      for (let m = 0; m < 10; m++) {
        distance.push(k * 100 + m * 10);
        times.push((elapsed + (sec * m) / 10) * 1000);
      }
      elapsed += sec;
    });
    distance.push(sectorSeconds.length * 100);
    times.push(elapsed * 1000);
    return {
      id,
      sessionId: id,
      label: id,
      lap: { id, number: 1, start: 0, end: elapsed * 1000, issues: [] },
      distance: Float64Array.from(distance),
      times: Float64Array.from(times),
      lat: new Float64Array(distance.length),
      lon: new Float64Array(distance.length),
      channels: {},
      length: distance[distance.length - 1],
      issues: [],
    };
  };
  it("measures each sector of the reference lap against the best sector", () => {
    const best = lap("best", [10, 11, 9]), // 30 s
      other = lap("other", [11, 9, 12]); // 32 s
    const sectors = optimal([best, other], [0, 100, 200, 300]);
    expect(sectors.map((x) => x.time)).toEqual([10000, 9000, 9000]);
    const opp = opportunities(best, sectors);
    expect(opp.map((o) => o.gain)).toEqual([0, 2000, 0]);
    expect(opp[1].source.id).toBe("other");
    // The gains add up to the lap time minus the optimal.
    expect(opp.reduce((n, o) => n + o.gain, 0)).toBe(30000 - 28000);
  });
});
describe("opportunity scope", () => {
  const d = (day: number, h: number) => new Date(2026, 8, day, h).getTime();
  const mk = (id: string, start: number) =>
    ({ id, trackId: 1, track: "T", start, laps: [] }) as unknown as Session;
  const all = [mk("a", d(26, 9)), mk("b", d(27, 8)), mk("c", d(27, 14))];
  it("uses the selected sessions when there is a selection", () => {
    const s = opportunityScope(all, ["a", "c"]);
    expect(s.mode).toBe("selected");
    expect(s.ids).toEqual(["a", "c"]);
  });
  it("otherwise uses one day: the chosen one, the anchor's, or the latest", () => {
    expect(opportunityScope(all, []).ids).toEqual(["b", "c"]);
    expect(opportunityScope(all, [], undefined, "a").ids).toEqual(["a"]);
    const chosen = opportunityScope(
      all,
      [],
      opportunityScope(all, [], undefined, "a").day,
      "c",
    );
    expect(chosen.ids).toEqual(["a"]);
    expect(opportunityScope([], []).ids).toEqual([]);
  });
});

describe("session summary", () => {
  const mkLap = (n: number, seconds: number, issues: string[] = []) => ({
    id: "s:" + n,
    number: n,
    start: n * 1_000_000,
    end: n * 1_000_000 + seconds * 1000,
    issues,
  });
  const s = {
    id: "s",
    channels: [
      {
        id: "speed",
        times: Float64Array.from([
          1_000_100, 1_000_200, 1_500_000, 2_000_100, 9_999_999,
        ]),
        values: Float64Array.from([100, 180, 210, 190, 300]),
      },
    ],
    laps: [
      mkLap(1, 104.33),
      mkLap(2, 102.31),
      mkLap(3, 5000, ["Interrupted lap: unusually long duration"]),
      mkLap(4, 133.13, ["GPS gap longer than 2 seconds"]),
    ],
  } as unknown as Session;
  it("marks the best lap and the gap of every other lap", () => {
    const r = summarize(s);
    expect(r.bestMs).toBe(102310);
    expect(r.rows.map((x) => x.best)).toEqual([false, true, false, false]);
    expect(r.rows.map((x) => Math.round(x.delta))).toEqual([
      2020, 0, 4897690, 30820,
    ]);
    expect(r.rows[2].interrupted).toBe(true);
    expect(r.rows[3].gap).toBe(true);
    expect(r.rows[1].bar).toBe(0);
    expect(r.rows[3].bar).toBe(1);
  });
  it("finds the top speed only while a lap was running", () => {
    // 210 and 300 km/h were recorded between laps, so they do not count.
    expect(summarize(s).topSpeed).toBe(190);
  });
  it("formats gaps like a timing screen", () => {
    expect(formatGap(2020)).toBe("+2.02");
    expect(formatGap(-300)).toBe("-0.30");
    expect(formatGap(84 * 60000 + 8218)).toBe("+84:08.22");
  });
});

describe("laps RaceChrono leaves open", () => {
  // Minimal synthetic archive: ten seconds of GPS at 10 Hz and the given laps.
  const archive = (laps: object[]) => {
    const n = 100,
      t = new DataView(new ArrayBuffer(n * 8)),
      c = new DataView(new ArrayBuffer(n * 8));
    for (let i = 0; i < n; i++) {
      t.setBigInt64(i * 8, BigInt(1_000_000 + i * 100), true);
      c.setInt32(i * 8, Math.round(47.79 * 6_000_000 + i * 60), true);
      c.setInt32(i * 8 + 4, Math.round(13.17 * 6_000_000), true);
    }
    return zipSync({
      "session.json": strToU8(
        JSON.stringify({
          version: 1,
          trackName: "Synthetic",
          trackId: 1,
          laps,
        }),
      ),
      channel_1_100_0_1_1: new Uint8Array(t.buffer),
      channel_1_100_0_3_1: new Uint8Array(c.buffer),
    });
  };
  it("skips the lap that was still running when recording stopped", () => {
    const s = decode(
      archive([
        { number: 1, startTimestamp: 1_000_000, finishTimestamp: 1_004_000 },
        { number: 2, startTimestamp: 1_004_000 },
      ]),
      "synthetic.rcz",
      "syn",
    );
    expect(s.laps.map((l) => l.number)).toEqual([1]);
  });
  it("still rejects a lap that ends before it starts", () => {
    expect(() =>
      decode(
        archive([
          { number: 1, startTimestamp: 1_004_000, finishTimestamp: 1_000_000 },
        ]),
        "synthetic.rcz",
        "syn",
      ),
    ).toThrow("Invalid lap boundaries.");
  });
  it("still rejects a lap without a start", () => {
    expect(() =>
      decode(
        archive([{ number: 1, finishTimestamp: 1_004_000 }]),
        "synthetic.rcz",
        "syn",
      ),
    ).toThrow("Invalid lap boundaries.");
  });
});

describe("dropped files", () => {
  it("recognises sessions, projects, sync files and videos by name", () => {
    expect(classifyFile("session_20260418_163602_salzburgring.rcz")).toBe(
      "session",
    );
    expect(classifyFile("TRACKDAY.RCZ")).toBe("session");
    expect(classifyFile("backup.apex.zip")).toBe("project");
    expect(classifyFile("day.rcsync.json")).toBe("sync");
    expect(classifyFile("GX010042.MP4")).toBe("video");
    expect(classifyFile("notes.txt")).toBe("unsupported");
    expect(classifyFile("rcz")).toBe("unsupported");
  });
  it("names the track of every imported session and flags a new one", () => {
    const line = describeImport(
      [
        { track: "Salzburgring", laps: 9, newTrack: true },
        { track: "Salzburgring", laps: 4, newTrack: true },
        { track: "Nordschleife BTG", laps: 3, newTrack: false },
      ],
      1,
      2,
    );
    expect(line).toContain("Imported 3 sessions");
    expect(line).toContain("Salzburgring (new track): 2 sessions, 13 laps");
    expect(line).toContain("Nordschleife BTG: 1 session, 3 laps");
    expect(line).toContain("1 already in your collection");
    expect(line).toContain("2 video files skipped");
    expect(describeImport([], 0, 0)).toBe("");
  });
});

describe("extra comparison laps in saved settings", () => {
  const base = {
    a: "",
    b: "",
    mode: "distance",
    excluded: [],
    included: [],
    collection: [],
    charts: [],
    layouts: [],
    mapHeight: 340,
  };
  it("accepts up to four extra laps with hex colors", async () => {
    const { validateSettings } = await import("./storage");
    expect(() => validateSettings(base)).not.toThrow();
    expect(() =>
      validateSettings({
        ...base,
        extras: [
          { id: "s:1", color: "#c792ea" },
          { id: "", color: "#F2D15B" },
          { id: "optimal", color: "#7fb2ff" },
          { id: "s:4", color: "#ff7a90" },
        ],
      }),
    ).not.toThrow();
  });
  it("rejects too many, malformed or unsafe extras", async () => {
    const { validateSettings } = await import("./storage");
    const one = { id: "s:1", color: "#c792ea" };
    expect(() =>
      validateSettings({ ...base, extras: [one, one, one, one, one] }),
    ).toThrow("Invalid extra comparison laps.");
    expect(() =>
      validateSettings({ ...base, extras: [{ id: "s:1", color: "red" }] }),
    ).toThrow("Invalid extra comparison laps.");
    expect(() =>
      validateSettings({ ...base, extras: [{ id: 5, color: "#c792ea" }] }),
    ).toThrow("Invalid extra comparison laps.");
    expect(() => validateSettings({ ...base, extras: "x" })).toThrow(
      "Invalid extra comparison laps.",
    );
  });
});

describe("chart hover channel", () => {
  it("passes the hovered distance to listeners until they unsubscribe", () => {
    const seen: (number | null)[] = [];
    const off = hoverBus.subscribe((d) => seen.push(d));
    hoverBus.set(120);
    hoverBus.set(null);
    off();
    hoverBus.set(300);
    expect(seen).toEqual([120, null]);
  });
});

describe("lap review", () => {
  const base = {
    issues: [] as string[],
    sameTrack: true,
    selected: true,
    excluded: false,
    included: false,
  };
  it("says why a lap does or does not count", () => {
    expect(lapStatus(base)).toBe("counts");
    expect(
      lapStatus({ ...base, issues: ["GPS gap longer than 2 seconds"] }),
    ).toBe("counts");
    expect(
      lapStatus({ ...base, issues: ["Marked invalid by RaceChrono"] }),
    ).toBe("review");
    expect(
      lapStatus({
        ...base,
        issues: ["Marked invalid by RaceChrono"],
        included: true,
      }),
    ).toBe("included");
    expect(lapStatus({ ...base, excluded: true })).toBe("excluded");
    expect(lapStatus({ ...base, selected: false })).toBe("not-selected");
  });
  it("calls a lap on another track what it is, not a problem to review", () => {
    expect(
      lapStatus({
        ...base,
        sameTrack: false,
        issues: ["Incompatible start or finish gates"],
      }),
    ).toBe("other-track");
  });
  it("never lets a lap that does not line up be forced in", () => {
    const issues = ["Ambiguous GPS alignment"];
    expect(canInclude(issues)).toBe(false);
    expect(lapStatus({ ...base, issues, included: true })).toBe("unusable");
    expect(canInclude(["Marked invalid by RaceChrono"])).toBe(true);
  });
  it("explains every flag in plain words", () => {
    for (const flag of [
      "Marked invalid by RaceChrono",
      "Incomplete GPS coverage",
      "GPS gap longer than 2 seconds",
      "Interrupted lap: unusually long duration",
      "Incompatible start or finish gates",
      "Ambiguous GPS alignment",
    ])
      expect(explainIssue(flag).length).toBeGreaterThan(60);
    expect(Object.keys(STATUS_LABEL)).toHaveLength(7);
  });
});
describe("effect of counting a lap", () => {
  const lap = (id: string, sectorSeconds: number[]): Trace => {
    const distance: number[] = [],
      times: number[] = [];
    let elapsed = 0;
    sectorSeconds.forEach((sec, k) => {
      for (let m = 0; m < 10; m++) {
        distance.push(k * 100 + m * 10);
        times.push((elapsed + (sec * m) / 10) * 1000);
      }
      elapsed += sec;
    });
    distance.push(sectorSeconds.length * 100);
    times.push(elapsed * 1000);
    return {
      id,
      sessionId: id,
      label: id,
      lap: { id, number: 1, start: 0, end: elapsed * 1000, issues: [] },
      distance: Float64Array.from(distance),
      times: Float64Array.from(times),
      lat: new Float64Array(distance.length),
      lon: new Float64Array(distance.length),
      channels: {},
      length: distance[distance.length - 1],
      issues: [],
    };
  };
  const gates = [0, 100, 200, 300];
  it("shows the theoretical lap without and with the lap, and the sectors it wins", () => {
    const pool = [lap("a", [10, 11, 9]), lap("b", [11, 9, 12])];
    const extra = lap("c", [8, 8, 8]);
    const r = optimalWith(pool, extra, gates);
    expect(r.without).toBe(28000);
    expect(r.with).toBe(24000);
    expect(r.wins).toBe(3);
  });
  it("gives the same answer whether or not the lap is already in the pool", () => {
    const a = lap("a", [10, 11, 9]),
      c = lap("c", [9, 9, 9]);
    expect(optimalWith([a, c], c, gates)).toEqual(optimalWith([a], c, gates));
  });
  it("reports a lap that wins nothing", () => {
    const pool = [lap("a", [8, 8, 8])];
    expect(optimalWith(pool, lap("slow", [20, 20, 20]), gates).wins).toBe(0);
  });
});

describe("video recording time", () => {
  const box = (type: string, payload: Uint8Array) => {
    const b = new Uint8Array(8 + payload.length);
    new DataView(b.buffer).setUint32(0, b.length);
    b.set(strToU8(type), 4);
    b.set(payload, 8);
    return b;
  };
  const mvhd = (unix: number, version = 0) => {
    const p = new Uint8Array(version ? 32 : 24);
    const v = new DataView(p.buffer);
    p[0] = version;
    const secs = unix / 1000 + 2082844800;
    if (version) v.setBigUint64(4, BigInt(secs));
    else v.setUint32(4, secs);
    return box("mvhd", p);
  };
  const mp4 = (...parts: Uint8Array[]) => new Blob(parts as BlobPart[]);
  it("reads the creation time when the header is at the end, after a big mdat", async () => {
    const t = Date.UTC(2026, 8, 27, 12, 30, 0);
    const file = mp4(
      box("ftyp", strToU8("qt  ")),
      box("mdat", new Uint8Array(5000)),
      box("moov", mvhd(t)),
    );
    expect(await readCreationTime(file)).toBe(t);
  });
  it("reads a 64-bit header and ignores files without one", async () => {
    const t = Date.UTC(2026, 8, 27, 12, 30, 0);
    expect(await readCreationTime(mp4(box("moov", mvhd(t, 1))))).toBe(t);
    expect(
      await readCreationTime(mp4(box("ftyp", strToU8("qt  ")))),
    ).toBeNull();
    expect(
      await readCreationTime(new Blob([new Uint8Array([1, 2, 3])])),
    ).toBeNull();
    const empty = new Uint8Array(24);
    expect(
      await readCreationTime(mp4(box("moov", box("mvhd", empty)))),
    ).toBeNull();
  });
  const session = {
    start: Date.UTC(2026, 8, 27, 11, 40),
    end: Date.UTC(2026, 8, 27, 14, 20),
  };
  it("accepts a UTC recording time that falls inside the session", () => {
    const at = Date.UTC(2026, 8, 27, 12, 14, 44);
    const r = matchVideoStart(at, session, -120)!;
    expect(r.start).toBe(at);
    expect(r.reading).toBe("utc");
    expect(r.ambiguous).toBe(false);
  });
  it("reads local wall-clock digits when only that fits", () => {
    // Camera in UTC+2 wrote 14:14:44 as if it were UTC. The real start is 12:14:44 UTC,
    // and this session ended at 13:00 UTC, so the UTC reading cannot be right.
    const short = {
      start: Date.UTC(2026, 8, 27, 11, 40),
      end: Date.UTC(2026, 8, 27, 13, 0),
    };
    const digits = Date.UTC(2026, 8, 27, 14, 14, 44);
    const r = matchVideoStart(digits, short, -120)!;
    expect(r.start).toBe(Date.UTC(2026, 8, 27, 12, 14, 44));
    expect(r.reading).toBe("local");
    expect(r.ambiguous).toBe(false);
  });
  it("flags it when both readings fit inside a long session", () => {
    const digits = Date.UTC(2026, 8, 27, 14, 14, 44);
    const r = matchVideoStart(digits, session, -120)!;
    expect(r.reading).toBe("utc");
    expect(r.ambiguous).toBe(true);
    expect(r.other).toBe(Date.UTC(2026, 8, 27, 12, 14, 44));
  });
  it("gives up on an export time far from the session", () => {
    const exported = Date.UTC(2026, 8, 28, 14, 20, 33);
    expect(matchVideoStart(exported, session, -120)).toBeNull();
  });
});
describe("typed lap time", () => {
  it("understands minutes, hours and plain seconds", () => {
    expect(parseLapTime("85:40")).toBe(5140000);
    expect(parseLapTime("85:40.250")).toBe(5140250);
    expect(parseLapTime("1:25:40")).toBe(5140000);
    expect(parseLapTime("5140")).toBe(5140000);
    expect(parseLapTime(" 0:12,5 ")).toBe(12500);
  });
  it("rejects nonsense", () => {
    for (const bad of ["", "abc", "1:75", "1:2:3:4", "-5", "12:"])
      expect(parseLapTime(bad)).toBeNaN();
  });
});

describe("video start time", () => {
  const identity = { sha256: "a".repeat(64), name: "s.rcz", size: 1 };
  const binding = (
    anchors: { videoSeconds: number; sessionTimestamp: number }[],
  ) => ({
    session: identity,
    clips: [{ ...identity, name: "v.mp4", duration: 600, start: 0 }],
    anchors,
  });
  it("finds the telemetry time of any video moment, and undoes videoTime", () => {
    const one = binding([{ videoSeconds: 0, sessionTimestamp: 1_000_000 }]);
    expect(stampAtVideo(one, 0)).toBe(1_000_000);
    expect(stampAtVideo(one, 60)).toBe(1_060_000);
    const two = binding([
      { videoSeconds: 10, sessionTimestamp: 1_000_000 },
      { videoSeconds: 70, sessionTimestamp: 1_061_000 },
    ]);
    for (const v of [0, 10, 33.3, 70, 500])
      expect(videoTime(two, stampAtVideo(two, v))).toBeCloseTo(v, 6);
    expect(stampAtVideo(binding([]), 5)).toBeNaN();
  });
  it("shows the video starting a minute before the GPS data", () => {
    const gpsStart = Date.UTC(2026, 8, 27, 12, 1, 0);
    const b = binding([
      { videoSeconds: 0, sessionTimestamp: Date.UTC(2026, 8, 27, 12, 0, 0) },
    ]);
    // The GPS data begins one minute into the video.
    expect(videoTime(b, gpsStart)).toBe(60);
  });
  it("reads a typed local time on the session's date, or with its own date", () => {
    const ref = new Date(2026, 8, 27, 13, 40, 35).getTime();
    expect(parseWallClock("14:10:04", ref)).toBe(
      new Date(2026, 8, 27, 14, 10, 4).getTime(),
    );
    expect(parseWallClock("14:10", ref)).toBe(
      new Date(2026, 8, 27, 14, 10, 0).getTime(),
    );
    expect(parseWallClock("14:10:04.5", ref)).toBe(
      new Date(2026, 8, 27, 14, 10, 4, 500).getTime(),
    );
    expect(parseWallClock("2026-09-28 09:05:00", ref)).toBe(
      new Date(2026, 8, 28, 9, 5, 0).getTime(),
    );
    expect(formatWallClock(parseWallClock("14:10:04.250", ref))).toBe(
      "14:10:04.250",
    );
  });
  it("rejects times that do not exist", () => {
    const ref = Date.now();
    for (const bad of [
      "",
      "25:00",
      "12:75",
      "12:00:99",
      "abc",
      "2026-02-31 10:00:00",
      "1200",
    ])
      expect(parseWallClock(bad, ref)).toBeNaN();
  });
});
