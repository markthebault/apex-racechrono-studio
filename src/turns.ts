import { interpolate } from "./analysis";
import type { Trace } from "./model";
import { physicalCurvature } from "./raceEngineer/signals";
export type DetectedTurn = {
  id: string;
  number: number;
  label: string;
  start: number;
  end: number;
  position: number;
  direction: "left" | "right";
};
// Half the previous magnification: show twice the padded corner distance.
// Shared by map markers, the turn picker and MCP navigation.
export function turnFocusRange(
  turn: Pick<DetectedTurn, "start" | "end">,
  lapLength: number,
): [number, number] {
  const center = (turn.start + turn.end + 20) / 2;
  const halfWidth = turn.end - turn.start + 80;
  return [
    Math.max(0, center - halfWidth),
    Math.min(lapLength, center + halfWidth),
  ];
}
// Place a label halfway through the accumulated turn angle. A brief entry
// curvature spike should not move the label away from the body of the corner.
function bendPosition(
  ref: Trace,
  curvature: Float64Array,
  start: number,
  end: number,
  sign: number,
) {
  const physical = ref.rawDistance ?? ref.distance;
  const from = interpolate(ref.distance, physical, start),
    to = interpolate(ref.distance, physical, end);
  const count = Math.ceil((to - from) / 2);
  if (!Number.isFinite(count) || count < 1) return (start + end) / 2;
  const distances: number[] = [],
    angle: number[] = [];
  let previousK = 0;
  for (let i = 0; i <= count; i++) {
    const d = Math.min(to, from + i * 2);
    const k = Math.max(0, sign * interpolate(physical, curvature, d));
    if (!Number.isFinite(k)) return (start + end) / 2;
    distances.push(d);
    angle.push(
      i ? angle[i - 1] + ((previousK + k) * (d - distances[i - 1])) / 2 : 0,
    );
    previousK = k;
  }
  const total = angle.at(-1)!;
  if (!(total > 0)) return (start + end) / 2;
  return interpolate(
    physical,
    ref.distance,
    interpolate(angle, distances, total / 2),
  );
}
// A geometric bend catalogue, separate from the engineer's padded 400 m review windows.
// Numbers follow reference progress from start/finish and are local to that reference.
export function detectTurns(
  ref: Trace,
  curvature = physicalCurvature(ref),
): DetectedTurn[] {
  const regions: {
    first: number;
    last: number;
    start: number;
    end: number;
    sign: number;
    angle: number;
  }[] = [];
  let active: (typeof regions)[number] | undefined;
  for (let i = 1; i < ref.distance.length; i++) {
    const d = ref.distance[i],
      ds =
        (ref.rawDistance ?? ref.distance)[i] -
        (ref.rawDistance ?? ref.distance)[i - 1];
    const k = curvature[i],
      v = (ref.channels.speed?.[i] ?? NaN) / 3.6;
    const dt = ref.times[i] - ref.times[i - 1];
    if (
      !Number.isFinite(k) ||
      !Number.isFinite(d) ||
      ds <= 0 ||
      ds > 20 ||
      dt <= 0 ||
      dt > 500
    ) {
      active = undefined;
      continue;
    }
    if (Math.abs(k) < 0.001 || !Number.isFinite(v) || v * v * Math.abs(k) < 0.6)
      continue;
    const sign = Math.sign(k);
    if (!active || active.sign !== sign || d - active.end > 35) {
      active = {
        first: i,
        last: i,
        start: d,
        end: d,
        sign,
        angle: 0,
      };
      regions.push(active);
    }
    active.last = i;
    active.end = d;
    active.angle += Math.abs(k) * ds;
  }
  // Brief low-curvature gaps still join noisy samples inside one bend. Look
  // inside each joined region for a sustained valley supported by substantial
  // turning on both sides. A connected double-apex bend can relax without
  // becoming straight; require more angular support before splitting that case.
  const physical = ref.rawDistance ?? ref.distance;
  const separated = regions.flatMap((region) => {
    const from = physical[region.first],
      to = physical[region.last];
    if (to - from < 50) return [region];
    const samples: { d: number; k: number }[] = [];
    const count = Math.ceil((to - from) / 2);
    for (let sample = 0; sample <= count; sample++) {
      const d = Math.min(to, from + sample * 2);
      const values = [-4, -2, 0, 2, 4].map((offset) =>
        Math.max(
          0,
          region.sign *
            interpolate(
              physical,
              curvature,
              Math.max(from, Math.min(to, d + offset)),
            ),
        ),
      );
      samples.push({ d, k: values.reduce((n, k) => n + k, 0) / values.length });
    }
    const area = [0];
    for (let i = 1; i < samples.length; i++)
      area.push(
        area[i - 1] +
          ((samples[i - 1].k + samples[i].k) *
            (samples[i].d - samples[i - 1].d)) /
            2,
      );
    const split = (lo: number, hi: number): { lo: number; hi: number }[] => {
      const left: number[] = [],
        right: number[] = [];
      for (let i = lo; i <= hi; i++)
        left[i] = Math.max(samples[i].k, left[i - 1] ?? 0);
      for (let i = hi; i >= lo; i--)
        right[i] = Math.max(samples[i].k, right[i + 1] ?? 0);
      let best = -1,
        bestScore = 0;
      for (let i = lo + 8; i <= hi - 8; i++) {
        const peak = Math.min(left[i], right[i]);
        if (peak < 0.001 || samples[i].k > peak * 0.6) continue;
        const nearStraight = samples[i].k <= peak * 0.25;
        const shoulder = peak * (nearStraight ? 0.5 : 0.75);
        const minimumAngle = nearStraight ? 0.2 : 0.4;
        let a = i,
          b = i;
        while (a > lo && samples[a - 1].k <= shoulder) a--;
        while (b < hi && samples[b + 1].k <= shoulder) b++;
        if (
          samples[b].d - samples[a].d < 12 ||
          samples[a].d - samples[lo].d < 15 ||
          samples[hi].d - samples[b].d < 15 ||
          area[a] - area[lo] < minimumAngle ||
          area[hi] - area[b] < minimumAngle
        )
          continue;
        if (!nearStraight) {
          // Both tightening points must last: a narrow GPS spike is not a
          // second apex. Short straight-separated bends retain the old gates.
          const sustainedPeak = (from: number, to: number) => {
            let start = from;
            for (let j = from; j <= to; j++) {
              if (samples[j].k < shoulder) start = j + 1;
              else if (samples[j].d - samples[start].d >= 20) return true;
            }
            return false;
          };
          if (!sustainedPeak(lo, a) || !sustainedPeak(b, hi)) continue;
        }
        const score = 1 - samples[i].k / peak;
        if (score > bestScore) {
          best = i;
          bestScore = score;
        }
      }
      return best < 0 ? [{ lo, hi }] : [...split(lo, best), ...split(best, hi)];
    };
    const parts = split(0, samples.length - 1);
    if (parts.length === 1) return [region];
    return parts.map(({ lo, hi }) => {
      return {
        ...region,
        start: interpolate(physical, ref.distance, samples[lo].d),
        end: interpolate(physical, ref.distance, samples[hi].d),
        angle: area[hi] - area[lo],
      };
    });
  });
  return separated
    .filter((r) => r.end - r.start >= 15 && r.angle >= 0.2)
    .slice(0, 200)
    .map((r, i) => ({
      id: `T${i + 1}`,
      number: i + 1,
      label: `T${i + 1}`,
      start: r.start,
      end: r.end,
      position: bendPosition(ref, curvature, r.start, r.end, r.sign),
      direction: r.sign > 0 ? "left" : "right",
    }));
}
export const turnLimitations =
  "Automatically detected GPS bends, numbered from the reference lap start. Not official circuit turn numbers or verified geometric apexes. Numbers can change when the reference recording or track scope changes. Engineer review windows may split or combine turns.";
