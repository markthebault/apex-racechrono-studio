import { interpolate, lower, metres } from "../analysis";
import type { Trace } from "../model";
import type { Corner, Evidence, Priority, Report, Snapshot } from "./contracts";

export type FocusItem = {
  corner: Corner;
  reference?: Evidence;
  comparison?: Evidence;
  advice?: Report["priorities"][number];
  measured?: Priority;
  combined: boolean;
};
export const sectionName = (corner: Corner) =>
  corner.name.replace(/^Review window /, "Section ");
export function metricValue(
  e: Evidence | undefined,
  key: string,
  unit: string,
) {
  const metric = e?.metrics[key];
  return metric?.unit === unit &&
    metric.value !== null &&
    Number.isFinite(metric.value)
    ? metric.value
    : undefined;
}
export function focusItems(snapshot: Snapshot, report?: Report): FocusItem[] {
  const items = new Map<string, FocusItem>();
  for (const p of report?.priorities ?? snapshot.priorities) {
    const cited = snapshot.evidence.filter((e) => p.evidenceIds.includes(e.id));
    const corners = snapshot.corners.filter((c) =>
      cited.some((e) => e.cornerId === c.id),
    );
    for (const corner of corners) {
      if (items.has(corner.id)) continue;
      const reference = snapshot.evidence.find(
        (e) => e.cornerId === corner.id && e.lapId === snapshot.referenceId,
      );
      const comparison = cited
        .filter(
          (e) =>
            e.cornerId === corner.id &&
            e.lapId !== snapshot.referenceId &&
            !e.quality.length &&
            metricValue(e, "elapsed", "ms") !== undefined,
        )
        .sort((a, b) => a.metrics.elapsed.value! - b.metrics.elapsed.value!)[0];
      items.set(corner.id, {
        corner,
        reference,
        comparison,
        ...(report
          ? { advice: p as Report["priorities"][number] }
          : { measured: p as Priority }),
        combined: corners.length > 1,
      });
    }
  }
  return [...items.values()];
}
export const speedPoints = [
  { key: "entrySpeed", label: "Entry", at: "entry" },
  { key: "minimumSpeed", label: "Minimum", at: "minimum" },
  { key: "exitSpeed", label: "Exit", at: "exit" },
] as const;
export function focusCue(item: FocusItem) {
  return speedPoints
    .map((point) => {
      const a = metricValue(item.reference, point.key, "m/s"),
        b = metricValue(item.comparison, point.key, "m/s");
      return {
        ...point,
        difference:
          a === undefined || b === undefined ? undefined : Math.abs(a - b),
      };
    })
    .filter((p) => p.difference !== undefined)
    .sort((a, b) => b.difference! - a.difference!)[0];
}

type XY = { x: number; y: number };
type GPSPoint = { lat: number; lon: number; distance: number; move: boolean };
function atDistance(t: Trace, distance: number) {
  const time = interpolate(t.distance, t.times, distance);
  const lat = interpolate(t.times, t.lat, time, 2000),
    lon = interpolate(t.times, t.lon, time, 2000);
  return Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : undefined;
}
function gpsPoints(
  t: Trace,
  start: number,
  end: number,
  limit: number,
): GPSPoint[] {
  const points: GPSPoint[] = [];
  const first = Math.max(0, lower(t.distance, start) - 1),
    last = Math.min(t.times.length - 1, lower(t.distance, end));
  const stride = Math.max(1, Math.ceil((last - first) / limit));
  let move = true;
  for (let i = first; i <= last; i++) {
    if (!Number.isFinite(t.lat[i]) || !Number.isFinite(t.lon[i])) {
      move = true;
      continue;
    }
    if (i > first) {
      const dt = t.times[i] - t.times[i - 1];
      if (
        dt <= 0 ||
        dt > 2000 ||
        metres(t.lat[i - 1], t.lon[i - 1], t.lat[i], t.lon[i]) / (dt / 1000) >
          100
      )
        move = true;
    }
    if (move || (i - first) % stride === 0 || i === last) {
      points.push({
        lat: t.lat[i],
        lon: t.lon[i],
        distance: t.distance[i],
        move,
      });
      move = false;
    }
  }
  return points;
}
function projection(
  points: { lat: number; lon: number }[],
  box: { x: number; y: number; width: number; height: number },
) {
  const origin = points[0],
    cos = Math.cos((origin.lat * Math.PI) / 180);
  const metric = (p: { lat: number; lon: number }) => ({
    x: (p.lon - origin.lon) * cos * 111195,
    y: -(p.lat - origin.lat) * 111195,
  });
  const raw = points.map(metric),
    xs = raw.map((p) => p.x),
    ys = raw.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.min(
    box.width / Math.max(maxX - minX, 1),
    box.height / Math.max(maxY - minY, 1),
  );
  return (p: { lat: number; lon: number }): XY => {
    const xy = metric(p);
    return {
      x: box.x + box.width / 2 + (xy.x - (minX + maxX) / 2) * scale,
      y: box.y + box.height / 2 + (xy.y - (minY + maxY) / 2) * scale,
    };
  };
}
function path(points: GPSPoint[], project: (p: GPSPoint) => XY) {
  return points
    .map((p, i) => {
      const xy = project(p);
      return `${i === 0 || p.move ? "M" : "L"}${xy.x.toFixed(2)},${xy.y.toFixed(2)}`;
    })
    .join(" ");
}
export function trackPicture(t: Trace, corner: Corner, minimum?: number) {
  const local = gpsPoints(
    t,
    Math.max(0, corner.start - 65),
    Math.min(t.length, corner.end + 65),
    500,
  );
  const region = gpsPoints(t, corner.start, corner.end, 400).filter(
    (p) => p.distance >= corner.start && p.distance <= corner.end,
  );
  const whole = gpsPoints(t, 0, t.length, 900);
  if (
    local.length < 2 ||
    region.length < 2 ||
    whole.length < 2 ||
    !region.some((p, i) => i > 0 && !p.move)
  )
    return;
  const start = atDistance(t, corner.start),
    end = atDistance(t, corner.end);
  const min =
    minimum === undefined || minimum < corner.start || minimum > corner.end
      ? undefined
      : atDistance(t, minimum);
  const project = projection(local, { x: 42, y: 100, width: 476, height: 195 });
  const inset = projection(whole, { x: 465, y: 15, width: 115, height: 62 });
  return {
    context: path(local, project),
    section: path(region, project),
    whole: path(whole, inset),
    location: path(region, inset),
    markers: {
      entry: start && project(start),
      minimum: min && project(min),
      exit: end && project(end),
    },
  };
}
