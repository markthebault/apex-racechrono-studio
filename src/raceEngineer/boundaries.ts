export type Point = [number, number];
export type BoundaryAsset = {
  format: "apex-boundaries";
  version: 1;
  layoutId: string;
  direction: string;
  topology: "open" | "closed";
  coordinates: "local-metric-xy";
  units: "m";
  origin: [number, number];
  spine: Point[];
  left: Point[];
  right: Point[];
  source: string;
  date: string;
  accuracyM: number | null;
  license: string;
  redistribution: "permitted" | "restricted";
  permittedUse: boolean;
};
export type Corridor = {
  asset: BoundaryAsset;
  points: Point[];
  normals: Point[];
  lower: number[];
  upper: number[];
  width: number;
  clearance: number;
  closed: boolean;
  hash: string;
};
export const distance = (a: Point, b: Point) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
export function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(c, a),
    den = cross(u, v);
  if (Math.abs(den) < 1e-9) {
    if (Math.abs(cross(w, u)) > 1e-8) return false;
    return (
      Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <=
        Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) + 1e-8 &&
      Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <=
        Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) + 1e-8
    );
  }
  const s = cross(w, v) / den,
    t = cross(w, u) / den;
  return s >= -1e-8 && s <= 1 + 1e-8 && t >= -1e-8 && t <= 1 + 1e-8;
}
function edges(points: Point[], closed: boolean): [Point, Point][] {
  return points
    .slice(0, closed ? points.length : points.length - 1)
    .map((p, i) => [p, points[(i + 1) % points.length]]);
}
function validatePath(
  points: Point[],
  closed: boolean,
  name: string,
  thorough = true,
) {
  if (
    !Array.isArray(points) ||
    points.length < (closed ? 6 : 3) ||
    points.length > 8000 ||
    points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((v) => !Number.isFinite(v) || Math.abs(v) > 100000),
    )
  )
    throw Error(
      `${name}: expected 3–8000 finite local metric coordinates (6 for a loop).`,
    );
  if (new Set(points.map((p) => p.join(","))).size !== points.length)
    throw Error(`${name}: repeated vertices.`);
  const ee = edges(points, closed);
  if (ee.some(([a, b]) => distance(a, b) < 0.01))
    throw Error(
      `${name}: duplicate/degenerate vertices; omit the repeated closing vertex.`,
    );
  if (!thorough) return;
  for (let i = 0; i < ee.length; i++)
    for (let j = i + 2; j < ee.length; j++)
      if (
        !(closed && i === 0 && j === ee.length - 1) &&
        segmentsCross(...ee[i], ...ee[j])
      )
        throw Error(`${name}: self-crossing polyline.`);
}
export function validateBoundary(
  value: unknown,
  layoutId: string,
  thorough = true,
): BoundaryAsset {
  const b = value as BoundaryAsset;
  if (
    !b ||
    b.format !== "apex-boundaries" ||
    b.version !== 1 ||
    b.layoutId !== layoutId ||
    typeof b.direction !== "string" ||
    !b.direction.trim() ||
    !["open", "closed"].includes(b.topology) ||
    b.coordinates !== "local-metric-xy" ||
    b.units !== "m" ||
    b.permittedUse !== true ||
    !["permitted", "restricted"].includes(b.redistribution) ||
    typeof b.license !== "string" ||
    !b.license.trim() ||
    typeof b.source !== "string" ||
    !b.source.trim() ||
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    !Array.isArray(b.origin) ||
    b.origin.length !== 2 ||
    !b.origin.every(Number.isFinite) ||
    Math.abs(b.origin[0]) > 90 ||
    Math.abs(b.origin[1]) > 180 ||
    !(
      b.accuracyM === null ||
      (Number.isFinite(b.accuracyM) && b.accuracyM >= 0)
    )
  )
    throw Error(
      "Boundary metadata, layout, permission, origin or metric coordinate system is invalid.",
    );
  const closed = b.topology === "closed";
  for (const name of ["spine", "left", "right"] as const)
    validatePath(b[name], closed, name, thorough);
  if (thorough)
    for (const [a, c] of edges(b.left, closed))
      for (const [d, e] of edges(b.right, closed))
        if (segmentsCross(a, c, d, e))
          throw Error("Left/right boundaries cross.");
  return b;
}
export function pathDistance(p: Point[], closed: boolean) {
  const d = [0];
  for (let i = 1; i < p.length; i++)
    d.push(d[i - 1] + distance(p[i - 1], p[i]));
  return {
    distance: d,
    length: d.at(-1)! + (closed ? distance(p.at(-1)!, p[0]) : 0),
  };
}
function resample(p: Point[], closed: boolean, n: number): Point[] {
  const { distance: d, length } = pathDistance(p, closed);
  const pp = closed ? [...p, p[0]] : p,
    dd = closed ? [...d, length] : d;
  let at = 0;
  return Array.from({ length: n }, (_, i) => {
    const s = (length * i) / (closed ? n : n - 1);
    while (at < dd.length - 2 && dd[at + 1] < s) at++;
    const f = (s - dd[at]) / (dd[at + 1] - dd[at]);
    return [
      pp[at][0] + f * (pp[at + 1][0] - pp[at][0]),
      pp[at][1] + f * (pp[at + 1][1] - pp[at][1]),
    ] as Point;
  });
}
function rayHits(
  p: Point,
  n: Point,
  path: Point[],
  closed: boolean,
  inset = 0,
): number[] {
  return edges(path, closed).flatMap(([a, b]) => {
    const edge = sub(b, a),
      den = cross(n, edge);
    if (Math.abs(den) < 1e-9) return [];
    const w = sub(a, p),
      t = cross(w, edge) / den,
      u = cross(w, n) / den;
    const factor = Math.abs(den) / Math.hypot(...edge);
    return u >= -1e-8 && u <= 1 + 1e-8
      ? [t - (Math.sign(t) * inset) / factor]
      : [];
  });
}
export async function corridor(
  value: unknown,
  layoutId: string,
  width: number,
  clearance: number,
  n = 250,
): Promise<Corridor> {
  const asset = validateBoundary(value, layoutId),
    closed = asset.topology === "closed";
  if (
    !Number.isFinite(width) ||
    width < 0.5 ||
    width > 4 ||
    !Number.isFinite(clearance) ||
    clearance < 0 ||
    clearance > 5 ||
    !Number.isInteger(n) ||
    n < 20 ||
    n > 4000
  )
    throw Error(
      "Set a vehicle width (0.5–4 m), clearance (0–5 m), and 20–4000 nodes.",
    );
  const points = resample(asset.spine, closed, n),
    normals: Point[] = [],
    lower: number[] = [],
    upper: number[] = [];
  for (let i = 0; i < n; i++) {
    const a =
        !closed && i === 0
          ? asset.spine[0]
          : !closed && i === n - 1
            ? asset.spine.at(-2)!
            : points[i === 0 ? n - 1 : i - 1],
      b =
        !closed && i === 0
          ? asset.spine[1]
          : !closed && i === n - 1
            ? asset.spine.at(-1)!
            : points[i === n - 1 ? 0 : i + 1],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      len = Math.hypot(dx, dy),
      normal: Point = [-dy / len, dx / len];
    const left = rayHits(
        points[i],
        normal,
        asset.left,
        closed,
        width / 2 + clearance + 0.02,
      )
        .filter((t) => t > 0)
        .sort((a, b) => a - b)[0],
      right = rayHits(
        points[i],
        normal,
        asset.right,
        closed,
        width / 2 + clearance + 0.02,
      )
        .filter((t) => t < 0)
        .sort((a, b) => b - a)[0];
    if (
      !Number.isFinite(left) ||
      !Number.isFinite(right) ||
      left - right > 50 ||
      left - right < 0
    )
      throw Error(
        `Boundary corridor is disconnected, reversed, ambiguous or too narrow near node ${i}. Check direction and spine.`,
      );
    normals.push(normal);
    lower.push(right);
    upper.push(left);
    if (lower[i] > 0 || upper[i] < 0)
      throw Error("Reference spine is outside the vehicle-clear corridor.");
  }
  const { sha256 } = await import("hash-wasm");
  const hash = await sha256(
    JSON.stringify({ asset, width, clearance, n, algorithm: "corridor-1" }),
  );
  return {
    asset,
    points,
    normals,
    lower,
    upper,
    width,
    clearance,
    closed,
    hash,
  };
}
function segmentDistance(p: Point, a: Point, b: Point) {
  const u = sub(b, a),
    w = sub(p, a),
    f = Math.max(
      0,
      Math.min(1, (u[0] * w[0] + u[1] * w[1]) / (u[0] * u[0] + u[1] * u[1])),
    );
  return distance(p, [a[0] + f * u[0], a[1] + f * u[1]]);
}
export function insideCorridor(points: Point[], c: Corridor): boolean {
  if (
    points.length < 3 ||
    points.some((p) => p.some((x) => !Number.isFinite(x))) ||
    edges(points, c.closed).some(([a, b]) => distance(a, b) < 0.01)
  )
    return false;
  // Segment interiors are checked at <=0.5 m, not only at solver knots.
  const left = edges(c.asset.left, c.closed),
    right = edges(c.asset.right, c.closed),
    margin = c.width / 2 + c.clearance;
  for (const [a, b] of edges(points, c.closed)) {
    const steps = Math.ceil(distance(a, b) / 0.5);
    for (let j = 0; j <= steps; j++) {
      const p: Point = [
        a[0] + ((b[0] - a[0]) * j) / steps,
        a[1] + ((b[1] - a[1]) * j) / steps,
      ];
      const ds = (ee: [Point, Point][]) =>
        Math.min(...ee.map(([x, y]) => segmentDistance(p, x, y)));
      if (ds(left) < margin - 1e-5 || ds(right) < margin - 1e-5) return false;
      // Oriented normal check against nearest spine location rules out disconnected exterior.
      let i = 0,
        best = Infinity;
      c.points.forEach((q, k) => {
        const d = distance(p, q);
        if (d < best) {
          best = d;
          i = k;
        }
      });
      const delta = sub(p, c.points[i]),
        lateral = delta[0] * c.normals[i][0] + delta[1] * c.normals[i][1];
      if (lateral < c.lower[i] - 0.05 || lateral > c.upper[i] + 0.05)
        return false;
    }
  }
  return true;
}
export function lineCurvature(points: Point[], closed: boolean): number[] {
  return points.map((p, i) => {
    if (!closed && (i === 0 || i === points.length - 1)) return 0;
    const a = points[(i - 1 + points.length) % points.length],
      b = points[(i + 1) % points.length],
      u = sub(p, a),
      v = sub(b, p);
    return (
      (2 * cross(u, v)) / (distance(a, p) * distance(p, b) * distance(a, b))
    );
  });
}
