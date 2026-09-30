import type { Session, Trace, Lap } from "./model";
export function lower(a: ArrayLike<number>, v: number) {
  let lo = 0,
    hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (a[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}
export function interpolate(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  v: number,
  maxGap = Infinity,
) {
  if (!x.length || v < x[0] || v > x[x.length - 1]) return NaN;
  const i = lower(x, v);
  if (i === 0 || x[i] === v) return y[i];
  if (x[i] - x[i - 1] > maxGap) return NaN;
  const f = (v - x[i - 1]) / (x[i] - x[i - 1]);
  return y[i - 1] + f * (y[i] - y[i - 1]);
}
export function metres(a: number, b: number, c: number, d: number) {
  const r = Math.PI / 180;
  const x = (d - b) * r * Math.cos(((a + c) * r) / 2),
    y = (c - a) * r;
  return Math.hypot(x, y) * 6371000;
}
export function trace(s: Session, l: Lap): Trace {
  const first = lower(s.times, l.start),
    last = lower(s.times, l.end);
  const middle = Array.from(s.times.slice(first, last)).filter(
    (t) => t > l.start && t < l.end,
  );
  const times = Float64Array.from([l.start, ...middle, l.end]);
  const lat = Float64Array.from(times, (t) =>
    interpolate(s.times, s.lat, t, 2000),
  );
  const lon = Float64Array.from(times, (t) =>
    interpolate(s.times, s.lon, t, 2000),
  );
  const distance = new Float64Array(times.length);
  for (let i = 1; i < times.length; i++) {
    const d = metres(lat[i - 1], lon[i - 1], lat[i], lon[i]);
    distance[i] = distance[i - 1] + (Number.isFinite(d) ? d : 0);
  }
  const channels: Record<string, Float64Array> = {};
  for (const c of s.channels)
    channels[c.id] = Float64Array.from(times, (t) =>
      interpolate(
        c.times,
        c.values,
        t,
        c.id === "coolant" || c.id === "intake" ? 15000 : 2000,
      ),
    );
  if (channels.speed)
    channels.acceleration = Float64Array.from(times, (_, i) => {
      // Speed change over about half a second centred on the sample, whatever the log rate.
      const j = Math.min(i, lower(times, times[i] - 250)),
        k = Math.max(i, lower(times, times[i] + 250 + 1e-6) - 1);
      return times[k] - times[j] > 2000 || k === j
        ? NaN
        : (channels.speed[k] - channels.speed[j]) /
            3.6 /
            ((times[k] - times[j]) / 1000) /
            9.80665;
    });
  return {
    id: l.id,
    sessionId: s.id,
    label: `Lap ${l.number}`,
    lap: l,
    distance,
    times,
    lat,
    lon,
    channels,
    length: distance[distance.length - 1],
    issues: [...l.issues],
  };
}
// Ordered local projection prevents a nearest-point match jumping to another part of a circuit.
export function align(t: Trace, ref: Trace): Trace {
  if (t.id === ref.id) return t;
  if (
    metres(t.lat[0], t.lon[0], ref.lat[0], ref.lon[0]) > 150 ||
    metres(t.lat.at(-1)!, t.lon.at(-1)!, ref.lat.at(-1)!, ref.lon.at(-1)!) > 150
  )
    return {
      ...t,
      issues: [...t.issues, "Incompatible start or finish gates"],
    };
  const indices: number[] = [];
  for (let i = 0; i < ref.times.length; i++)
    if (
      i === 0 ||
      ref.distance[i] - ref.distance[indices.at(-1)!] > 8 ||
      i === ref.times.length - 1
    )
      indices.push(i);
  const out = new Float64Array(t.times.length);
  let cursor = 0,
    bad = 0;
  for (let i = 0; i < t.times.length; i++) {
    let best = Infinity,
      at = cursor,
      progress = 0;
    for (
      let j = Math.max(0, cursor - 3);
      j < Math.min(indices.length - 1, cursor + 45);
      j++
    ) {
      const a = indices[j],
        b = indices[j + 1],
        cos = Math.cos((t.lat[i] * Math.PI) / 180);
      const dx = (ref.lon[b] - ref.lon[a]) * cos,
        dy = ref.lat[b] - ref.lat[a],
        px = (t.lon[i] - ref.lon[a]) * cos,
        py = t.lat[i] - ref.lat[a];
      const f = Math.max(
        0,
        Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy || 1)),
      );
      const d = Math.hypot(px - f * dx, py - f * dy) * 111195;
      if (d < best) {
        best = d;
        at = j;
        progress = ref.distance[a] + f * (ref.distance[b] - ref.distance[a]);
      }
    }
    cursor = at;
    out[i] = Math.max(i ? out[i - 1] : 0, progress);
    if (best > 60 || !Number.isFinite(best)) bad++;
  }
  const issues = [...t.issues];
  if (bad / t.times.length > 0.01 || out.at(-1)! < ref.length * 0.98)
    issues.push("Ambiguous GPS alignment");
  out[0] = 0;
  out[out.length - 1] = ref.length;
  return { ...t, distance: out, length: ref.length, issues };
}
// Issues that describe a lap without making its other sectors unusable. A GPS outage
// is handled per sector in optimal(); an interrupted lap (red flag, pit stop) simply
// never wins the sector where the car stood still.
const informational = ["GPS gap longer than", "Interrupted lap"];
export function blocksOptimal(issues: string[]) {
  return issues.some((i) => !informational.some((p) => i.startsWith(p)));
}
export type Sector = {
  index: number;
  start: number;
  end: number;
  time: number;
  source: Trace;
  from: number;
  to: number;
};
export function optimal(traces: Trace[], gates: number[]): Sector[] {
  return gates.slice(0, -1).flatMap((start, index) => {
    const end = gates[index + 1];
    const candidates = traces
      .map((t) => {
        const from = interpolate(t.distance, t.times, start),
          to = interpolate(t.distance, t.times, end);
        let gap = false;
        const a = lower(t.times, from),
          b = lower(t.times, to);
        for (let i = Math.max(1, a); i <= b && i < t.times.length; i++)
          if (t.times[i] - t.times[i - 1] > 2000) gap = true;
        return {
          index,
          start,
          end,
          time: gap ? NaN : to - from,
          source: t,
          from,
          to,
        };
      })
      .filter((c) => Number.isFinite(c.time) && c.time > 0)
      .sort((a, b) => a.time - b.time);
    return candidates.length ? [candidates[0]] : [];
  });
}
export function virtual(sectors: Sector[]): Trace | undefined {
  if (!sectors.length) return;
  const times: number[] = [],
    distance: number[] = [],
    lat: number[] = [],
    lon: number[] = [],
    channels: Record<string, number[]> = {};
  const ids = [
    ...new Set(sectors.flatMap((s) => Object.keys(s.source.channels))),
  ];
  ids.forEach((id) => (channels[id] = []));
  let elapsed = 0;
  for (const s of sectors) {
    const t = s.source;
    const ds = [
      s.start,
      ...Array.from(t.distance).filter((d) => d > s.start && d < s.end),
      s.end,
    ];
    for (const d of ds) {
      const stamp = interpolate(t.distance, t.times, d);
      times.push(elapsed + stamp - s.from);
      distance.push(d);
      lat.push(interpolate(t.distance, t.lat, d));
      lon.push(interpolate(t.distance, t.lon, d));
      ids.forEach((id) =>
        channels[id].push(
          t.channels[id] ? interpolate(t.distance, t.channels[id], d) : NaN,
        ),
      );
    }
    elapsed += s.time;
  }
  return {
    id: "optimal",
    sessionId: "optimal",
    label: "Theoretical optimal",
    lap: { id: "optimal", number: 0, start: 0, end: elapsed, issues: [] },
    times: Float64Array.from(times),
    distance: Float64Array.from(distance),
    lat: Float64Array.from(lat),
    lon: Float64Array.from(lon),
    channels: Object.fromEntries(
      ids.map((id) => [id, Float64Array.from(channels[id])]),
    ),
    length: distance.at(-1)!,
    issues: [],
  };
}

export function atDistance(
  t: Trace,
  values: ArrayLike<number>,
  distance: number,
) {
  const i = lower(t.distance, distance);
  if (
    i > 0 &&
    i < t.times.length &&
    t.distance[i] !== distance &&
    t.times[i] - t.times[i - 1] > 2000
  )
    return NaN;
  return interpolate(t.distance, values, distance);
}

// Longitudinal acceleration (g) at or below this can be braking. On two sample
// Nordschleife laps -0.1 g flags about 18% of the lap, -0.2 g about 12%, -0.3 g about 10%.
export const BRAKE_G = -0.2;
// Deceleration at which the braking colour is darkest. On three real Nordschleife sessions
// 1.2 g was passed by 1% of the braking samples.
export const BRAKE_HARD = 1.2;
// GPS speed cannot tell braking from lifting off: a car coasting from 160 km/h slows by
// 0.3 to 0.5 g too. A calculated zone therefore counts only if the car sheds at least this
// share of its entry speed. A recorded brake channel is used as it is.
export const BRAKE_MIN_LOSS = 0.12;
// A recorded brake channel is on above this share of its highest value in the lap.
const BRAKE_ON = 0.1;

export type BrakeSignal = {
  // 1 where the car is braking.
  on: Uint8Array;
  // 0 to 1: light to hard braking, NaN where unknown.
  strength: Float64Array;
  // True when it comes from a brake channel in the file, false when calculated from speed.
  recorded: boolean;
};

// Consecutive flagged samples as index ranges. Gaps shorter than `bridge` metres are closed,
// and nothing is joined across a GPS outage.
function flaggedRuns(
  t: Trace,
  flag: (i: number) => boolean,
  bridge: number,
): [number, number][] {
  const runs: [number, number][] = [];
  for (let i = 0; i < t.times.length; i++) {
    if (!flag(i)) continue;
    const last = runs.at(-1);
    if (
      last &&
      t.distance[i] - t.distance[last[1]] <= bridge &&
      t.times[i] - t.times[last[1]] <= 2000
    )
      last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

// The brake channel of a lap when there is one: a VBO column or a logged channel with
// "brake" in its name. RaceChrono archives do not name their channels.
function brakeChannel(t: Trace) {
  const id = Object.keys(t.channels).find((k) => /brake/i.test(k));
  return id ? t.channels[id] : undefined;
}

const signals = new WeakMap<Trace, BrakeSignal>();
export function brakeSignal(t: Trace): BrakeSignal {
  const known = signals.get(t);
  if (known) return known;
  const n = t.times.length,
    on = new Uint8Array(n),
    strength = new Float64Array(n).fill(NaN);
  let recorded = false,
    peak = 0;
  const channel = brakeChannel(t);
  if (channel)
    for (const v of channel) if (Number.isFinite(v)) peak = Math.max(peak, v);
  if (channel && peak > 0) {
    recorded = true;
    for (let i = 0; i < n; i++)
      if (Number.isFinite(channel[i])) {
        strength[i] = Math.min(1, Math.max(0, channel[i] / peak));
        on[i] = channel[i] > BRAKE_ON * peak ? 1 : 0;
      }
  } else if (t.channels.acceleration) {
    const g = t.channels.acceleration,
      speed = t.channels.speed;
    for (let i = 0; i < n; i++)
      strength[i] = Number.isFinite(g[i])
        ? Math.min(1, Math.max(0, (-g[i] + BRAKE_G) / (BRAKE_HARD + BRAKE_G)))
        : NaN;
    for (const [from, to] of flaggedRuns(t, (i) => g[i] <= BRAKE_G, 15)) {
      let low = Infinity;
      if (speed) for (let i = from; i <= to; i++) low = Math.min(low, speed[i]);
      const entry = speed?.[from];
      const lifted =
        entry !== undefined &&
        Number.isFinite(entry) &&
        Number.isFinite(low) &&
        entry - low < BRAKE_MIN_LOSS * entry;
      if (!lifted)
        for (let i = from; i <= to; i++) if (g[i] <= BRAKE_G) on[i] = 1;
    }
  }
  const signal = { on, strength, recorded };
  signals.set(t, signal);
  return signal;
}

export function isBraking(t: Trace, distance: number) {
  const { on } = brakeSignal(t);
  let i = lower(t.distance, distance);
  if (i >= on.length) i = on.length - 1;
  if (i > 0 && distance - t.distance[i - 1] < t.distance[i] - distance) i--;
  return on[i] === 1;
}

// Stretches of a lap under braking, as sample index ranges. Gaps shorter than `bridge` metres
// are closed so one zone is not drawn as several, and runs shorter than `minLength` metres
// are dropped as noise.
export function brakingRuns(
  t: Trace,
  minLength = 8,
  bridge = 15,
): [number, number][] {
  const { on } = brakeSignal(t);
  return flaggedRuns(t, (i) => on[i] === 1, bridge).filter(
    ([from, to]) => t.distance[to] - t.distance[from] >= minLength,
  );
}

// Braking strength along one run (sample indices from..to), averaged over `half` samples
// either side so the colour changes steadily along the zone instead of flickering.
export function smoothedBrake(t: Trace, from: number, to: number, half = 3) {
  const { strength } = brakeSignal(t);
  return Array.from({ length: to - from + 1 }, (_, k) => {
    let sum = 0,
      n = 0;
    for (
      let i = Math.max(from, from + k - half);
      i <= Math.min(to, from + k + half);
      i++
    )
      if (Number.isFinite(strength[i])) {
        sum += strength[i];
        n++;
      }
    return n ? sum / n : NaN;
  });
}

// Light red for weak braking, dark red for hard braking. `strength` is 0 to 1.
export function brakeColor(strength: number) {
  const x = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  return `hsl(0 90% ${Math.round(78 - x * 50)}%)`;
}

// The speed range of the map colours, km/h. Blue is the top of it, red the bottom.
export const SPEED_SCALE = [40, 300] as const;
export function speedColor(kmh: number) {
  if (!Number.isFinite(kmh)) return "#8a9aa3";
  const [low, high] = SPEED_SCALE,
    x = Math.min(1, Math.max(0, (kmh - low) / (high - low)));
  return `hsl(${Math.round(x * 240)} 90% 55%)`;
}
// Compass heading in degrees of the direction of travel, from 10 m either side.
export function bearing(t: Trace, distance: number) {
  const from = Math.max(0, distance - 10),
    to = Math.min(t.length, distance + 10);
  const lat0 = atDistance(t, t.lat, from),
    lon0 = atDistance(t, t.lon, from),
    lat1 = atDistance(t, t.lat, to),
    lon1 = atDistance(t, t.lon, to);
  if (![lat0, lon0, lat1, lon1].every(Number.isFinite)) return NaN;
  const y = (lon1 - lon0) * Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180),
    x = lat1 - lat0;
  return x === 0 && y === 0
    ? NaN
    : ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Elapsed time of lap A minus lap B at the same distance, in ms. Positive means A is behind.
export function elapsedDelta(a: Trace, b: Trace, distance: number) {
  return (
    interpolate(a.distance, a.times, distance) -
    a.lap.start -
    (interpolate(b.distance, b.times, distance) - b.lap.start)
  );
}
// Nearest recorded sample of a trace to a map position, within a distance range.
export function nearestOnTrace(
  t: Trace,
  lat: number,
  lon: number,
  range: [number, number] = [0, Infinity],
) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity,
    at = -1;
  for (let i = 0; i < t.lat.length; i++) {
    if (t.distance[i] < range[0] || t.distance[i] > range[1]) continue;
    const v = (t.lat[i] - lat) ** 2 + ((t.lon[i] - lon) * k) ** 2;
    if (v < best) {
      best = v;
      at = i;
    }
  }
  return at < 0
    ? undefined
    : { distance: t.distance[at], lat: t.lat[at], lon: t.lon[at] };
}

// Arrow keys move the cursor by elapsed time; Shift multiplies the step.
export const STEP_MS = 200;
export const SHIFT_STEP_FACTOR = 10;
export function stepCursor(
  t: Trace,
  distance: number,
  deltaMs: number,
  range: [number, number] = [0, t.length],
) {
  if (!Number.isFinite(distance)) return distance;
  const now = interpolate(t.distance, t.times, distance);
  if (!Number.isFinite(now)) return distance;
  const target = Math.max(
    t.times[0],
    Math.min(t.times[t.times.length - 1], now + deltaMs),
  );
  const next = interpolate(t.times, t.distance, target);
  return Number.isFinite(next)
    ? Math.max(range[0], Math.min(range[1], next))
    : distance;
}

export type Opportunity = {
  index: number;
  start: number;
  end: number;
  // Time the reference lap spent in the sector, and the best sector time, in ms.
  lapTime: number;
  bestTime: number;
  // lapTime minus bestTime. Positive means time to gain.
  gain: number;
  source: Trace;
};
// Where the reference lap, normally the fastest recorded lap, gave time away against
// the best sector of every lap in the pool.
export function opportunities(
  reference: Trace,
  sectors: Sector[],
): Opportunity[] {
  return sectors.map((s) => {
    const lapTime =
      interpolate(reference.distance, reference.times, s.end) -
      interpolate(reference.distance, reference.times, s.start);
    return {
      index: s.index,
      start: s.start,
      end: s.end,
      lapTime,
      bestTime: s.time,
      gain: lapTime - s.time,
      source: s.source,
    };
  });
}

// What counting one more lap does to the theoretical lap. Nothing is changed.
export function optimalWith(pool: Trace[], extra: Trace, gates: number[]) {
  const others = pool.filter((t) => t.id !== extra.id);
  const total = (laps: Trace[]) => {
    const sectors = optimal(laps, gates);
    return sectors.length === gates.length - 1 && sectors.length > 0
      ? sectors.reduce((n, x) => n + x.time, 0)
      : NaN;
  };
  const withIt = optimal([...others, extra], gates);
  return {
    without: total(others),
    with: total([...others, extra]),
    wins: withIt.filter((x) => x.source.id === extra.id).length,
  };
}

// Keeps a zoomed chart window on the cursor while it moves. Going forward the window
// stays put until the cursor passes `lead` of its width, then scrolls with it so the
// cursor holds that position. A jump back puts the cursor 10% in. A window that
// already shows the whole lap is left alone. Returns the same array when nothing changes.
export function followRange(
  range: [number, number],
  d: number,
  length: number,
  lead = 0.6,
): [number, number] {
  const width = range[1] - range[0];
  if (width >= length - 1 || !Number.isFinite(d)) return range;
  let start = range[0];
  if (d > range[0] + width * lead) start = d - width * lead;
  else if (d < range[0]) start = d - width * 0.1;
  start = Math.max(0, Math.min(length - width, start));
  return start === range[0] ? range : [start, start + width];
}
// Zoom in or out around `focus`, which keeps its place under the pointer. factor < 1 zooms in.
export function zoomRange(
  range: [number, number],
  focus: number,
  factor: number,
  length: number,
  minWidth = 100,
): [number, number] {
  const width = range[1] - range[0];
  const next = Math.max(
    Math.min(minWidth, length),
    Math.min(length, width * factor),
  );
  const at = width > 0 ? (focus - range[0]) / width : 0.5;
  let start = focus - at * next;
  start = Math.max(0, Math.min(length - next, start));
  return [start, start + next];
}
