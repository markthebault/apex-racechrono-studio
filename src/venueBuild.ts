// Builds the venue catalog from OpenStreetMap raceways. Runs in `npm run catalog` (Node
// strips the types) and in the tests. Self-contained: no imports, so Node can load it.
//
// A venue is a set of raceway pieces that touch or lie within a few hundred metres of each
// other. Its layouts come from three places, in this order of trust: circuit relations
// (mappers listed the pieces of a layout), closed named ways (one way is the whole loop),
// and loops assembled from the pieces. Pit lanes never form part of an assembled loop.

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; ref: number; role: string }[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  lat?: number;
  lon?: number;
};

export type LayoutSource = "relation" | "way" | "pieces";
export type VenueLayout = {
  name: string;
  lengthM: number;
  source: LayoutSource;
  path: string;
};
export type VenueIndexEntry = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number];
  cell: string;
  aliases: string[];
  layouts: { name: string; lengthM: number; source: LayoutSource }[];
};
export type VenueGeometry = {
  pieces: { p: string; pit?: 1 }[];
  layouts: VenueLayout[];
};

type Pt = [number, number];
type Way = {
  id: number;
  name: string;
  nodes: number[];
  pts: Pt[];
  oneway: 1 | -1 | 0;
  pit: boolean;
  len: number;
};
type Seg = {
  id: number;
  way: Way;
  a: number;
  b: number;
  pts: Pt[];
  len: number;
};

const EXCLUDED_SPORT =
  /cycling|bicycle|bmx|horse|equestrian|running|athletics|motocross|enduro|trial|rc_car|model|dog|skate|mountain_bike/;
const PIT =
  /\b(pit|pits|pitlane|pit lane|pit road|pitstraat|boxengasse|boxen|stands|paddock|voie des stands|corsia box)\b/i;

export function metres(a: Pt, b: Pt) {
  const r = Math.PI / 180,
    dl = (b[0] - a[0]) * r,
    dn = (b[1] - a[1]) * r;
  const h =
    Math.sin(dl / 2) ** 2 +
    Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2;
  return 2 * 6371e3 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function pathLength(pts: Pt[]) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += metres(pts[i - 1], pts[i]);
  return n;
}

// Douglas-Peucker in local metres. 1.5 m keeps corners and removes collinear points.
export function simplify(pts: Pt[], tolerance = 1.5): Pt[] {
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0][0] * Math.PI) / 180) * 111320;
  const xy = pts.map((p) => [p[1] * k, p[0] * 110540]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [x1, y1] = xy[s],
      [x2, y2] = xy[e];
    const dx = x2 - x1,
      dy = y2 - y1,
      l2 = dx * dx + dy * dy;
    let worst = -1,
      at = -1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = xy[i];
      const t = l2
        ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2))
        : 0;
      const d = Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tolerance) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Google's encoded polyline format at 1e-5 degrees, about a metre.
export function encodePolyline(pts: Pt[]) {
  let out = "",
    plat = 0,
    plon = 0;
  const put = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const [lat, lon] of pts) {
    const a = Math.round(lat * 1e5),
      b = Math.round(lon * 1e5);
    put(a - plat);
    put(b - plon);
    plat = a;
    plon = b;
  }
  return out;
}

class Union {
  parent = new Map<number, number>();
  find(x: number): number {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  join(a: number, b: number) {
    const x = this.find(a),
      y = this.find(b);
    if (x !== y) this.parent.set(Math.max(x, y), Math.min(x, y));
  }
}

function onewayOf(tags: Record<string, string>): 1 | -1 | 0 {
  const v = tags.oneway;
  if (v === "yes" || v === "1" || v === "true") return 1;
  if (v === "-1" || v === "reverse") return -1;
  return 0;
}

// Strips the layout part of a name: "Circuit X - Alternative" -> "Circuit X".
function venueNameFrom(name: string) {
  return name
    .replace(/\s+[-–—]\s+.*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

// Chains ways into one path, reversing any that join end to end the other way round.
function chain(ways: Way[]): Pt[] {
  const left = [...ways];
  const out: Pt[] = [...(left.shift()?.pts ?? [])];
  while (left.length) {
    const end = out[out.length - 1],
      start = out[0];
    let best = 0,
      how = 0,
      dist = Infinity;
    left.forEach((w, i) => {
      const cand = [
        metres(end, w.pts[0]),
        metres(end, w.pts[w.pts.length - 1]),
        metres(start, w.pts[w.pts.length - 1]),
        metres(start, w.pts[0]),
      ];
      cand.forEach((d, k) => {
        if (d < dist) {
          dist = d;
          best = i;
          how = k;
        }
      });
    });
    const w = left.splice(best, 1)[0];
    if (how === 0) out.push(...w.pts.slice(1));
    else if (how === 1) out.push(...[...w.pts].reverse().slice(1));
    else if (how === 2) out.unshift(...w.pts.slice(0, -1));
    else out.unshift(...[...w.pts].reverse().slice(0, -1));
  }
  return out;
}

// Every simple loop through the pieces, respecting one-way tags. The graph is contracted
// to junctions first; venues too tangled to enumerate get no assembled loops.
function loops(segs: Seg[], limit = 3000): { segs: Seg[]; pts: Pt[] }[] {
  type Step = { seg: Seg; fwd: boolean };
  type Edge = { run: Step[]; from: number; to: number; dir: 1 | -1 | 0 };
  const degree = new Map<number, number>();
  for (const s of segs) {
    degree.set(s.a, (degree.get(s.a) ?? 0) + 1);
    degree.set(s.b, (degree.get(s.b) ?? 0) + 1);
  }
  const used = new Set<Seg>();
  const edges: Edge[] = [];
  const bySeg = new Map<number, Seg[]>();
  for (const s of segs)
    for (const n of [s.a, s.b]) bySeg.set(n, [...(bySeg.get(n) ?? []), s]);
  for (const s of segs) {
    if (used.has(s)) continue;
    // Walk both ways from s through nodes of degree 2.
    const run: Step[] = [{ seg: s, fwd: true }];
    used.add(s);
    for (const forward of [true, false]) {
      let node = forward ? s.b : s.a;
      while (degree.get(node) === 2) {
        const next = bySeg.get(node)!.find((x) => !used.has(x));
        if (!next) break;
        used.add(next);
        const fwd = next.a === node;
        if (forward) run.push({ seg: next, fwd });
        else run.unshift({ seg: next, fwd: !fwd });
        node = fwd ? next.b : next.a;
      }
    }
    const first = run[0],
      last = run[run.length - 1];
    const from = first.fwd ? first.seg.a : first.seg.b;
    const to = last.fwd ? last.seg.b : last.seg.a;
    // 1: only from -> to, -1: only to -> from, 0: either. Contradictory tags count as 0.
    const dirs = new Set(run.map((r) => r.seg.way.oneway * (r.fwd ? 1 : -1)));
    dirs.delete(0);
    const dir = dirs.size === 1 ? ([...dirs][0] as 1 | -1) : 0;
    edges.push({ run, from, to, dir });
  }
  if (edges.length > 40) return [];
  const adj = new Map<number, { e: number; to: number; fwd: boolean }[]>();
  const add = (n: number, v: { e: number; to: number; fwd: boolean }) =>
    adj.set(n, [...(adj.get(n) ?? []), v]);
  edges.forEach((e, i) => {
    if (e.dir !== -1) add(e.from, { e: i, to: e.to, fwd: true });
    if (e.dir !== 1) add(e.to, { e: i, to: e.from, fwd: false });
  });
  const nodes = [...adj.keys()].sort((a, b) => a - b);
  const rank = new Map(nodes.map((n, i) => [n, i]));
  const found: { e: number; fwd: boolean }[][] = [];
  const seen = new Set<string>();
  let steps = 0;
  for (const start of nodes) {
    const path: { e: number; fwd: boolean }[] = [];
    const onPath = new Set<number>([start]);
    const walk = (node: number) => {
      if (found.length >= limit || ++steps > 200000) return;
      for (const step of adj.get(node) ?? []) {
        if (path.some((p) => p.e === step.e)) continue;
        if (step.to === start) {
          const cyc = [...path, step];
          const key = cyc
            .map((c) => c.e)
            .sort((a, b) => a - b)
            .join(",");
          if (!seen.has(key)) {
            seen.add(key);
            found.push(cyc);
          }
          continue;
        }
        if (onPath.has(step.to) || rank.get(step.to)! < rank.get(start)!)
          continue;
        onPath.add(step.to);
        path.push(step);
        walk(step.to);
        path.pop();
        onPath.delete(step.to);
      }
    };
    walk(start);
  }
  return found.map((cyc) => {
    const pts: Pt[] = [];
    const out: Seg[] = [];
    for (const c of cyc) {
      const run = edges[c.e].run;
      const ordered = c.fwd
        ? run
        : [...run].reverse().map((r) => ({ seg: r.seg, fwd: !r.fwd }));
      for (const r of ordered) {
        const p = r.fwd ? r.seg.pts : [...r.seg.pts].reverse();
        pts.push(...(pts.length ? p.slice(1) : p));
        out.push(r.seg);
      }
    }
    return { segs: out, pts };
  });
}

// Share of the shorter layout's length that the two layouts have in common.
function overlap(a: Set<Seg>, b: Set<Seg>) {
  let common = 0,
    la = 0,
    lb = 0;
  for (const s of a) {
    la += s.len;
    if (b.has(s)) common += s.len;
  }
  for (const s of b) lb += s.len;
  return common / Math.max(1, Math.max(la, lb));
}

export function buildVenues(elements: OsmElement[]) {
  const ways: Way[] = [];
  const areas: { name: string; bounds: NonNullable<OsmElement["bounds"]> }[] =
    [];
  const relations: OsmElement[] = [];
  const seenIds = new Set<string>();
  for (const e of elements) {
    const key = e.type + e.id;
    if (seenIds.has(key)) continue;
    seenIds.add(key);
    const tags = e.tags ?? {};
    if (e.type === "relation" && tags.type === "circuit") {
      relations.push(e);
      continue;
    }
    const isRaceway =
      e.type === "way" &&
      tags.highway === "raceway" &&
      tags.area !== "yes" &&
      e.geometry &&
      e.nodes &&
      e.geometry.length === e.nodes.length &&
      e.geometry.every(Boolean);
    if (isRaceway) {
      if (EXCLUDED_SPORT.test(tags.sport ?? "")) continue;
      const pts = e.geometry!.map((g) => [g!.lat, g!.lon] as Pt);
      ways.push({
        id: e.id,
        name: tags.name ?? "",
        nodes: e.nodes!,
        pts,
        oneway: onewayOf(tags),
        pit:
          PIT.test(tags.name ?? "") ||
          /pit/.test(tags.raceway ?? "") ||
          tags.service === "pit",
        len: pathLength(pts),
      });
    } else if (tags.name && e.bounds) {
      areas.push({ name: tags.name, bounds: e.bounds });
    }
  }
  const wayById = new Map(ways.map((w) => [w.id, w]));

  // Pieces: ways cut at every node another way uses, so loops can be assembled.
  const uses = new Map<number, number>();
  for (const w of ways)
    for (const n of new Set(w.nodes)) uses.set(n, (uses.get(n) ?? 0) + 1);
  const segsOf = new Map<number, Seg[]>();
  let segId = 0;
  for (const w of ways) {
    const list: Seg[] = [];
    let from = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if (i === w.nodes.length - 1 || (uses.get(w.nodes[i]) ?? 0) > 1) {
        const pts = w.pts.slice(from, i + 1);
        list.push({
          id: segId++,
          way: w,
          a: w.nodes[from],
          b: w.nodes[i],
          pts,
          len: pathLength(pts),
        });
        from = i;
      }
    }
    segsOf.set(w.id, list);
  }

  // Venues: ways that share a node, or come within about 300 m of each other.
  const union = new Union();
  const byNode = new Map<number, number>();
  const grid = new Map<string, number>();
  const cell = 0.0014; // about 150 m, so a 3x3 neighbourhood reaches 150 to 450 m
  for (const w of ways) {
    union.find(w.id);
    for (const n of w.nodes) {
      const other = byNode.get(n);
      if (other !== undefined) union.join(other, w.id);
      else byNode.set(n, w.id);
    }
    for (const p of simplify(w.pts, 20)) {
      const gy = Math.floor(p[0] / cell),
        gx = Math.floor(
          p[1] / (cell / Math.max(0.2, Math.cos((p[0] * Math.PI) / 180))),
        );
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const other = grid.get(`${gy + dy}:${gx + dx}`);
          if (other !== undefined) union.join(other, w.id);
        }
      if (!grid.has(`${gy}:${gx}`)) grid.set(`${gy}:${gx}`, w.id);
    }
  }
  const groups = new Map<number, Way[]>();
  for (const w of ways) {
    const r = union.find(w.id);
    groups.set(r, [...(groups.get(r) ?? []), w]);
  }
  const relationsOf = new Map<number, OsmElement[]>();
  for (const r of relations) {
    const member = r.members?.find(
      (m) => m.type === "way" && wayById.has(m.ref),
    );
    if (!member) continue;
    const root = union.find(member.ref);
    relationsOf.set(root, [...(relationsOf.get(root) ?? []), r]);
  }

  const index: VenueIndexEntry[] = [];
  const cells = new Map<string, Record<string, VenueGeometry>>();
  for (const [root, list] of groups) {
    const total = list.reduce((n, w) => n + w.len, 0);
    if (total < 200) continue;
    // Where it is and what it is called: the named venue area that lies mostly inside
    // it, else a mapped layout's name without its layout part, else any name.
    let s = 90,
      w = 180,
      n = -90,
      e = -180;
    for (const way of list)
      for (const [lat, lon] of way.pts) {
        s = Math.min(s, lat);
        n = Math.max(n, lat);
        w = Math.min(w, lon);
        e = Math.max(e, lon);
      }
    const lat = (s + n) / 2,
      lon = (w + e) / 2;
    const size = Math.max(1e-9, (n - s) * (e - w));
    const around = areas
      .map((a) => {
        const b = a.bounds;
        const own = Math.max(
          1e-9,
          (b.maxlat - b.minlat) * (b.maxlon - b.minlon),
        );
        const common =
          Math.max(0, Math.min(n, b.maxlat) - Math.max(s, b.minlat)) *
          Math.max(0, Math.min(e, b.maxlon) - Math.max(w, b.minlon));
        return {
          name: a.name,
          common,
          fits: common / own >= 0.5 && own < size * 6,
        };
      })
      .filter((a) => a.fits)
      .sort((a, b) => b.common - a.common);
    const closedNamed = list
      .filter(
        (x) => x.name && !x.pit && x.nodes[0] === x.nodes[x.nodes.length - 1],
      )
      .sort((a, b) => b.len - a.len);
    const names = [
      ...(relationsOf.get(root) ?? []).map((r) => r.tags?.name ?? ""),
      ...[...list].sort((a, b) => b.len - a.len).map((x) => x.name),
    ].filter(Boolean);
    const venueName =
      around[0]?.name ||
      venueNameFrom(relationsOf.get(root)?.[0]?.tags?.name ?? "") ||
      venueNameFrom(closedNamed[0]?.name ?? "") ||
      venueNameFrom(names[0] ?? "");
    if (!venueName) continue;
    // "Circuit X - Alternative" reads as "Alternative" inside venue Circuit X.
    const short = (name: string) => {
      const rest = name.startsWith(venueName)
        ? name.slice(venueName.length).replace(/^[\s\-–—:,]+/, "")
        : name;
      return rest || name;
    };

    const layouts: (VenueLayout & { segs: Set<Seg> })[] = [];
    const push = (
      name: string,
      source: LayoutSource,
      pts: Pt[],
      segs: Set<Seg>,
    ) => {
      const lengthM = pathLength(pts);
      if (lengthM < 300) return false;
      // The same loop, or one that differs only by a short parallel piece.
      if (
        layouts.some(
          (l) =>
            overlap(l.segs, segs) > 0.97 ||
            (source === "pieces" &&
              Math.abs(l.lengthM - lengthM) < 0.02 * lengthM &&
              overlap(l.segs, segs) > 0.85),
        )
      )
        return false;
      const taken = layouts.filter(
        (l) => l.name === name || l.name.startsWith(`${name} (`),
      ).length;
      layouts.push({
        name: taken ? `${name} (${taken + 1})` : name,
        source,
        lengthM: Math.round(lengthM),
        path: encodePolyline(simplify(pts)),
        segs,
      });
      return true;
    };
    for (const r of relationsOf.get(root) ?? []) {
      const members = (r.members ?? [])
        .filter((m) => m.type === "way" && !/pit/i.test(m.role))
        .map((m) => wayById.get(m.ref))
        .filter((x): x is Way => !!x);
      if (!members.length) continue;
      push(
        r.tags?.name || "Layout",
        "relation",
        chain(members),
        new Set(members.flatMap((x) => segsOf.get(x.id)!)),
      );
    }
    for (const x of closedNamed)
      push(short(x.name), "way", x.pts, new Set(segsOf.get(x.id)));
    const pieces = list.filter((x) => !x.pit).flatMap((x) => segsOf.get(x.id)!);
    const assembled = loops(pieces)
      .map((l) => ({ ...l, len: pathLength(l.pts) }))
      .sort((a, b) => b.len - a.len);
    const main = assembled[0];
    let added = 0;
    for (const l of assembled) {
      if (added >= 6) break;
      // Name a variant after the longest named piece the longest loop does not use.
      const extra = l.segs
        .filter((x) => x.way.name && !main.segs.includes(x))
        .sort((a, b) => b.way.len - a.way.len)[0]?.way.name;
      // Short loops without a piece of their own are fragments, such as a pit bypass.
      if (l !== main && !extra && l.len < 0.4 * main.len) continue;
      const named = [...new Set(l.segs.map((x) => x.way.name).filter(Boolean))];
      // A loop that is mostly one named open way, such as the Nordschleife, takes its name.
      const share = new Map<Way, number>();
      for (const x of l.segs)
        if (
          x.way.name &&
          x.way.nodes[0] !== x.way.nodes[x.way.nodes.length - 1]
        )
          share.set(x.way, (share.get(x.way) ?? 0) + x.len);
      const dominant = [...share].find(([, m]) => m >= 0.6 * l.len)?.[0];
      const name = dominant
        ? short(dominant.name)
        : l === main
          ? named.length === 1
            ? short(named[0])
            : "Full loop"
          : extra
            ? `Via ${short(extra)}`
            : "Loop";
      if (push(name, "pieces", l.pts, new Set(l.segs))) added++;
    }
    layouts.sort((a, b) => b.lengthM - a.lengthM);
    const aliases = [...new Set([...around.map((a) => a.name), ...names])]
      .filter((x) => x !== venueName)
      .slice(0, 40);
    const cellKey = `${Math.floor(lat / 2) * 2}_${Math.floor(lon / 2) * 2}`;
    const id = `w${root}`;
    index.push({
      id,
      name: venueName,
      lat: +lat.toFixed(5),
      lon: +lon.toFixed(5),
      bbox: [+s.toFixed(5), +w.toFixed(5), +n.toFixed(5), +e.toFixed(5)],
      cell: cellKey,
      aliases,
      layouts: layouts.map((l) => ({
        name: l.name,
        lengthM: l.lengthM,
        source: l.source,
      })),
    });
    // Drawn pieces: those that join a layout (pit lanes and links included). Mapped
    // ground that touches no layout, such as a skid pad or a paddock outline, is left out.
    const layoutNodes = new Set<number>();
    for (const l of layouts)
      for (const seg of l.segs)
        for (const n of seg.way.nodes) layoutNodes.add(n);
    const drawn = layouts.length
      ? list.filter((way) => way.nodes.some((n) => layoutNodes.has(n)))
      : list;
    const geometry: VenueGeometry = {
      pieces: drawn.map((way) => ({
        p: encodePolyline(simplify(way.pts)),
        ...(way.pit ? { pit: 1 as const } : {}),
      })),
      layouts: layouts.map(({ segs: _segs, ...l }) => l),
    };
    cells.set(cellKey, { ...(cells.get(cellKey) ?? {}), [id]: geometry });
  }
  index.sort((a, b) => a.name.localeCompare(b.name));
  return { index, cells };
}
