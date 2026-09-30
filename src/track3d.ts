import type { Trace } from "./model";
import { atDistance } from "./analysis";

export type TrackPoint = {
  x: number;
  y: number;
  z: number;
  index: number;
  distance: number;
};
export function trackFrame(t: Trace) {
  const valid = Array.from(t.lat.keys()).filter(
    (i) => Number.isFinite(t.lat[i]) && Number.isFinite(t.lon[i]),
  );
  if (!valid.length) return undefined;
  const lat = valid.reduce((sum, i) => sum + t.lat[i], 0) / valid.length;
  const lon = valid.reduce((sum, i) => sum + t.lon[i], 0) / valid.length;
  const altitude = t.channels.altitude;
  const heights = valid.map((i) => altitude?.[i]).filter(Number.isFinite);
  const low = heights.reduce((a, b) => Math.min(a, b), Infinity);
  const high = heights.reduce((a, b) => Math.max(a, b), -Infinity);
  return {
    lat,
    lon,
    base: heights.length ? low : 0,
    relief: heights.length ? high - low : 0,
    hasElevation: heights.length > 1,
    partialElevation: heights.length > 0 && heights.length < valid.length,
  };
}
export type TrackFrame = NonNullable<ReturnType<typeof trackFrame>>;
export function project(
  lat: number,
  lon: number,
  altitude: number,
  frame: TrackFrame,
  exaggeration: number,
) {
  return {
    x:
      (((lon - frame.lon) * Math.PI) / 180) *
      6371000 *
      Math.cos((frame.lat * Math.PI) / 180),
    y: (altitude - frame.base) * exaggeration,
    z: ((-(lat - frame.lat) * Math.PI) / 180) * 6371000,
  };
}
// Keep every sample, so a missing fix or an outage never becomes a bridge in 3D.
export function trackSegments(
  t: Trace,
  frame: TrackFrame,
  exaggeration: number,
): TrackPoint[][] {
  const segments: TrackPoint[][] = [];
  let part: TrackPoint[] = [];
  for (let i = 0; i < t.lat.length; i++) {
    const altitude = frame.hasElevation ? t.channels.altitude?.[i] : frame.base;
    const valid =
      Number.isFinite(t.lat[i]) &&
      Number.isFinite(t.lon[i]) &&
      Number.isFinite(altitude);
    if (!valid || (i > 0 && t.times[i] - t.times[i - 1] > 2000)) {
      if (part.length > 1) segments.push(part);
      part = [];
    }
    if (valid)
      part.push({
        ...project(t.lat[i], t.lon[i], altitude, frame, exaggeration),
        index: i,
        distance: t.distance[i],
      });
  }
  if (part.length > 1) segments.push(part);
  return segments;
}
export function trackPosition(
  t: Trace,
  d: number,
  frame: TrackFrame,
  exaggeration: number,
) {
  const lat = atDistance(t, t.lat, d),
    lon = atDistance(t, t.lon, d);
  const altitude = frame.hasElevation
    ? atDistance(t, t.channels.altitude ?? [], d)
    : frame.base;
  return [lat, lon, altitude].every(Number.isFinite)
    ? project(lat, lon, altitude, frame, exaggeration)
    : undefined;
}

// Three.js accepts comma-separated HSL; the 2D palette uses CSS space syntax.
export function trackColor(css: string) {
  return css.replace(/hsl\((\d+) (\d+)% (\d+)%\)/, "hsl($1,$2%,$3%)");
}
