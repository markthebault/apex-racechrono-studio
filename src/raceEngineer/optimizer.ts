import loadHighs, { type Highs, type ModelData } from "highs";
import wasmUrl from "highs/runtime?url";
import {
  type Corridor,
  type Point,
  insideCorridor,
  distance,
  lineCurvature,
  pathDistance,
} from "./boundaries";
export type ModeledLine = {
  status: "available";
  hash: string;
  points: Point[];
  curvature: number[];
  distance: number[];
  length: number;
  closed: boolean;
  diagnostics: {
    solver: string;
    nodes: number;
    initMs: number;
    solveMs: number;
    objectiveBefore: number;
    objectiveAfter: number;
    method: string;
    acceptedStep: number;
  };
  assumptions: string[];
};
let instance: Promise<Highs> | undefined;
export async function solver() {
  return (instance ??= loadHighs({ locateFile: () => wasmUrl }));
}
export function qp(c: Corridor): ModelData {
  const n = c.points.length,
    cost = new Float64Array(n),
    columns = Array.from({ length: n }, () => new Map<number, number>());
  // First-order curvature linearization k(P + N*x) about the metric spine.
  // k = cross(P',P'') / |P'|^3. Include the denominator derivative:
  // minimizing Cartesian second differences alone would incorrectly shrink circles.
  // Integral sum h * (k0 + J*x)^2; Q=2 J'WJ, c=2 J'Wk0.
  // A common 1e6 objective scale keeps tiny metric coefficients above solver tolerances.
  for (let i = c.closed ? 0 : 1; i < (c.closed ? n : n - 1); i++) {
    const ids = [(i - 1 + n) % n, i, (i + 1) % n],
      h1 = distance(c.points[ids[0]], c.points[i]),
      h2 = distance(c.points[i], c.points[ids[2]]),
      h = (h1 + h2) / 2;
    const w2 = [1 / (h1 * h), -(1 / h1 + 1 / h2) / h, 1 / (h2 * h)],
      w1 = [-1 / (h1 + h2), 0, 1 / (h1 + h2)];
    const t = [0, 0],
      d = [0, 0];
    ids.forEach((j, k) => {
      for (let axis = 0; axis < 2; axis++) {
        t[axis] += w1[k] * c.points[j][axis];
        d[axis] += w2[k] * c.points[j][axis];
      }
    });
    const norm = Math.hypot(...t),
      k0 = (t[0] * d[1] - t[1] * d[0]) / norm ** 3;
    const aa = ids.map((j, k) => {
      const normal = c.normals[j],
        dt = normal.map((v) => v * w1[k]),
        dd = normal.map((v) => v * w2[k]);
      return (
        (dt[0] * d[1] - dt[1] * d[0] + t[0] * dd[1] - t[1] * dd[0]) /
          norm ** 3 -
        (3 * k0 * (t[0] * dt[0] + t[1] * dt[1])) / norm ** 2
      );
    });
    const weight = h * 1e6;
    ids.forEach((j, k) => {
      cost[j] += 2 * aa[k] * k0 * weight;
      ids.forEach((l, m) => {
        if (l >= j)
          columns[j].set(
            l,
            (columns[j].get(l) ?? 0) + 2 * aa[k] * aa[m] * weight,
          );
      });
    });
  }
  columns.forEach((col, i) => col.set(i, (col.get(i) ?? 0) + 0.001));
  const starts = [0],
    indices: number[] = [],
    values: number[] = [];
  columns.forEach((col) => {
    [...col]
      .sort((a, b) => a[0] - b[0])
      .forEach(([i, v]) => {
        indices.push(i);
        values.push(v);
      });
    starts.push(indices.length);
  });
  const lo = [...c.lower],
    hi = [...c.upper];
  // Open endpoints preserve the supplied entry/exit spine position and tangent.
  if (!c.closed) for (const i of [0, 1, n - 2, n - 1]) lo[i] = hi[i] = 0;
  // A numerically inactive row avoids the empty-row QP shortcut observed in this WASM release.
  return {
    numCols: n,
    numRows: 1,
    colCost: cost,
    colLower: lo,
    colUpper: hi,
    rowLower: [-1e20],
    rowUpper: [1e20],
    matrix: {
      format: "csc",
      numCols: n,
      numRows: 1,
      starts: Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : 1)),
      indices: [0],
      values: [1],
    },
    hessian: { format: "triangular", dimension: n, starts, indices, values },
  };
}
export function curvatureObjective(p: Point[], closed: boolean) {
  const k = lineCurvature(p, closed);
  return k.reduce(
    (sum, x, i) =>
      sum +
      x *
        x *
        (i
          ? p.length && distance(p[i - 1], p[i])
          : closed
            ? distance(p.at(-1)!, p[0])
            : 0),
    0,
  );
}
export async function optimize(
  c: Corridor,
  runtime?: Highs,
): Promise<ModeledLine> {
  const start = performance.now(),
    highs = runtime ?? (await solver()),
    ready = performance.now(),
    model = highs.createModel(qp(c));
  let points: Point[];
  try {
    model.options.set({
      output_flag: false,
      presolve: "off",
      solver: "choose",
      time_limit: 20,
      qp_iteration_limit: 10000,
    });
    const run = model.run();
    if (run.status !== 0)
      throw Error("QP solver returned an error or warning.");
    if (model.getModelStatus() !== highs.constants.modelStatus.optimal)
      throw Error("Minimum-curvature solver did not converge to an optimum.");
    const offsets = model.getSolution().colValue;

    points = c.points.map((p, i) => [
      p[0] + c.normals[i][0] * offsets[i],
      p[1] + c.normals[i][1] * offsets[i],
    ]);
  } finally {
    model.dispose();
  }
  if (!insideCorridor(c.points, c))
    throw Error(
      "Reference spine fails between-node vehicle clearance; repair boundaries or increase resolution.",
    );
  const before = curvatureObjective(c.points, c.closed),
    candidate = points;
  let after = curvatureObjective(points, c.closed),
    acceptedStep = 1;
  // Global feasible line search, not independent vertex clipping. Retain its step
  // in diagnostics and require actual curvature improvement after containment checks.
  while (
    (!insideCorridor(points, c) ||
      !Number.isFinite(after) ||
      after > before + Math.max(1e-10, before * 1e-4)) &&
    acceptedStep > 1 / 256
  ) {
    acceptedStep /= 2;
    points = c.points.map((p, i) => [
      p[0] + acceptedStep * (candidate[i][0] - p[0]),
      p[1] + acceptedStep * (candidate[i][1] - p[1]),
    ]);
    after = curvatureObjective(points, c.closed);
  }
  if (
    !insideCorridor(points, c) ||
    !Number.isFinite(after) ||
    after > before + Math.max(1e-10, before * 1e-4)
  )
    throw Error(
      "No feasible curvature-improving line-search step. Increase resolution or repair boundaries.",
    );
  const arc = pathDistance(points, c.closed);
  return {
    status: "available",
    hash: c.hash,
    points,
    curvature: lineCurvature(points, c.closed),
    distance: arc.distance,
    length: arc.length,
    closed: c.closed,
    diagnostics: {
      solver: "highs-1.15.3",
      nodes: points.length,
      initMs: ready - start,
      solveMs: performance.now() - ready,
      objectiveBefore: before,
      objectiveAfter: after,
      acceptedStep,
      method:
        "first-order metric curvature convex QP with recorded feasible backtracking; piecewise linear; periodic indices for loops; fixed endpoint tangents for open runs",
    },
    assumptions: [
      "Modeled minimum-curvature line; no guarantee of minimum lap time or safety.",
      "Two-dimensional polygonal geometry, no banking/grade/surface inference.",
      "Validation samples each segment at <=0.5 m; boundary accuracy remains a limiting assumption.",
    ],
  };
}
