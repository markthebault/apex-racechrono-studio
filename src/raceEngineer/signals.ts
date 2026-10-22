import type { Channel, Session, Trace } from "../model";
import { interpolate, lower, metres } from "../analysis";
import {
  type Capability,
  type Mapping,
  type Metric,
  type Quality,
  type Semantic,
} from "./contracts";
export const G = 9.80665;
export const median = (v: number[]) => quantile(v, 0.5);
export function quantile(v: number[], q: number) {
  const a = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (!a.length) return NaN;
  const index = (a.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(index),
    upper = Math.ceil(index);
  return a[lower] + (a[upper] - a[lower]) * (index - lower);
}
const qualities = new WeakMap<object, Quality>();
export function quality(c: Pick<Channel, "times" | "values">): Quality {
  const cached = qualities.get(c);
  if (cached) return cached;
  const dt: number[] = [];
  let gaps = 0,
    valid = 0;
  for (let i = 0; i < c.times.length; i++) {
    if (Number.isFinite(c.values[i])) valid++;
    if (i) {
      const d = c.times[i] - c.times[i - 1];
      if (d > 0) dt.push(d);
      if (d > 2000 || d <= 0) gaps++;
    }
  }
  const intervalMs = median(dt);
  const reasons = [];
  if (!Number.isFinite(intervalMs)) reasons.push("Insufficient samples");
  if (intervalMs > 500)
    reasons.push("Coarse sampling: engineering derivatives unavailable");
  if (gaps) reasons.push("Gaps or invalid timestamp order");
  if (valid < c.times.length) reasons.push("Non-finite samples");
  const result = {
    intervalMs: Number.isFinite(intervalMs) ? intervalMs : null,
    coverage: c.times.length ? valid / c.times.length : 0,
    gaps,
    reasons,
  };
  qualities.set(c, result);
  return result;
}
function unitScale(semantic: Semantic, unit: string) {
  const speed = semantic === "speed" || semantic.startsWith("wheel");
  if (speed)
    return (
      { "km/h": 1 / 3.6, "m/s": 1, mph: 0.44704 } as Record<string, number>
    )[unit];
  if (semantic === "lateral" || semantic === "longitudinal")
    return ({ g: G, "m/s²": 1, "m/s2": 1 } as Record<string, number>)[unit];
  if (semantic === "brakePressure")
    return (
      { bar: 1, kPa: 0.01, Pa: 0.00001, psi: 0.0689476 } as Record<
        string,
        number
      >
    )[unit];
  if (semantic === "brakeSwitch") return unit === "boolean" ? 1 : undefined;
  if (semantic === "rpm") return unit === "rpm" ? 1 : undefined;
  return unit === "%" ? 1 : undefined;
}
export const canonicalUnit = (s: Semantic) =>
  s === "speed" || s.startsWith("wheel")
    ? "m/s"
    : s === "lateral" || s === "longitudinal"
      ? "m/s²"
      : s === "rpm"
        ? "rpm"
        : s === "brakePressure"
          ? "bar"
          : s === "brakeSwitch"
            ? "boolean"
            : "%";
export type Signal = {
  semantic: Semantic;
  channel: Channel;
  capability: Capability;
};
export function normalize(s: Session, mappings: Mapping[]): Signal[] {
  const presets: Mapping[] = (["speed", "throttle", "rpm"] as const).flatMap(
    (id) => {
      const c = s.channels.find((c) => c.id === id);
      // These IDs have a verified importer definition; raw names are never presets.
      return c
        ? [
            {
              channel: id,
              semantic: id,
              unit: c.unit,
              scale: 1,
              offset: 0,
              confirmed: true,
            },
          ]
        : [];
    },
  );
  const result: Signal[] = [];
  for (const m of [
    ...presets.filter((p) => !mappings.some((m) => m.semantic === p.semantic)),
    ...mappings,
  ]) {
    const c = s.channels.find((c) => c.id === m.channel);
    const factor = unitScale(m.semantic, m.unit);
    if (
      !m.confirmed ||
      !c ||
      factor === undefined ||
      !Number.isFinite(m.scale) ||
      !Number.isFinite(m.offset)
    )
      continue;
    const channel = {
      ...c,
      unit: canonicalUnit(m.semantic),
      values: Float64Array.from(
        c.values,
        (x) => (x * m.scale + m.offset) * factor,
      ),
    };
    result.push({
      semantic: m.semantic,
      channel,
      capability: {
        semantic: m.semantic,
        channel: c.id,
        unit: channel.unit,
        source: c.source,
        quality: quality(channel),
        confidence: mappings.includes(m) ? "user-confirmed" : "preset",
      },
    });
  }
  return result;
}
// Local linear regression on native timestamps. No interpolation over outages;
// a full centered 0.6 s window is required, with at least 3 samples at >=2 Hz.
const derivatives = new WeakMap<Channel, Channel>();
export function derivative(c: Channel): Channel {
  const cached = derivatives.get(c);
  if (cached) return cached;
  const q = quality(c);
  const values = Float64Array.from(c.values, (_, i) => {
    if (!q.intervalMs || q.intervalMs > 500) return NaN;
    const a = lower(c.times, c.times[i] - 300),
      b = lower(c.times, c.times[i] + 300 + 1e-3);
    if (
      b - a < 3 ||
      c.times[i] - c.times[a] < 200 ||
      c.times[b - 1] - c.times[i] < 200
    )
      return NaN;
    let xx = 0,
      xy = 0,
      x = 0,
      y = 0;
    for (let j = a; j < b; j++) {
      if (
        !Number.isFinite(c.values[j]) ||
        (j > a && c.times[j] - c.times[j - 1] > Math.max(500, 3 * q.intervalMs))
      )
        return NaN;
      const t = (c.times[j] - c.times[i]) / 1000;
      x += t;
      y += c.values[j];
      xx += t * t;
      xy += t * c.values[j];
    }
    const n = b - a;
    return (xy - (x * y) / n) / (xx - (x * x) / n);
  });
  const result = {
    ...c,
    id: "derived-longitudinal",
    name: "Kinematic longitudinal acceleration",
    unit: "m/s²",
    values,
    source: "native-speed/local-linear-0.6s/v1",
  };
  derivatives.set(c, result);
  return result;
}
const curvatures = new WeakMap<Trace, Float64Array>();
export function physicalCurvature(t: Trace): Float64Array {
  const cached = curvatures.get(t);
  if (cached) return cached;
  const d = t.rawDistance ?? t.distance;
  const result = Float64Array.from(d, (_, i) => {
    const a = lower(d, d[i] - 12),
      b = Math.min(d.length - 1, lower(d, d[i] + 12));
    if (
      a >= i ||
      b <= i ||
      d[i] - d[a] < 8 ||
      d[b] - d[i] < 8 ||
      t.times[b] - t.times[a] > 5000
    )
      return NaN;
    for (let j = a + 1; j <= b; j++) {
      const dt = t.times[j] - t.times[j - 1];
      const step = metres(t.lat[j - 1], t.lon[j - 1], t.lat[j], t.lon[j]);
      if (
        dt > 500 ||
        dt <= 0 ||
        step / (dt / 1000) > 100 ||
        !Number.isFinite(step)
      )
        return NaN;
    }
    const cos = Math.cos((t.lat[i] * Math.PI) / 180),
      k = 111195;
    const x1 = (t.lon[i] - t.lon[a]) * cos * k,
      y1 = (t.lat[i] - t.lat[a]) * k,
      x2 = (t.lon[b] - t.lon[i]) * cos * k,
      y2 = (t.lat[b] - t.lat[i]) * k;
    const denom =
      Math.hypot(x1, y1) * Math.hypot(x2, y2) * Math.hypot(x1 + x2, y1 + y2);
    return denom > 1 ? (2 * (x1 * y2 - y1 * x2)) / denom : NaN;
  });
  curvatures.set(t, result);
  return result;
}
export function sample(c: Channel | undefined, time: number) {
  return c ? interpolate(c.times, c.values, time, 500) : NaN;
}
export function metric(
  value: number,
  unit: string,
  kind: Metric["kind"],
  method: string,
  channel: string,
  reasons: string[] = [],
): Metric {
  return {
    value: Number.isFinite(value) ? value : null,
    unit,
    kind,
    method,
    channel,
    reasons: Number.isFinite(value)
      ? reasons
      : [...reasons, "Insufficient valid samples"],
  };
}
export function nativeWindow(
  c: Channel | undefined,
  from: number,
  to: number,
): { times: number[]; values: number[]; valid: boolean } {
  if (!c) return { times: [], values: [], valid: false };
  const a = lower(c.times, from),
    b = lower(c.times, to + 1e-3),
    times = Array.from(c.times.slice(a, b)),
    values = Array.from(c.values.slice(a, b));
  const q = quality(c);
  let valid =
    !!times.length &&
    sample(c, from) === sample(c, from) &&
    Number.isFinite(sample(c, to));
  for (let i = 0; i < times.length; i++)
    if (
      !Number.isFinite(values[i]) ||
      (i && times[i] - times[i - 1] > Math.max(500, 3 * (q.intervalMs ?? 0)))
    )
      valid = false;
  return { times, values, valid };
}
