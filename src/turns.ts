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
    position: number;
    sign: number;
    peak: number;
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
        position: d,
        sign,
        peak: Math.abs(k),
        angle: 0,
      };
      regions.push(active);
    }
    active.last = i;
    active.end = d;
    active.angle += Math.abs(k) * ds;
    if (Math.abs(k) > active.peak) {
      active.position = d;
      active.peak = Math.abs(k);
    }
  }
  // Brief low-curvature gaps still join noisy samples inside one bend. Look
  // inside each joined region for a sustained valley supported by substantial
  // turning on both sides, so a short straight does not hide a second corner.
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
        if (peak < 0.001 || samples[i].k > peak * 0.25) continue;
        let a = i,
          b = i;
        while (a > lo && samples[a - 1].k <= peak * 0.5) a--;
        while (b < hi && samples[b + 1].k <= peak * 0.5) b++;
        if (
          samples[b].d - samples[a].d < 12 ||
          samples[a].d - samples[lo].d < 15 ||
          samples[hi].d - samples[b].d < 15 ||
          area[a] - area[lo] < 0.2 ||
          area[hi] - area[b] < 0.2
        )
          continue;
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
      let peak = lo;
      for (let i = lo + 1; i <= hi; i++)
        if (samples[i].k > samples[peak].k) peak = i;
      return {
        ...region,
        start: interpolate(physical, ref.distance, samples[lo].d),
        end: interpolate(physical, ref.distance, samples[hi].d),
        position: interpolate(physical, ref.distance, samples[peak].d),
        angle: area[hi] - area[lo],
        peak: samples[peak].k,
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
      position: r.position,
      direction: r.sign > 0 ? "left" : "right",
    }));
}
export const turnLimitations =
  "Automatically detected GPS bends, numbered from the reference lap start. Not official circuit turn numbers or verified geometric apexes. Numbers can change when the reference recording or track scope changes. Engineer review windows may split or combine turns.";
