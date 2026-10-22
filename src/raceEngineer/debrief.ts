import type { Session } from "../model";
import type { Evidence, Snapshot } from "./contracts";
import { metricValue } from "./focus";
import { median, quantile } from "./signals";

export function orderedLaps(snapshot: Snapshot, sessions: Session[]) {
  return snapshot.laps
    .map((lap, index) => {
      const session = sessions.find((s) => s.id === lap.sessionId);
      const recorded = session?.laps.find((l) => l.id === lap.id);
      return {
        ...lap,
        ref: `l${index + 1}`,
        sessionOrder: snapshot.sessionIds.indexOf(lap.sessionId),
        orderTime: recorded?.start ?? lap.number,
        sessionTime: session?.start ?? 0,
        cleanTiming: lap.coachingEligible && !lap.issues.length,
      };
    })
    .sort(
      (a, b) =>
        a.sessionTime - b.sessionTime ||
        a.sessionOrder - b.sessionOrder ||
        a.orderTime - b.orderTime,
    );
}
export function sessionOverview(snapshot: Snapshot, sessions: Session[]) {
  const laps = orderedLaps(snapshot, sessions),
    clean = laps.filter((l) => l.cleanTiming);
  const reference = snapshot.laps.find((l) => l.id === snapshot.referenceId);
  const referenceClean = clean.filter(
    (l) => l.sessionId === reference?.sessionId,
  );
  const times = referenceClean.map((l) => l.durationMs);
  const best = [...referenceClean].sort(
    (a, b) => a.durationMs - b.durationMs,
  )[0];
  const changes = referenceClean
    .slice(1)
    .map((l, i) => l.durationMs - referenceClean[i].durationMs);
  return {
    laps,
    clean,
    referenceClean,
    best,
    spreadMs:
      times.length >= 3 ? quantile(times, 0.9) - quantile(times, 0.1) : null,
    firstToLastMs: times.length >= 2 ? times.at(-1)! - times[0] : null,
    trend:
      times.length < 2
        ? "insufficient"
        : changes.every((d) => d < -50)
          ? "quicker"
          : changes.every((d) => d > 50)
            ? "slower"
            : changes.every((d) => Math.abs(d) <= 50)
              ? "steady"
              : "mixed",
  };
}
export type DebriefCandidate = {
  kind: "minimum-speed" | "exit-speed" | "inconsistent-window";
  title: string;
  observations: number;
  sections: number;
  laps: number;
  evidenceIds: string[];
  contraryIds: string[];
  method: string;
};
export function sessionDigest(snapshot: Snapshot, sessions: Session[]) {
  const overview = sessionOverview(snapshot, sessions);
  const evidenceRefs = new Map(
    snapshot.evidence.map((e, i) => [e.id, `e${i + 1}`]),
  );
  const lapRefs = new Map(snapshot.laps.map((l, i) => [l.id, `l${i + 1}`]));
  const eligible = new Set(
    snapshot.laps.filter((l) => l.coachingEligible).map((l) => l.id),
  );
  const valid = snapshot.evidence.filter(
    (e) =>
      eligible.has(e.lapId) &&
      !e.quality.length &&
      metricValue(e, "elapsed", "ms") !== undefined,
  );
  const grouped = snapshot.corners.map((c) => ({
    corner: c,
    rows: valid.filter((e) => e.cornerId === c.id),
  }));
  const events: Record<
    "minimum-speed" | "exit-speed",
    { a: Evidence; b: Evidence; contrary: Evidence[] }[]
  > = { "minimum-speed": [], "exit-speed": [] };
  const variable: { rows: Evidence[]; spreadMs: number }[] = [];
  for (const { rows } of grouped) {
    if (rows.length < 2) continue;
    for (const a of rows) {
      const slower = rows.filter(
        (b) =>
          b.lapId !== a.lapId &&
          metricValue(a, "elapsed", "ms")! - metricValue(b, "elapsed", "ms")! >
            200,
      );
      for (const kind of ["minimum-speed", "exit-speed"] as const) {
        const metric = kind === "minimum-speed" ? "minimumSpeed" : "exitSpeed";
        const matches = slower.filter((b) => {
          const av = metricValue(a, metric, "m/s"),
            bv = metricValue(b, metric, "m/s");
          const ae = metricValue(a, "entrySpeed", "m/s"),
            be = metricValue(b, "entrySpeed", "m/s");
          return (
            av !== undefined &&
            bv !== undefined &&
            ae !== undefined &&
            be !== undefined &&
            Math.abs(ae - be) <= 3 &&
            bv - av >= 2
          );
        });
        if (matches.length)
          events[kind].push({
            a,
            b: matches.sort(
              (a, b) => a.metrics.elapsed.value! - b.metrics.elapsed.value!,
            )[0],
            contrary: rows.filter(
              (b) =>
                b.lapId !== a.lapId &&
                b.metrics.elapsed.value! >= a.metrics.elapsed.value!,
            ),
          });
      }
    }
    if (rows.length >= 3) {
      const spreadMs =
        quantile(
          rows.map((e) => e.metrics.elapsed.value!),
          0.9,
        ) -
        quantile(
          rows.map((e) => e.metrics.elapsed.value!),
          0.1,
        );
      if (spreadMs >= 500) variable.push({ rows, spreadMs });
    }
  }
  const candidates: DebriefCandidate[] = [];
  for (const kind of ["minimum-speed", "exit-speed"] as const) {
    const found = events[kind];
    const sections = new Set(found.map((p) => p.a.cornerId)).size;
    const laps = new Set(found.map((p) => p.a.lapId)).size;
    if (found.length < 2 || (sections < 2 && laps < 2)) continue;
    const refs = [...new Set(found.flatMap((p) => [p.a.id, p.b.id]))];
    candidates.push({
      kind,
      title:
        kind === "minimum-speed"
          ? "Lower minimum speeds after similar-speed entries"
          : "Lower exit speeds after similar-speed entries",
      observations: found.length,
      sections,
      laps,
      evidenceIds: refs.slice(0, 12).map((id) => evidenceRefs.get(id)!),
      contraryIds: [
        ...new Set(
          found.flatMap((p) => p.contrary.map((e) => evidenceRefs.get(e.id)!)),
        ),
      ].slice(0, 8),
      method:
        "Screening only: same-window elapsed >200 ms slower, entry speeds within 3 m/s, selected speed at least 2 m/s lower. Not a brake, line or driver-error diagnosis. Observations may repeat the same lap; compare affected-lap and section counts.",
    });
  }
  if (variable.length) {
    const representative = [...variable]
      .sort((a, b) => b.spreadMs - a.spreadMs)
      .slice(0, 3);
    candidates.push({
      kind: "inconsistent-window",
      title: "Window pace varies across repeated laps",
      observations: variable.length,
      sections: variable.length,
      laps: new Set(variable.flatMap((v) => v.rows.map((e) => e.lapId))).size,
      evidenceIds: representative.flatMap((v) =>
        [...v.rows]
          .sort((a, b) => a.metrics.elapsed.value! - b.metrics.elapsed.value!)
          .filter((_, i, rows) => i === 0 || i === rows.length - 1)
          .map((e) => evidenceRefs.get(e.id)!),
      ),
      contraryIds: [],
      method:
        "At least three quality-eligible laps in a common window with interpolated P90–P10 elapsed spread >=500 ms. Traffic/conditions can cause variation; not proof of inconsistency in driver inputs.",
    });
  }
  // Compact evidence aliases avoid repeating the snapshot/session hash on every row.
  const important = new Set(
    candidates.flatMap((c) => [...c.evidenceIds, ...c.contraryIds]),
  );
  const ordered = [...valid].sort(
    (a, b) =>
      Number(important.has(evidenceRefs.get(b.id)!)) -
      Number(important.has(evidenceRefs.get(a.id)!)),
  );
  const rounded = (e: Evidence, key: string, unit: string) => {
    const v = metricValue(e, key, unit);
    return v === undefined
      ? null
      : Math.round(v * (unit === "ms" ? 1 : 1000)) / (unit === "ms" ? 1 : 1000);
  };
  const rows = ordered
    .slice(0, 600)
    .map((e) => [
      evidenceRefs.get(e.id)!,
      lapRefs.get(e.lapId)!,
      e.cornerId,
      rounded(e, "elapsed", "ms"),
      rounded(e, "entrySpeed", "m/s"),
      rounded(e, "minimumSpeed", "m/s"),
      rounded(e, "exitSpeed", "m/s"),
      rounded(e, "brakingG95", "g"),
      rounded(e, "accelerationG95", "g"),
      rounded(e, "lateralG95", "g"),
    ]);
  const progress = snapshot.sessionIds.map((id) => {
    const clean = overview.clean.filter((l) => l.sessionId === id);
    const deltas = clean
      .slice(1)
      .map((l, i) => l.durationMs - clean[i].durationMs);
    return {
      session: snapshot.sessionIds.indexOf(id) + 1,
      cleanLaps: clean.length,
      firstLap: clean[0]?.ref ?? null,
      lastLap: clean.at(-1)?.ref ?? null,
      firstToLastMs:
        clean.length < 2
          ? null
          : clean.at(-1)!.durationMs - clean[0].durationMs,
      fasterTransitions: deltas.filter((d) => d < -50).length,
      slowerTransitions: deltas.filter((d) => d > 50).length,
      medianLapMs: clean.length ? median(clean.map((l) => l.durationMs)) : null,
    };
  });
  const result = {
    version: "session-debrief-1",
    snapshotId: snapshot.id,
    lapOrder: overview.laps.slice(0, 80).map((l) => ({
      lap: l.ref,
      number: l.number,
      session: l.sessionOrder + 1,
      durationMs: l.durationMs,
      cleanTiming: l.cleanTiming,
      issues: l.issues,
    })),
    progression: progress,
    sections: snapshot.corners.slice(0, 120).map((c) => ({
      id: c.id,
      name: c.name,
      distanceM: [Math.round(c.start), Math.round(c.end)],
    })),
    screeningCandidates: candidates,
    gForceSources: snapshot.sessionIds.map((id, i) => ({
      recording: i + 1,
      longitudinal: snapshot.capabilities[id]?.some(
        (c) => c.semantic === "longitudinal",
      )
        ? "recorded-mapped"
        : snapshot.capabilities[id]?.some((c) => c.semantic === "speed")
          ? "Speed-derived"
          : "unavailable",
      lateral: snapshot.capabilities[id]?.some((c) => c.semantic === "lateral")
        ? "recorded-mapped"
        : snapshot.capabilities[id]?.some((c) => c.semantic === "speed")
          ? "GPS-derived"
          : "unavailable",
    })),
    columns: [
      "evidenceId",
      "lap",
      "section",
      "elapsedMs",
      "entryMps",
      "minimumMps",
      "exitMps",
      "brakingG95",
      "accelerationG95",
      "lateralAbsG95",
    ],
    rows,
    coverage: {
      selectedLaps: snapshot.laps.length,
      listedLaps: Math.min(80, snapshot.laps.length),
      totalSections: snapshot.corners.length,
      listedSections: Math.min(120, snapshot.corners.length),
      eligibleEvidenceRows: valid.length,
      listedRows: rows.length,
      omittedRows: valid.length - rows.length,
    },
    limitations: [
      "G summaries are in g, P95 not maxima: braking and acceleration split the signed longitudinal axis; lateral is absolute magnitude. Recorded mapped sensor axes require verified calibration. GPS estimates (speed derivative and speed² × path curvature) are not pedal input, tyre forces or unused grip. Query corner_review for simultaneous signed traces.",
      "Chronology is ordered within each recording, not a career-learning trend. Session differences and unknown driver/car/conditions can confound comparisons.",
      "Clean lap-duration progression excludes all lap issues; unaffected windows of a GPS-gap lap may still support a section comparison. Coaching exclusions never change best-sector eligibility.",
      "Screening candidates are hypotheses to investigate, not automatically accepted findings. Counts and windows can overlap between candidates; do not add them as separate time losses.",
      "Only listed row evidence is supplied here. eN and lN are scoped evidence/lap aliases accepted in report reference fields; analysis tools still use the full IDs from summary.",
    ],
  };
  const bytes = () => new TextEncoder().encode(JSON.stringify(result)).length;
  // Leave space for the final coverage counters, and never silently imply full coverage.
  while (bytes() > 32000 && result.rows.length) result.rows.pop();
  while (bytes() > 32000 && result.sections.length) result.sections.pop();
  while (bytes() > 32000 && result.lapOrder.length) result.lapOrder.pop();
  result.coverage.listedLaps = result.lapOrder.length;
  result.coverage.listedSections = result.sections.length;
  result.coverage.listedRows = result.rows.length;
  result.coverage.omittedRows = valid.length - result.rows.length;
  return result;
}
export type SessionDigest = ReturnType<typeof sessionDigest>;
