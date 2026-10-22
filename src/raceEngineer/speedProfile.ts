import type { ModeledLine } from "./optimizer";
import { distance } from "./boundaries";
export type Limits = {
  acceleration: number;
  braking: number;
  lateral: number;
  maxSpeed: number;
  minSpeed?: number;
  entrySpeed?: number;
  finishSpeed?: number;
  source: string;
  reductions?: { startM: number; endM: number; factor: number }[];
};
export type SpeedProfile = {
  version: 1;
  speedMps: number[];
  accelerationMps2: number[];
  lateralMps2: number[];
  cumulativeMs: number[];
  totalMs: number;
  assumptions: Limits;
  iterations: number;
  limitations: string[];
  activeConstraints: string[][];
};
export function speedProfile(line: ModeledLine, limits: Limits): SpeedProfile {
  if (
    !limits ||
    typeof limits !== "object" ||
    (limits.reductions !== undefined && !Array.isArray(limits.reductions))
  )
    throw Error("Supply a valid limits object and optional reductions array.");
  if (
    line.points.length < 3 ||
    line.curvature.length !== line.points.length ||
    line.curvature.some((x) => !Number.isFinite(x)) ||
    line.distance.length !== line.points.length ||
    !Number.isFinite(line.length) ||
    line.length <= 0
  )
    throw Error("Invalid modeled line or curvature.");
  if (
    [limits.acceleration, limits.braking, limits.lateral, limits.maxSpeed].some(
      (x) => !Number.isFinite(x) || x <= 0,
    ) ||
    limits.maxSpeed > 100 ||
    typeof limits.source !== "string" ||
    !limits.source.trim()
  )
    throw Error(
      "Supply explicit positive conservative acceleration, braking, lateral and speed assumptions with provenance.",
    );
  if (
    !line.closed &&
    (!Number.isFinite(limits.entrySpeed) ||
      !Number.isFinite(limits.finishSpeed) ||
      limits.entrySpeed! < 0 ||
      limits.finishSpeed! < 0)
  )
    throw Error("Open sections require explicit entry and finish speeds.");
  if (
    limits.reductions?.some(
      (r) =>
        !Number.isFinite(r.startM) ||
        !Number.isFinite(r.endM) ||
        r.startM < 0 ||
        r.endM <= r.startM ||
        r.endM > line.length ||
        !Number.isFinite(r.factor) ||
        r.factor <= 0 ||
        r.factor > 1,
    )
  )
    throw Error(
      "Local reductions must use valid line-distance ranges and factors in (0,1].",
    );
  const factors = line.distance.map((d) =>
    Math.min(
      1,
      ...(limits.reductions ?? [])
        .filter((r) => d >= r.startM && d <= r.endM)
        .map((r) => r.factor),
    ),
  );
  const n = line.points.length,
    k = line.curvature.map(Math.abs),
    v = k.map(
      (x, i) =>
        Math.min(
          limits.maxSpeed * Math.sqrt(factors[i]),
          Math.sqrt((limits.lateral * factors[i]) / Math.max(x, 1e-12)),
        ) * 0.999999,
    ),
    segments = line.closed ? n : n - 1;
  const ds = Array.from({ length: segments }, (_, i) =>
    distance(line.points[i], line.points[(i + 1) % n]),
  );
  if (ds.some((d) => !Number.isFinite(d) || d <= 0))
    throw Error("Degenerate modeled segment.");
  if (!line.closed) {
    v[0] = Math.min(v[0], limits.entrySpeed!);
    v[n - 1] = Math.min(v[n - 1], limits.finishSpeed!);
  }
  let iterations = 0,
    change = Infinity;
  const residual = (i: number, j: number) =>
    Math.sqrt(
      Math.max(
        0,
        1 -
          Math.pow(
            Math.max(
              (v[i] * v[i] * k[i]) / factors[i],
              (v[j] * v[j] * k[j]) / factors[j],
            ) / limits.lateral,
            2,
          ),
      ),
    );
  for (; iterations < 500 && change > 1e-6; iterations++) {
    const before = [...v];
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % n,
        a =
          limits.acceleration *
          Math.min(factors[i], factors[j]) *
          residual(i, j);
      v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * a * ds[i]));
    }
    for (let i = segments - 1; i >= 0; i--) {
      const j = (i + 1) % n,
        a = limits.braking * Math.min(factors[i], factors[j]) * residual(i, j);
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * a * ds[i]));
    }
    change = Math.max(...v.map((x, i) => before[i] - x));
  }
  if (limits.minSpeed !== undefined && v.some((x) => x < limits.minSpeed!))
    throw Error(
      "Profile leaves the demonstrated speed range; explicit conservative assumptions are required.",
    );
  if (change > 1e-6) throw Error("Coupled speed profile did not converge.");
  if (
    !line.closed &&
    (Math.abs(v[0] - limits.entrySpeed!) > 0.001 ||
      Math.abs(v[n - 1] - limits.finishSpeed!) > 0.001)
  )
    throw Error(
      "Entry/finish conditions are infeasible under these assumptions.",
    );
  const activeConstraints: string[][] = [];
  const accelerationMps2: number[] = [],
    lateralMps2 = v.map((x, i) => x * x * k[i]),
    cumulativeMs = [0];
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % n,
      a = (v[j] * v[j] - v[i] * v[i]) / (2 * ds[i]),
      limit =
        (a >= 0 ? limits.acceleration : limits.braking) *
        Math.min(factors[i], factors[j]),
      lat = Math.max(lateralMps2[i] / factors[i], lateralMps2[j] / factors[j]);
    if ((a / limit) ** 2 + (lat / limits.lateral) ** 2 > 1.00001)
      throw Error("Profile failed combined-grip validation.");
    if (v[i] + v[j] <= 1e-6)
      throw Error("Zero-speed segment has no finite travel time.");
    activeConstraints.push([
      ...(Math.abs(a) / limit > 0.95
        ? [a >= 0 ? "acceleration" : "braking"]
        : []),
      ...(lat / limits.lateral > 0.95 ? ["lateral"] : []),
      ...(v[i] >= limits.maxSpeed * 0.999 ? ["maximum speed"] : []),
      ...(Math.min(factors[i], factors[j]) < 1 ? ["local reduction"] : []),
    ]);
    accelerationMps2.push(a);
    cumulativeMs.push(cumulativeMs.at(-1)! + (2000 * ds[i]) / (v[i] + v[j]));
  }
  return {
    version: 1,
    activeConstraints,
    speedMps: v,
    accelerationMps2,
    lateralMps2,
    cumulativeMs,
    totalMs: cumulativeMs.at(-1)!,
    assumptions: limits,
    iterations,
    limitations: [
      `${limits.source}; not measured ultimate capability.`,
      "Friction ellipse, flat geometry, no banking/aerodynamics/grade correction.",
      "Do not use modeled speed to justify exceeding demonstrated capability.",
    ],
  };
}

export function limitsFromEnvelope(
  envelope: import("./contracts").Snapshot["envelope"],
): Limits | undefined {
  if (envelope.status !== "available") return undefined;
  const bins = envelope.bins.filter(
    (b) =>
      b.acceleration !== null &&
      b.braking !== null &&
      b.lateralLeft !== null &&
      b.lateralRight !== null &&
      b.laps >= 2,
  );
  if (
    !bins.length ||
    bins.some((b, i) => i > 0 && b.fromMps !== bins[i - 1].toMps)
  )
    return undefined;
  const positive = (x: number) => Number.isFinite(x) && x > 0;
  const acceleration = Math.min(...bins.map((b) => b.acceleration!)),
    braking = Math.min(...bins.map((b) => b.braking!)),
    lateral = Math.min(
      ...bins.flatMap((b) => [b.lateralLeft!, b.lateralRight!]),
    );
  if (![acceleration, braking, lateral].every(positive)) return undefined;
  return {
    acceleration,
    braking,
    lateral,
    minSpeed: bins[0].fromMps,
    maxSpeed: bins.at(-1)!.toMps - 0.01,
    source:
      "Demonstrated envelope: conservative minimum of supported per-bin 90th percentiles across both lateral directions. No extrapolation outside these bins.",
  };
}
