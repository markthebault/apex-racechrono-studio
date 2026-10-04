import type { Binding, Session } from "./model";
import type { GpsSample } from "./videoTelemetry";
import { interpolate, metres } from "./analysis";
const valid = (p: GpsSample) =>
  p.fix >= 2 &&
  Number.isFinite(p.t) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180 &&
  (p.dop === undefined || !Number.isFinite(p.dop) || p.dop <= 10);
const median = (v: number[]) => {
  const sorted = [...v].sort((a, b) => a - b);
  return sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};
export type GpsProposal = {
  anchor: Binding["anchors"][number];
  samples: number;
  clockSpreadMs: number;
  distanceMetres: number;
  overlapSeconds: number;
};
export function proposeGpsClock(
  gps: GpsSample[],
  session: Session,
  clipStart: number,
): GpsProposal {
  const points = gps.filter((p) => valid(p) && Number.isFinite(p.utc));
  if (points.length < 3)
    throw Error("At least three GPS fixes with UTC timestamps are needed.");
  const clock = median(points.map((p) => p.utc! - p.t * 1000));
  const spread = median(
    points.map((p) => Math.abs(p.utc! - p.t * 1000 - clock)),
  );
  if (spread > 500)
    throw Error(
      "Camera GPS timestamps are inconsistent. Use manual alignment.",
    );
  const overlap = points.filter(
    (p) =>
      clock + p.t * 1000 >= session.start && clock + p.t * 1000 <= session.end,
  );
  if (overlap.length < 3)
    throw Error(
      "Camera GPS time does not overlap this session. Check the recording or use GPS route matching.",
    );
  const distances = overlap
    .map((p) =>
      metres(
        p.lat,
        p.lon,
        interpolate(session.times, session.lat, clock + p.t * 1000, 2000),
        interpolate(session.times, session.lon, clock + p.t * 1000, 2000),
      ),
    )
    .filter(Number.isFinite);
  if (distances.length < 3)
    throw Error("The session has no GPS coverage at the camera timestamps.");
  const distance = median(distances);
  if (distance > 100)
    throw Error(
      "GPS timestamps overlap, but the routes differ by more than 100 metres. Use another recording or GPS route matching.",
    );
  return {
    anchor: { videoSeconds: clipStart, sessionTimestamp: clock },
    samples: overlap.length,
    clockSpreadMs: spread,
    distanceMetres: distance,
    overlapSeconds: overlap.at(-1)!.t - overlap[0].t,
  };
}
// Search an offset with multiple positions and speed changes, rather than matching one
// position which can recur on every lap. Never silently apply an ambiguous match.
export function proposeGpsRoute(
  gps: GpsSample[],
  session: Session,
  clipStart: number,
): GpsProposal {
  const validPoints = gps.filter(valid),
    first = validPoints[0];
  if (!first || validPoints.at(-1)!.t - first.t < 8)
    throw Error(
      "GPS route matching needs at least eight seconds of camera GPS.",
    );
  const sample = validPoints
    .filter(
      (_, i) => i % Math.max(1, Math.floor(validPoints.length / 60)) === 0,
    )
    .slice(0, 60);
  const moving =
    sample.some((p) => (p.speed ?? 0) > 3) ||
    metres(first.lat, first.lon, sample.at(-1)!.lat, sample.at(-1)!.lon) > 20;
  if (!moving)
    throw Error(
      "This GPS section is stationary. Choose a section with movement.",
    );
  const candidates: { clock: number; score: number; n: number }[] = [];
  const stride = Math.max(1, Math.floor(session.times.length / 4000));
  for (let i = 0; i < session.times.length; i += stride) {
    if (metres(first.lat, first.lon, session.lat[i], session.lon[i]) > 80)
      continue;
    const clock = session.times[i] - first.t * 1000,
      distances: number[] = [];
    for (const p of sample) {
      const t = clock + p.t * 1000;
      const lat = interpolate(session.times, session.lat, t, 2000),
        lon = interpolate(session.times, session.lon, t, 2000);
      if (Number.isFinite(lat) && Number.isFinite(lon))
        distances.push(metres(p.lat, p.lon, lat, lon));
    }
    if (distances.length >= Math.max(3, sample.length * 0.7))
      candidates.push({
        clock,
        score: distances.reduce((a, b) => a + b, 0) / distances.length,
        n: distances.length,
      });
  }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  if (!best || best.score > 30)
    throw Error("No matching GPS route found within 30 metres.");
  const competing = candidates.find(
    (p) => Math.abs(p.clock - best.clock) > 5000,
  );
  if (competing && competing.score < Math.max(best.score * 1.5, best.score + 5))
    throw Error(
      "Several laps match this GPS route. Use GPS UTC or a manual braking point.",
    );
  return {
    anchor: { videoSeconds: clipStart, sessionTimestamp: best.clock },
    samples: best.n,
    clockSpreadMs: 0,
    distanceMetres: best.score,
    overlapSeconds: sample.at(-1)!.t - first.t,
  };
}
