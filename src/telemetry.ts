import type { Trace } from "./model";
import { brakingRuns } from "./analysis";

// Check the whole selected lap, so zooming into an outage does not hide a chart.
export function availableChannels(traces: (Trace | undefined)[]) {
  const channels = new Set<string>();
  for (const trace of traces) {
    if (!trace) continue;
    for (const [id, values] of Object.entries(trace.channels))
      if (values.some(Number.isFinite)) channels.add(id);
  }
  return channels;
}
export type BrakePoint = { start: number; end: number };
export type BrakePair = { a?: BrakePoint; b?: BrakePoint };
export type BrakeMarker = {
  trace: Trace;
  color: string;
  label: string;
  distance: number;
};
export function brakingPoints(t: Trace): BrakePoint[] {
  return brakingRuns(t).flatMap(([from, to]) => {
    // A zone that starts immediately after an outage has no observed onset.
    if (
      from === 0 ||
      t.times[from] - t.times[from - 1] > 2000 ||
      !Number.isFinite(t.lat[from - 1]) ||
      !Number.isFinite(t.lon[from - 1]) ||
      !Number.isFinite(t.lat[from]) ||
      !Number.isFinite(t.lon[from])
    )
      return [];
    return [{ start: t.distance[from], end: t.distance[to] }];
  });
}
// Pair nearby onsets on the common distance axis. Mutual nearest matches avoid
// pairing two unrelated corners when one lap has an extra braking event.
export function matchBrakePoints(
  a: BrakePoint[],
  b: BrakePoint[],
  maxOffset = 100,
): BrakePair[] {
  const nearest = (point: BrakePoint, candidates: BrakePoint[]) => {
    let best = -1,
      distance = maxOffset + 1;
    candidates.forEach((candidate, i) => {
      const offset = Math.abs(candidate.start - point.start);
      if (offset <= maxOffset && offset < distance) {
        best = i;
        distance = offset;
      }
    });
    return best;
  };
  const used = new Set<number>();
  const rows: BrakePair[] = a.map((point, i) => {
    const j = nearest(point, b);
    if (j >= 0 && nearest(b[j], a) === i) {
      used.add(j);
      return { a: point, b: b[j] };
    }
    return { a: point };
  });
  b.forEach((point, i) => {
    if (!used.has(i)) rows.push({ b: point });
  });
  return rows.sort(
    (x, y) => (x.a?.start ?? x.b!.start) - (y.a?.start ?? y.b!.start),
  );
}
