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
        start: d,
        end: d,
        position: d,
        sign,
        peak: Math.abs(k),
        angle: 0,
      };
      regions.push(active);
    }
    active.end = d;
    active.angle += Math.abs(k) * ds;
    if (Math.abs(k) > active.peak) {
      active.position = d;
      active.peak = Math.abs(k);
    }
  }
  return regions
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
