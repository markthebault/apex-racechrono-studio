import { forceAxes } from "./gforces";
import { sha256 } from "hash-wasm";
import type { Session, Trace } from "../model";
import { trace, align, interpolate, lower, metres } from "../analysis";
import {
  ALGORITHM,
  contextFor,
  emptySettings,
  validateSettings,
  validateCorners,
  type Corner,
  type EngineerSettings,
  type Evidence,
  type Snapshot,
  type EnvelopeBin,
} from "./contracts";
import {
  G,
  normalize,
  derivative,
  physicalCurvature,
  sample,
  metric,
  nativeWindow,
  quantile,
  median,
  type Signal,
} from "./signals";
export type AnalysisInput = {
  sessions: Session[];
  referenceId: string;
  lapIds: string[];
  settings?: EngineerSettings;
  modelState?: Snapshot["modeled"];
};
const badLap = (t: Trace) =>
  t.issues.some((x) => /invalid|Interrupted|Incompatible|Ambiguous/i.test(x));
export function detectCorners(ref: Trace, curvature: Float64Array): Corner[] {
  const active: { start: number; end: number; signs: number[] }[] = [];
  for (let i = 0; i < curvature.length; i++) {
    const k = curvature[i],
      v = (ref.channels.speed?.[i] ?? NaN) / 3.6;
    if (
      !Number.isFinite(k) ||
      Math.abs(k) < 0.001 ||
      !Number.isFinite(v) ||
      v * v * Math.abs(k) < 0.6
    )
      continue;
    const d = ref.distance[i],
      last = active.at(-1);
    if (last && d - last.end < 70) {
      last.end = d;
      last.signs.push(Math.sign(k));
    } else active.push({ start: d, end: d, signs: [Math.sign(k)] });
  }
  const regions = active
    .filter((c) => c.end - c.start >= 15)
    .map((c) => ({
      ...c,
      start: Math.max(0, c.start - 40),
      end: Math.min(ref.length, c.end + 80),
    }));
  const merged: typeof regions = [];
  for (const r of regions) {
    const last = merged.at(-1);
    if (last && r.start <= last.end) {
      last.end = r.end;
      last.signs.push(...r.signs);
    } else merged.push(r);
  }
  // Distance windows are useful comparison units, not identified physical corners.
  // Padding must not turn a chain of nearby bends into kilometre-long advice.
  const windows = merged.flatMap((r) => {
    const count = Math.ceil((r.end - r.start) / 400);
    return Array.from({ length: count }, (_, i) => ({
      ...r,
      start: r.start + ((r.end - r.start) * i) / count,
      end: r.start + ((r.end - r.start) * (i + 1)) / count,
    }));
  });
  return windows.slice(0, 200).map((r, i) => ({
    id: `corner-${i + 1}`,
    name: `Review window ${i + 1}`,
    start: r.start,
    end: r.end,
    direction:
      r.signs.some((s) => s > 0) && r.signs.some((s) => s < 0)
        ? "complex"
        : r.signs[0] > 0
          ? "left"
          : "right",
  }));
}
function evidenceFor(
  id: string,
  t: Trace,
  c: Corner,
  signals: Signal[],
  forces: ReturnType<typeof forceAxes>,
): Evidence {
  const from = interpolate(t.distance, t.times, c.start),
    to = interpolate(t.distance, t.times, c.end);
  const speed = signals.find((s) => s.semantic === "speed")?.channel;
  const win = nativeWindow(speed, from, to);
  const issues: string[] = [];
  const first = Math.max(1, lower(t.times, from)),
    last = lower(t.times, to);
  for (let i = first; i <= last && i < t.times.length; i++)
    if (t.times[i] - t.times[i - 1] > 500)
      issues.push("GPS gap or coarse sampling in comparison window");
  for (let i = first; i <= last && i < t.times.length; i++) {
    const speedMps =
      metres(t.lat[i - 1], t.lon[i - 1], t.lat[i], t.lon[i]) /
      ((t.times[i] - t.times[i - 1]) / 1000);
    if (!Number.isFinite(speedMps) || speedMps > 100)
      issues.push("GPS jump or invalid coordinates in comparison window");
  }
  if (!win.valid) issues.push("Speed coverage insufficient");
  if (badLap(t)) issues.push("Lap excluded from coaching comparison");
  const valid = !issues.length;
  const min = valid ? quantile(win.values, 0) : NaN,
    minIndex = win.values.indexOf(min);
  const decel = speed ? derivative(speed) : undefined,
    dw = nativeWindow(decel, from, to);
  const brake = signals.find((s) =>
    ["brakePressure", "brakePosition", "brakeSwitch"].includes(s.semantic),
  );
  const pedal = signals.find((s) => s.semantic === "accelerator");
  const metrics: Evidence["metrics"] = {
    entrySpeed: metric(
      valid ? sample(speed, from) : NaN,
      "m/s",
      "observed",
      "window-entry",
      speed?.id ?? "unavailable",
    ),
    minimumSpeed: metric(
      min,
      "m/s",
      "observed",
      "native-window-minimum",
      speed?.id ?? "unavailable",
    ),
    minimumPosition: metric(
      valid && minIndex >= 0
        ? interpolate(t.times, t.distance, win.times[minIndex], 500)
        : NaN,
      "m",
      "derived",
      "minimum-speed position; not geometric apex",
      speed?.id ?? "unavailable",
    ),
    exitSpeed: metric(
      valid ? sample(speed, to) : NaN,
      "m/s",
      "observed",
      "window-exit",
      speed?.id ?? "unavailable",
    ),
    elapsed: metric(
      valid ? to - from : NaN,
      "ms",
      "derived",
      "common reference window",
      "GPS timestamps",
    ),
    deceleration: metric(
      valid && dw.valid ? Math.max(0, -quantile(dw.values, 0.1)) : NaN,
      "m/s²",
      "derived",
      "native-speed/local-linear-0.6s/10th-percentile",
      speed?.id ?? "unavailable",
    ),
  };
  for (const [key, axis, transform] of [
    ["brakingG95", forces.longitudinal, (v: number) => Math.max(0, -v)],
    ["accelerationG95", forces.longitudinal, (v: number) => Math.max(0, v)],
    ["lateralG95", forces.lateral, (v: number) => Math.abs(v)],
  ] as const) {
    const w = nativeWindow(axis.channel, from, to);
    metrics[key] = metric(
      valid && w.valid
        ? quantile(
            w.values.map((v) => transform(v) / G),
            0.95,
          )
        : NaN,
      "g",
      axis.source === "recorded" ? "observed" : "derived",
      `95th percentile; ${axis.note}`,
      axis.channel?.id ?? "unavailable",
    );
  }
  if (valid && dw.valid) {
    const i = dw.values.findIndex((x) => x < -0.8);
    metrics.decelerationOnset = metric(
      i < 0 ? NaN : interpolate(t.times, t.distance, dw.times[i], 500),
      "m",
      "derived",
      "speed-only deceleration candidate; not pedal use",
      speed?.id ?? "",
    );
  }
  if (valid && dw.valid && minIndex >= 0) {
    const minTime = win.times[minIndex],
      resume = dw.values.findIndex((v, i) => dw.times[i] > minTime && v > 0.5);
    metrics.accelerationResumption = metric(
      resume < 0
        ? NaN
        : interpolate(t.times, t.distance, dw.times[resume], 500),
      "m",
      "derived",
      "kinematic acceleration after minimum speed; not throttle commitment",
      speed?.id ?? "",
    );
  }
  if (brake) {
    const b = nativeWindow(brake.channel, from, to),
      peak = quantile(b.values, 0.95);
    metrics.brakePeak = metric(
      valid && b.valid ? peak : NaN,
      brake.channel.unit,
      "observed",
      "native-channel/95th-percentile",
      brake.channel.id,
    );
    // Zero remains zero: an explicitly recorded inactive brake never falls back to speed.
    const onset = b.values.findIndex((v) => v > 0);
    metrics.brakeOnset = metric(
      valid && b.valid && onset > 0 && b.values[onset - 1] === 0
        ? interpolate(t.times, t.distance, b.times[onset], 500)
        : NaN,
      "m",
      "derived",
      "recorded actuation transition",
      brake.channel.id,
    );
    let duration = 0;
    for (let i = 1; i < b.times.length; i++)
      if (b.values[i - 1] > 0 && b.values[i] > 0)
        duration += b.times[i] - b.times[i - 1];
    metrics.brakeDuration = metric(
      valid && b.valid ? duration : NaN,
      "ms",
      "derived",
      "native recorded actuation duration",
      brake.channel.id,
    );
    if (brake.semantic !== "brakeSwitch" && peak > 0) {
      const peakIndex = b.values.reduce(
          (best, v, i) => (v > b.values[best] ? i : best),
          0,
        ),
        windowPeak = b.values[peakIndex];
      const high = b.values.findIndex(
          (v, i) =>
            i > peakIndex &&
            v <= windowPeak * 0.9 &&
            b.values[i - 1] > windowPeak * 0.9,
        ),
        low = b.values.findIndex((v, i) => i > high && v <= windowPeak * 0.1);
      const interval = brake.capability.quality.intervalMs;
      metrics.brakeReleaseDuration = metric(
        valid &&
          b.valid &&
          interval !== null &&
          interval <= 100 &&
          high >= 0 &&
          low > high
          ? b.times[low] - b.times[high]
          : NaN,
        "ms",
        "derived",
        "90%-to-10% pressure/position decrease following window maximum; requires >=10 Hz verified channel",
        brake.channel.id,
      );
    }
  }
  for (const position of [
    pedal,
    signals.find((s) => s.semantic === "throttle"),
  ])
    if (position) {
      const p = nativeWindow(position.channel, from, to),
        isPedal = position.semantic === "accelerator";
      metrics[isPedal ? "acceleratorPeak" : "throttleAnglePeak"] = metric(
        valid && p.valid ? quantile(p.values, 0.95) : NaN,
        "%",
        "observed",
        isPedal
          ? "recorded accelerator pedal"
          : "recorded throttle-body angle; not accelerator pedal",
        position.channel.id,
      );
      const applied = p.values.findIndex(
        (v, i) => i > 0 && v > 20 && p.values[i - 1] <= 20,
      );
      metrics[isPedal ? "acceleratorApplication" : "throttleAngleApplication"] =
        metric(
          valid && p.valid && applied > 0
            ? interpolate(t.times, t.distance, p.times[applied], 500)
            : NaN,
          "m",
          "derived",
          "first recorded 20% transition in the shared window",
          position.channel.id,
        );
    }
  if (brake) {
    const brakeWindow = nativeWindow(brake.channel, from, to),
      lateral = signals.find((s) => s.semantic === "lateral"),
      curvature = lateral ? undefined : physicalCurvature(t);
    let overlap = 0,
      supported = valid && brakeWindow.valid;
    for (let i = 1; i < brakeWindow.times.length; i++) {
      const time = (brakeWindow.times[i] + brakeWindow.times[i - 1]) / 2;
      const v = sample(speed, time),
        lat = lateral
          ? sample(lateral.channel, time)
          : v * v * interpolate(t.times, curvature!, time, 500);
      if (!Number.isFinite(lat)) {
        supported = false;
        continue;
      }
      if (
        brakeWindow.values[i] > 0 &&
        brakeWindow.values[i - 1] > 0 &&
        Math.abs(lat) >= 0.8
      )
        overlap += brakeWindow.times[i] - brakeWindow.times[i - 1];
    }
    metrics.brakeTurningOverlap = metric(
      supported ? overlap : NaN,
      "ms",
      "derived",
      `recorded brake actuation coincident with |lateral acceleration| >=0.8 m/s²; ${lateral ? "mapped lateral signal" : "GPS-derived kinematics"}; not a steering input or proof of technique`,
      brake.channel.id,
    );
  }
  return {
    id: `${id}:${t.id}:${c.id}`,
    snapshotId: id,
    sessionId: t.sessionId,
    lapId: t.id,
    cornerId: c.id,
    time: [from, to],
    distance: [c.start, c.end],
    quality: [...new Set(issues)],
    metrics,
    uncertainty:
      "Ordinary GPS cannot establish exact lateral placement. Event precision is limited by sampling, alignment and sensor synchronization.",
  };
}
export async function buildSnapshot(input: AnalysisInput): Promise<Snapshot> {
  const settings = validateSettings(input.settings ?? emptySettings());
  const sessions = input.sessions;
  const raw = sessions.flatMap((s) =>
    s.laps.filter((l) => input.lapIds.includes(l.id)).map((l) => trace(s, l)),
  );
  const reference = raw.find((t) => t.id === input.referenceId);
  if (!reference)
    throw Error("Select a recorded reference lap in the review scope.");
  if (new Set(sessions.map((s) => s.trackId)).size !== 1)
    throw Error("Review one track layout at a time.");
  const contextKeys = new Set(
    sessions.map((s) => {
      const c = contextFor(s, settings);
      return JSON.stringify([c.vehicle, c.setup, c.tires, c.conditions]);
    }),
  );
  if (contextKeys.size > 1)
    throw Error(
      "Select comparable vehicle/setup/tires/conditions. Contexts differ.",
    );
  const contextKnown = sessions.every((s) => {
    const c = contextFor(s, settings);
    return [c.vehicle, c.setup, c.tires, c.conditions].every(
      (v) => v.trim() && v.trim().toLowerCase() !== "unknown",
    );
  });
  const comparable = (t: Trace) =>
    t.sessionId === reference.sessionId || contextKnown;
  if (
    !settings.crossDay &&
    new Set(sessions.map((s) => new Date(s.start).toISOString().slice(0, 10)))
      .size > 1
  )
    throw Error(
      "Review one recording day or explicitly enable cross-day comparison.",
    );
  const id = await snapshotKey(input);
  const aligned = raw.map((t) => align(t, reference));
  const signals = new Map(
    sessions.map((s) => [s.id, normalize(s, settings.mappings[s.id] ?? [])]),
  );
  const corners = validateCorners(
    settings.corners[reference.id] ??
      detectCorners(reference, physicalCurvature(reference)),
    reference.length,
  );
  const forces = new Map(
    aligned.map((t) => [t.id, forceAxes(t, signals.get(t.sessionId)!)]),
  );
  const evidence = aligned.flatMap((t) =>
    corners.map((c) => {
      const e = evidenceFor(
        id,
        t,
        c,
        signals.get(t.sessionId)!,
        forces.get(t.id)!,
      );
      if (!comparable(t))
        e.quality.push(
          "Cross-recording coaching unavailable: verify vehicle, setup, tires and conditions first.",
        );
      return e;
    }),
  );
  const priorities = corners
    .flatMap((c) => {
      const ev = evidence.filter(
        (e) =>
          e.cornerId === c.id &&
          !e.quality.length &&
          e.metrics.elapsed.value !== null,
      );
      const a = ev.find((e) => e.lapId === reference.id);
      if (!a) return [];
      const faster = ev.filter(
        (e) =>
          e.lapId !== reference.id &&
          e.metrics.elapsed.value! < a.metrics.elapsed.value!,
      );
      if (!faster.length) return [];
      const typical = median(faster.map((e) => e.metrics.elapsed.value!));
      const delta = a.metrics.elapsed.value! - typical;
      const interval = Math.max(
        ...sessions.map(
          (s) =>
            signals.get(s.id)?.find((s) => s.semantic === "speed")?.capability
              .quality.intervalMs ?? 1000,
        ),
      );
      if (delta < Math.max(100, interval * 2)) return [];
      const nearest = faster.reduce((p, e) =>
        Math.abs(e.metrics.elapsed.value! - typical) <
        Math.abs(p.metrics.elapsed.value! - typical)
          ? e
          : p,
      );
      return [
        {
          id: `priority-${c.id}`,
          evidenceIds: [a.id, nearest.id],
          observation: `${c.name}: comparison laps traversed this shared window more quickly.`,
          observedDeltaMs: delta,
          potentialGainMs: null,
          support: faster.length,
          repeatability: {
            medianMs: median(ev.map((e) => e.metrics.elapsed.value!)),
            spreadMs:
              quantile(
                ev.map((e) => e.metrics.elapsed.value!),
                0.9,
              ) -
              quantile(
                ev.map((e) => e.metrics.elapsed.value!),
                0.1,
              ),
            eligibleLaps: ev.length,
            fasterLaps: faster.length,
          },
          contradictions: ev
            .filter(
              (e) =>
                e.metrics.elapsed.value! >= a.metrics.elapsed.value! &&
                e.lapId !== reference.id,
            )
            .map((e) => e.id),
          confidence:
            faster.length >= 3 ? ("medium" as const) : ("low" as const),
          experiment:
            "Review the linked entry, minimum and exit speeds. Test one repeatable change next session with your instructor; compare the same window afterward.",
          limitations: [
            "Observed time difference is not a promised recoverable gain.",
            "Traffic, tires, banking, surface and weather may differ.",
            "GPS-only deceleration does not prove pedal application or coasting.",
          ],
        },
      ];
    })
    .sort(
      (a, b) =>
        (b.observedDeltaMs * (1 + Math.log1p(b.support))) /
          (1 + b.contradictions.length) -
        (a.observedDeltaMs * (1 + Math.log1p(a.support))) /
          (1 + a.contradictions.length),
    )
    .slice(0, 3);
  const envelope = fitEnvelope(aligned.filter(comparable), signals);
  return {
    version: 1,
    algorithm: ALGORITHM,
    id,
    referenceId: reference.id,
    sessionIds: sessions.map((s) => s.id),
    contexts: Object.fromEntries(
      sessions.map((s) => [s.id, contextFor(s, settings)]),
    ),
    capabilities: Object.fromEntries(
      sessions.map((s) => [s.id, signals.get(s.id)!.map((s) => s.capability)]),
    ),
    laps: aligned.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      number: t.lap.number,
      durationMs: t.lap.end - t.lap.start,
      issues: t.issues,
      coachingEligible: !badLap(t) && comparable(t),
    })),
    corners,
    evidence,
    priorities,
    envelope,
    modeled: input.modelState ?? {
      status: "unavailable",
      reasons: [
        "No validated boundary asset selected. Telemetry review remains available.",
      ],
    },
    warnings: [
      "Unknown conditions remain unknown; selected recordings do not establish ultimate tire grip.",
      "Coaching exclusions do not change existing best-sector eligibility.",
      "Automatically detected review windows are at most 400 m and may divide a bend or contain several bends. They are not surveyed corners or apexes; verify the map before interpreting technique.",
      ...(!contextKnown && sessions.length > 1
        ? [
            "Unknown vehicle/setup/tires/conditions: other recordings remain visible as evidence but are excluded from ranked coaching and envelope fitting until context is verified.",
          ]
        : []),
      "Wheel-speed channels retain wheel identity; ABS, lockup and wheelspin interpretation remain unavailable without validated vehicle/turning/synchronization context.",
      ...(!corners.length
        ? [
            "No trustworthy corner regions detected. Add or edit a corner map; no opportunities are invented.",
          ]
        : []),
    ],
  };
}
function fitEnvelope(
  raw: Trace[],
  signals: Map<string, Signal[]>,
): Snapshot["envelope"] {
  const bins: EnvelopeBin[] = [];
  const curvatures = new Map(raw.map((t) => [t.id, physicalCurvature(t)]));
  for (let from = 0; from < 100; from += 10) {
    const events: { lap: string; a: number; lat: number; seconds: number }[] =
      [];
    for (const t of raw) {
      if (badLap(t)) continue;
      const mapped = signals.get(t.sessionId)!,
        speed = mapped.find((s) => s.semantic === "speed")?.channel;
      if (!speed) continue;
      const longitudinal =
          mapped.find((s) => s.semantic === "longitudinal")?.channel ??
          derivative(speed),
        lateral = mapped.find((s) => s.semantic === "lateral")?.channel;
      const curvature = curvatures.get(t.id)!;
      // Independent one-second blocks avoid treating dense correlated samples as events.
      for (let time = t.lap.start + 500; time < t.lap.end - 500; time += 1000) {
        const v = sample(speed, time);
        if (v < from || v >= from + 10) continue;
        const i = lower(t.times, time);
        if (i < 1 || i >= t.times.length || t.times[i] - t.times[i - 1] > 500)
          continue;
        if (
          metres(t.lat[i - 1], t.lon[i - 1], t.lat[i], t.lon[i]) /
            ((t.times[i] - t.times[i - 1]) / 1000) >
          100
        )
          continue;
        const a = sample(longitudinal, time),
          lat = lateral ? sample(lateral, time) : v * v * curvature[i];
        if (!Number.isFinite(a) || Math.abs(a) > 15 || Math.abs(lat) > 20)
          continue;
        events.push({ lap: t.id, a, lat, seconds: 1 });
      }
    }
    if (!events.length) continue;
    const lapIds = [...new Set(events.map((e) => e.lap))],
      laps = lapIds.length;
    const heldOutLap = laps >= 4 ? lapIds.at(-1)! : null;
    const training = heldOutLap
      ? events.filter((e) => e.lap !== heldOutLap)
      : events;
    const axes = {
      acceleration: training
        .filter((e) => e.a > 0)
        .map((e) => ({ lap: e.lap, value: e.a })),
      braking: training
        .filter((e) => e.a < 0)
        .map((e) => ({ lap: e.lap, value: -e.a })),
      lateralLeft: training
        .filter((e) => e.lat > 0)
        .map((e) => ({ lap: e.lap, value: e.lat })),
      lateralRight: training
        .filter((e) => e.lat < 0)
        .map((e) => ({ lap: e.lap, value: -e.lat })),
    };
    const robust = (v: { lap: string; value: number }[]) =>
      v.length >= 5 && new Set(v.map((e) => e.lap)).size >= 2
        ? quantile(
            v.map((e) => e.value),
            0.9,
          )
        : null;
    const limits = Object.fromEntries(
      Object.entries(axes).map(([name, v]) => [name, robust(v)]),
    );
    const held = events.filter((e) => e.lap === heldOutLap),
      comparisons = held.flatMap((e) => {
        const axis = e.a >= 0 ? "acceleration" : "braking",
          limit = limits[axis];
        return limit === null ? [] : [Math.abs(e.a) > limit * 1.1];
      });
    const exceedance = comparisons.length
      ? comparisons.filter(Boolean).length / comparisons.length
      : null;
    bins.push({
      fromMps: from,
      toMps: from + 10,
      acceleration: limits.acceleration,
      braking: limits.braking,
      lateralLeft: limits.lateralLeft,
      lateralRight: limits.lateralRight,
      axisSupport: Object.fromEntries(
        Object.entries(axes).map(([name, v]) => [
          name,
          { events: v.length, laps: new Set(v.map((e) => e.lap)).size },
        ]),
      ),
      validation: {
        heldOutLap,
        exceedanceFraction: exceedance,
        note: heldOutLap
          ? "Chronologically last supporting lap withheld from fitting; fraction of held-out longitudinal values >110% of fitted axis summary. This is a disagreement check, not a tire-limit prediction."
          : "Insufficient independent laps for holdout validation.",
      },
      events: events.length,
      laps,
      seconds: events.length,
      confidence:
        laps >= 4 && events.length >= 30 && (exceedance ?? 1) <= 0.25
          ? "medium"
          : "low",
      spread:
        quantile(
          events.map((e) => e.a),
          0.9,
        ) -
        quantile(
          events.map((e) => e.a),
          0.1,
        ),
    });
  }
  return {
    status: bins.some((b) => b.acceleration !== null || b.braking !== null)
      ? "available"
      : "insufficient_data",
    bins,
    method:
      "mapped longitudinal acceleration when verified, otherwise native speed derivatives; 1-second event blocks; 90th percentile; >=5 events and >=2 laps per axis/bin",
    limitations: [
      "Demonstrated performance, not ultimate capability or unused grip.",
      "Flat kinematic estimates; unknown grade, banking, sensor bias and surface.",
      "No extrapolation outside observed speed/axis coverage. Holdout disagreement is reported when at least four laps support a bin.",
    ],
  };
}

export async function snapshotKey(input: AnalysisInput): Promise<string> {
  const settings = validateSettings(input.settings ?? emptySettings()),
    sessions = input.sessions;
  const fingerprint = {
    algorithm: ALGORITHM,
    sessions: sessions.map((s) => ({
      id: s.id,
      laps: s.laps.map((l) => [l.id, l.start, l.end, l.issues]),
      line: s.line,
      trackId: s.trackId,
    })),
    reference: input.referenceId,
    lapIds: input.lapIds,
    contexts: settings.contexts,
    mappings: settings.mappings,
    corners: settings.corners,
    crossDay: settings.crossDay,
    modelState: input.modelState,
  };
  return sha256(JSON.stringify(fingerprint));
}
