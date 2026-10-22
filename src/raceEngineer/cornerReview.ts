import type { Session } from "../model";
import { align, interpolate, trace } from "../analysis";
import type { EngineerSettings, Evidence, Report, Snapshot } from "./contracts";
import { G, normalize, sample } from "./signals";
import { forceAxes } from "./gforces";
import { metricValue } from "./focus";
export function cornerPasses(snapshot: Snapshot, cornerId: string) {
  const eligible = new Set(
    snapshot.laps.filter((l) => l.coachingEligible).map((l) => l.id),
  );
  const seen = new Set<string>();
  return snapshot.evidence
    .filter(
      (e) =>
        e.cornerId === cornerId &&
        !e.quality.length &&
        eligible.has(e.lapId) &&
        metricValue(e, "elapsed", "ms") !== undefined &&
        e.metrics.elapsed.value! > 0,
    )
    .sort(
      (a, b) =>
        a.metrics.elapsed.value! - b.metrics.elapsed.value! ||
        a.lapId.localeCompare(b.lapId),
    )
    .filter((e) => {
      if (seen.has(e.lapId)) return false;
      seen.add(e.lapId);
      return true;
    });
}
export function cornerReview(
  snapshot: Snapshot,
  sessions: Session[],
  settings: EngineerSettings,
  cornerId: string,
  points = 72,
) {
  if (!Number.isInteger(points) || points < 8 || points > 120)
    throw Error("invalid_corner_resolution");
  const corner = snapshot.corners.find((c) => c.id === cornerId);
  if (!corner) throw Error("unknown_corner");
  const ranked = cornerPasses(snapshot, cornerId),
    top = ranked.slice(0, 3);
  const reference = snapshot.evidence.find(
    (e) => e.cornerId === cornerId && e.lapId === snapshot.referenceId,
  );
  const source =
    top.some((e) => e.lapId === reference?.lapId) ||
    !reference ||
    reference.quality.length
      ? top
      : [...top, reference];
  const rs = sessions.find((s) =>
    s.laps.some((l) => l.id === snapshot.referenceId),
  );
  const rl = rs?.laps.find((l) => l.id === snapshot.referenceId);
  const ref = rs && rl ? trace(rs, rl) : undefined;
  const passes = source.map((e) => {
    const s = sessions.find((s) => s.id === e.sessionId),
      l = s?.laps.find((l) => l.id === e.lapId);
    const t = s && l && ref ? align(trace(s, l), ref) : undefined;
    const signals = s ? normalize(s, settings.mappings[s.id] ?? []) : [];
    const speed = signals.find((s) => s.semantic === "speed")?.channel;
    const axes = t ? forceAxes(t, signals) : undefined;
    const rows = Array.from({ length: points }, (_, i) => {
      const distance =
        corner.start + ((corner.end - corner.start) * i) / (points - 1);
      const time = t ? interpolate(t.distance, t.times, distance) : NaN;
      const round = (v: number) =>
        Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
      return [
        round(distance),
        round(sample(speed, time)),
        round(sample(axes?.longitudinal.channel, time) / G),
        round(sample(axes?.lateral.channel, time) / G),
      ];
    });
    return {
      evidenceId: e.id,
      lapId: e.lapId,
      lapNumber: snapshot.laps.find((l) => l.id === e.lapId)?.number,
      recording: snapshot.sessionIds.indexOf(e.sessionId) + 1,
      rank: top.findIndex((x) => x.id === e.id) + 1 || null,
      isReviewLap: e.lapId === snapshot.referenceId,
      metrics: e.metrics,
      lapIssues: snapshot.laps.find((l) => l.id === e.lapId)?.issues ?? [],
      forces: {
        longitudinal: {
          source: axes?.longitudinal.source ?? "unavailable",
          note: axes?.longitudinal.note ?? "No trace",
        },
        lateral: {
          source: axes?.lateral.source ?? "unavailable",
          note: axes?.lateral.note ?? "No trace",
        },
      },
      rows,
    };
  });
  return {
    snapshotId: snapshot.id,
    corner,
    eligiblePasses: ranked.length,
    topThreeIds: top.map((e) => e.id),
    referenceId: reference?.id ?? null,
    columns: ["distanceM", "speedMps", "longitudinalG", "lateralG"],
    passes,
    limitations: [
      "Ranked by elapsed time in this common section, not total lap time. Up to three distinct eligible passes; no invented third pass.",
      "Unaffected windows on GPS-gap laps remain eligible; flagged whole-lap times are not used as clean progression evidence.",
      "Signed G axes are interpolated with a 500 ms gap limit; null means unavailable. GPS estimates are not accelerometer measurements, brake inputs, tyre forces or evidence of unused grip.",
      "Compare timing and simultaneous speed/G traces across all top passes. Higher G or a faster sample alone does not establish better technique. Unknown traffic, setup, tyres, banking, conditions and driver remain confounders.",
      "Automatic review windows are not verified individual corners; adjust boundaries where needed.",
    ],
  };
}
export type CornerReview = ReturnType<typeof cornerReview>;
export function mergeReviews(
  previous: Report | undefined,
  next: Report,
): Report {
  if (!previous || previous.snapshotId !== next.snapshotId) return next;
  const corners = new Map(
    (previous.cornerReviews ?? []).map((c) => [c.cornerId, c]),
  );
  for (const c of next.cornerReviews ?? []) corners.set(c.cornerId, c);
  return {
    ...previous,
    ...next,
    priorities: next.debrief ? next.priorities : previous.priorities,
    ...((next.debrief ?? previous.debrief)
      ? { debrief: next.debrief ?? previous.debrief }
      : {}),
    ...(corners.size ? { cornerReviews: [...corners.values()] } : {}),
  };
}
