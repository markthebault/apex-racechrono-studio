import { atDistance } from "./analysis";
import type { Trace } from "./model";
export const PLAYBACK_RATES = [0.25, 0.5, 1, 2] as const;
export function replayWindow(
  trace: Trace,
  range: [number, number],
): [number, number] | undefined {
  const from =
    range[0] <= 0 ? trace.times[0] : atDistance(trace, trace.times, range[0]);
  const to =
    range[1] >= trace.length
      ? trace.times.at(-1)!
      : atDistance(trace, trace.times, range[1]);
  return Number.isFinite(from) && Number.isFinite(to) && to > from
    ? [from, to]
    : undefined;
}
export function advanceReplay(
  time: number,
  wallMs: number,
  rate: number,
  bounds: [number, number],
  loop: boolean,
) {
  const [start, end] = bounds;
  const next = Math.max(start, time) + Math.max(0, wallMs) * rate;
  if (loop && end > start)
    return { time: start + ((next - start) % (end - start)), ended: false };
  return { time: Math.min(next, end), ended: next >= end };
}
