import type { Lap, Session, FinishLine } from "./model";
import { lower } from "./analysis";

const R = 6371000;
const rad = Math.PI / 180;
// Metres east and north of a reference point, good over the size of a circuit.
const local = (lat: number, lon: number, lat0: number, lon0: number) => [
  (lon - lon0) * rad * R * Math.cos(lat0 * rad),
  (lat - lat0) * rad * R,
];

// Marks laps the analysis should treat with care. Shared by every import format.
export function flagLaps(laps: Lap[], times: ArrayLike<number>) {
  const durations = laps.map((l) => l.end - l.start).sort((a, b) => a - b);
  const median = durations[Math.floor((durations.length - 1) / 2)];
  for (const l of laps) {
    if (l.end - l.start > median * 1.8)
      l.issues.push("Interrupted lap: unusually long duration");
    if (l.start < times[0] || l.end > times[times.length - 1])
      l.issues.push("Incomplete GPS coverage");
    for (let i = lower(times, l.start) || 1; i < times.length; i++) {
      if (times[i - 1] > l.end) break;
      if (times[i] >= l.start && times[i] - times[i - 1] > 2000) {
        l.issues.push("GPS gap longer than 2 seconds");
        break;
      }
    }
  }
}

// Direction of travel in degrees clockwise from north at a sample, from about 10 m of path.
export function headingAt(
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  index: number,
) {
  let a = index,
    b = index;
  const dist = (i: number, j: number) => {
    const [x, y] = local(lat[j], lon[j], lat[i], lon[i]);
    return Math.hypot(x, y);
  };
  while (a > 0 && dist(a, index) < 5) a--;
  while (b < lat.length - 1 && dist(b, index) < 5) b++;
  const [x, y] = local(lat[b], lon[b], lat[a], lon[a]);
  return (Math.atan2(x, y) / rad + 360) % 360;
}

const HALF_WIDTH = 30; // metres each side of the centre of the line
// Times, in ms, at which the path crosses the line in its direction of travel, worked out
// to a fraction of a sample. Crossings closer together than `minLapMs` count once.
export function crossings(
  times: ArrayLike<number>,
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  line: FinishLine,
  minLapMs = 20000,
) {
  const out: number[] = [];
  const dir = [Math.sin(line.heading * rad), Math.cos(line.heading * rad)];
  const across = [-dir[1], dir[0]];
  for (let i = 0; i < times.length - 1; i++) {
    // Positions relative to the centre of the line, rotated so x runs along the travel.
    const [px, py] = local(lat[i], lon[i], line.lat, line.lon);
    const [qx, qy] = local(lat[i + 1], lon[i + 1], line.lat, line.lon);
    const p = [px * dir[0] + py * dir[1], px * across[0] + py * across[1]];
    const q = [qx * dir[0] + qy * dir[1], qx * across[0] + qy * across[1]];
    if (!(p[0] < 0 && q[0] >= 0)) continue;
    const u = -p[0] / (q[0] - p[0]);
    const side = p[1] + u * (q[1] - p[1]);
    if (Math.abs(side) > HALF_WIDTH) continue;
    const t = times[i] + u * (times[i + 1] - times[i]);
    if (!out.length || t - out[out.length - 1] >= minLapMs) out.push(t);
  }
  return out;
}

// Complete laps between consecutive crossings. The partial laps at either end are dropped.
export function lapsFromLine(
  id: string,
  times: ArrayLike<number>,
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  line: FinishLine,
): Lap[] {
  const c = crossings(times, lat, lon, line);
  const laps: Lap[] = [];
  for (let i = 0; i + 1 < c.length; i++)
    laps.push({
      id: `${id}:${i + 1}`,
      number: i + 1,
      start: c[i],
      end: c[i + 1],
      issues: [],
    });
  flagLaps(laps, times);
  return laps;
}

// The finish line a session used, from where its laps begin. Needs at least two laps whose
// starts agree to within 40 m, otherwise there is no line to trust.
export function lineFromSession(s: Session): FinishLine | null {
  if (s.laps.length < 2) return null;
  const at = (t: number, arr: ArrayLike<number>) => {
    const i = lower(s.times, t);
    if (i <= 0) return arr[0];
    if (i >= s.times.length) return arr[arr.length - 1];
    const f = (t - s.times[i - 1]) / (s.times[i] - s.times[i - 1]);
    return arr[i - 1] + f * (arr[i] - arr[i - 1]);
  };
  const pts = s.laps.map((l) => [at(l.start, s.lat), at(l.start, s.lon)]);
  const lat0 = pts.reduce((n, p) => n + p[0], 0) / pts.length,
    lon0 = pts.reduce((n, p) => n + p[1], 0) / pts.length;
  const spread = Math.max(
    ...pts.map((p) => Math.hypot(...local(p[0], p[1], lat0, lon0))),
  );
  if (spread > 40) return null;
  const i = lower(s.times, s.laps[0].start);
  return {
    lat: lat0,
    lon: lon0,
    heading: headingAt(
      s.lat,
      s.lon,
      Math.min(s.lat.length - 1, Math.max(0, i)),
    ),
    source: "session",
  };
}

// Smallest distance in metres from a point to the path.
export function distanceToPath(
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  point: { lat: number; lon: number },
) {
  let best = Infinity;
  for (let i = 0; i < lat.length; i++) {
    const [x, y] = local(lat[i], lon[i], point.lat, point.lon);
    best = Math.min(best, Math.hypot(x, y));
  }
  return best;
}

// A finish line at the point where a given lap begins, for a track whose laps come from
// the device and so has no stored line.
export function lineAtStart(s: Session, lap: Lap): FinishLine {
  const i = Math.min(
    s.times.length - 1,
    Math.max(0, lower(s.times, lap.start)),
  );
  return {
    lat: s.lat[i],
    lon: s.lon[i],
    heading: headingAt(s.lat, s.lon, i),
    source: "session",
  };
}
