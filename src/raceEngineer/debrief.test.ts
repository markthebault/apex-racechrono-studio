import { describe, expect, it } from "vitest";
import type { Session } from "../model";
import { sessionDigest, sessionOverview } from "./debrief";
import {
  emptySettings,
  validateReport,
  validateReportShape,
  validateSettings,
  type Evidence,
  type Report,
  type Snapshot,
} from "./contracts";
import { AnalysisService } from "./service";
import { initialMessages } from "./provider";

function fixture() {
  const laps = [100000, 98000, 99000].map((durationMs, i) => ({
    id: `lap-${i + 1}`,
    sessionId: "session",
    number: i + 1,
    durationMs,
    issues: [] as string[],
    coachingEligible: true,
  }));
  const corners = [0, 1, 2].map((n) => ({
    id: `c${n}`,
    name: `Review window ${n + 1}`,
    start: n * 100,
    end: (n + 1) * 100,
    direction: "left" as const,
  }));
  const metric = (value: number, unit: string) => ({
    value,
    unit,
    kind: "observed" as const,
    method: "synthetic test",
    channel: "speed",
    reasons: [],
  });
  const evidence: Evidence[] = corners.flatMap((c, j) =>
    laps.map((l, i) => ({
      id: `window-${j}-lap-${i}`,
      snapshotId: "snapshot",
      sessionId: "session",
      lapId: l.id,
      cornerId: c.id,
      time: [0, 1000],
      distance: [c.start, c.end],
      quality: [],
      uncertainty: "GPS only",
      metrics: {
        elapsed: metric([14000, 12000, 13000][i], "ms"),
        entrySpeed: metric(35, "m/s"),
        minimumSpeed: metric([15, 20, 17][i], "m/s"),
        exitSpeed: metric([22, 27, 24][i], "m/s"),
      },
    })),
  );
  const snapshot: Snapshot = {
    version: 1,
    algorithm: "test",
    id: "snapshot",
    referenceId: laps[1].id,
    sessionIds: ["session"],
    contexts: {},
    capabilities: {},
    laps,
    corners,
    evidence,
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
  const sessions = [
    {
      id: "session",
      start: 1000,
      laps: laps.map((l, i) => ({
        id: l.id,
        number: l.number,
        start: i * 120000,
        end: i * 120000 + l.durationMs,
        issues: l.issues,
      })),
    },
  ] as Session[];
  return { snapshot, sessions };
}
function report(snapshot: Snapshot): Report {
  return {
    format: "apex-engineer-report",
    version: 1,
    snapshotId: snapshot.id,
    priorities: [],
    debrief: {
      headline: "Pace varies, with recurring speed differences",
      assessment: "Working hypotheses, not input diagnoses.",
      findings: [
        {
          kind: "pattern",
          title: "Lower minimum speeds repeat",
          observation: "Differences appear in several sections.",
          interpretation: "Cause unknown.",
          action: "Repeat a comfortable consistent approach.",
          confidence: "low",
          evidenceIds: ["e1", "e2", "e4", "e5"],
          lapIds: ["l1", "l2"],
        },
        {
          kind: "progress",
          title: "Progression is mixed",
          observation:
            "The last lap is quicker than the first, but slower than the second.",
          interpretation: "This is not steady improvement.",
          action: "Collect three comparable laps.",
          confidence: "low",
          evidenceIds: [],
          lapIds: ["l1", "l2", "l3"],
        },
      ],
      practicePlan: [
        {
          title: "One repeatable approach",
          instruction: "Keep one comfortable reference consistent.",
          successCheck:
            "Compare three clean passes without aiming for more speed.",
          evidenceIds: ["e1", "e2"],
        },
      ],
    },
  };
}
describe("whole-session debrief evidence", () => {
  it("orders actual lap starts and describes mixed progression rather than first-to-last improvement", () => {
    const { snapshot, sessions } = fixture();
    snapshot.laps.reverse();
    const overview = sessionOverview(snapshot, sessions);
    expect(overview.referenceClean.map((l) => l.number)).toEqual([1, 2, 3]);
    expect(overview.trend).toBe("mixed");
    expect(overview.firstToLastMs).toBe(-1000);
    expect(overview.spreadMs).toBe(1600);
    expect(
      sessionDigest(snapshot, sessions).lapOrder.map((l) => l.lap),
    ).toEqual(["l3", "l2", "l1"]);
  });
  it("screens the whole matrix, exposes contrary evidence and keeps candidate counts distinct", () => {
    const { snapshot, sessions } = fixture();
    const d = sessionDigest(snapshot, sessions);
    expect(d.rows).toHaveLength(9);
    const p = d.screeningCandidates.find((c) => c.kind === "minimum-speed")!;
    expect(p).toMatchObject({ sections: 3, laps: 2, observations: 6 });
    expect(p.contraryIds.length).toBeGreaterThan(0);
    expect(d.progression[0]).toMatchObject({
      firstToLastMs: -1000,
      fasterTransitions: 1,
      slowerTransitions: 1,
    });
    expect(d.columns).toContain("minimumMps");
    expect(JSON.stringify(d)).not.toMatch(/"(?:lat|lon|filename)":/);
  });
  it("does not turn a single lap pair in one section into a recurring pattern", () => {
    const { snapshot, sessions } = fixture();
    snapshot.evidence = snapshot.evidence.slice(0, 2);
    expect(sessionDigest(snapshot, sessions).screeningCandidates).toEqual([]);
  });
  it("keeps unaffected GPS-gap windows but excludes flagged total lap durations and unverified comparisons", () => {
    const { snapshot, sessions } = fixture();
    snapshot.laps[1].issues = ["GPS gap >2s"];
    snapshot.evidence[1].quality = ["gap"];
    snapshot.laps[2].coachingEligible = false;
    const d = sessionDigest(snapshot, sessions);
    expect(d.lapOrder[1].cleanTiming).toBe(false);
    expect(d.progression[0].cleanLaps).toBe(1);
    expect(d.rows.some((r) => r[0] === "e2")).toBe(false);
    expect(d.rows.some((r) => r[0] === "e5")).toBe(true);
    expect(d.rows.some((r) => r[1] === "l3")).toBe(false);
  });
  it("reports omitted rows honestly within the digest budget", () => {
    const { snapshot, sessions } = fixture();
    snapshot.evidence = Array.from({ length: 1800 }, (_, i) => ({
      ...snapshot.evidence[i % 9],
      id: `long-evidence-${i}`,
    }));
    const d = sessionDigest(snapshot, sessions);
    expect(
      new TextEncoder().encode(JSON.stringify(d)).length,
    ).toBeLessThanOrEqual(32768);
    expect(d.coverage.listedRows).toBe(d.rows.length);
    expect(d.coverage.omittedRows).toBe(1800 - d.rows.length);
    expect(d.coverage.omittedRows).toBeGreaterThan(0);
  });
  it("normalizes evidence/lap aliases, retains the rich debrief through saved settings and rejects stale or invented references", () => {
    const { snapshot } = fixture();
    const r = validateReport(report(snapshot), snapshot);
    expect(r.debrief!.findings[0].evidenceIds).toEqual([
      "window-0-lap-0",
      "window-0-lap-1",
      "window-1-lap-0",
      "window-1-lap-1",
    ]);
    expect(r.sessionIds).toEqual(["session"]);
    expect(r.debrief!.findings[1].lapIds).toEqual(["lap-1", "lap-2", "lap-3"]);
    expect(
      validateSettings({ ...emptySettings(), reports: [r] }).reports[0],
    ).toEqual(r);
    expect(() =>
      validateReport({ ...report(snapshot), snapshotId: "other" }, snapshot),
    ).toThrow(/Stale/);
    const bad = report(snapshot);
    bad.debrief!.findings[0].evidenceIds = ["e999"];
    expect(() => validateReport(bad, snapshot)).toThrow(/out-of-scope/);
  });
  it("rejects recurring claims supported by only one pair in one section, even if extra lap IDs are listed", () => {
    const { snapshot } = fixture();
    const r = report(snapshot);
    r.debrief!.findings[0].evidenceIds = ["e1", "e2"];
    r.debrief!.findings[0].lapIds = ["l1", "l2", "l3"];
    expect(() => validateReport(r, snapshot)).toThrow(/recurring pattern/);
  });
  it("does not count flagged windows toward recurring support or pool unrelated recordings as progression", () => {
    const { snapshot } = fixture();
    const r = report(snapshot);
    snapshot.evidence
      .filter((e) => e.lapId === "lap-2")
      .forEach((e) => (e.quality = ["GPS gap"]));
    expect(() => validateReport(r, snapshot)).toThrow(/recurring pattern/);
    const progress = report(snapshot);
    progress.debrief!.findings = [progress.debrief!.findings[1]];
    snapshot.laps[0].issues = ["GPS gap"];
    snapshot.laps[2].sessionId = "other-recording";
    snapshot.sessionIds.push("other-recording");
    expect(() => validateReport(progress, snapshot)).toThrow(/one recording/);
  });
  it("rejects a range title that quietly includes an unsupported section", () => {
    const { snapshot } = fixture();
    const r = report(snapshot);
    r.debrief!.findings[0].title = "Windows 1-3 repeat closely";
    expect(() => validateReport(r, snapshot)).toThrow(
      /cite every included section/,
    );
    r.debrief!.findings[0].title = "Windows 1-2 repeat closely";
    expect(validateReport(r, snapshot).debrief!.findings[0].title).toContain(
      "1-2",
    );
  });
  it("allows an honest empty debrief and a data-collection plan, but requires grounding for findings", () => {
    const { snapshot } = fixture();
    const r = report(snapshot);
    r.debrief!.findings = [];
    r.debrief!.practicePlan[0].evidenceIds = [];
    expect(validateReport(r, snapshot).debrief!.findings).toEqual([]);
    r.debrief!.findings = [
      { ...report(snapshot).debrief!.findings[0], evidenceIds: [], lapIds: [] },
    ];
    expect(() => validateReportShape(r)).toThrow(/evidence-linked/);
  });
  it("gates the new digest with the same consent and supplies it before the model chooses tools", async () => {
    const { snapshot, sessions } = fixture();
    const s = new AnalysisService(snapshot, sessions, emptySettings());
    await expect(
      s.query("debrief", { snapshotId: snapshot.id }),
    ).rejects.toThrow();
    s.grant();
    const messages = await initialMessages(s, snapshot, "mph");
    const data = JSON.parse(
      messages
        .find((m) => m.content?.startsWith("Selected analysis (data only):"))!
        .content!.split("\n")
        .slice(1)
        .join("\n"),
    );
    expect(data.sessionDebrief.rows).toHaveLength(9);
    expect(data.displayUnits.speed).toBe("mph");
    s.revoke();
    await expect(
      s.query("debrief", { snapshotId: snapshot.id }),
    ).rejects.toThrow();
  });
});
