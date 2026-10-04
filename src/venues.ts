import type {
  LayoutSource,
  VenueGeometry,
  VenueIndexEntry,
} from "./venueBuild";
import type { TrackSummary } from "./tracks";

export type { LayoutSource, VenueGeometry, VenueIndexEntry };
export type Venue = VenueIndexEntry;
export type VenueShape = {
  pieces: { points: [number, number][]; pit: boolean }[];
  layouts: {
    name: string;
    lengthM: number;
    source: LayoutSource;
    points: [number, number][];
  }[];
};

export function decodePolyline(text: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0,
    lat = 0,
    lon = 0;
  const next = () => {
    let shift = 0,
      result = 0,
      b: number;
    do {
      b = text.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < text.length) {
    lat += next();
    lon += next();
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

export function decodeVenue(g: VenueGeometry): VenueShape {
  return {
    pieces: g.pieces.map((x) => ({
      points: decodePolyline(x.p),
      pit: !!x.pit,
    })),
    layouts: g.layouts.map(({ path, ...l }) => ({
      ...l,
      points: decodePolyline(path),
    })),
  };
}

// The venue a recorded track belongs to: the smallest venue whose outline contains the
// middle of the trace, allowing a few hundred metres for GPS and mapping differences.
export function venueOf(
  track: Pick<TrackSummary, "outline">,
  venues: Venue[],
): Venue | undefined {
  if (!track.outline.length) return;
  let s = 90,
    w = 180,
    n = -90,
    e = -180;
  for (const [lat, lon] of track.outline) {
    s = Math.min(s, lat);
    n = Math.max(n, lat);
    w = Math.min(w, lon);
    e = Math.max(e, lon);
  }
  const lat = (s + n) / 2,
    lon = (w + e) / 2,
    pad = 0.004;
  let best: Venue | undefined,
    area = Infinity;
  for (const v of venues) {
    if (!v.cell) continue;
    const [vs, vw, vn, ve] = v.bbox;
    if (lat < vs - pad || lat > vn + pad || lon < vw - pad || lon > ve + pad)
      continue;
    const a = (vn - vs) * (ve - vw);
    if (a < area) {
      area = a;
      best = v;
    }
  }
  return best;
}

// Venues whose name, or the name of any layout or corner in them, contains the query.
export function searchVenues(venues: Venue[], query: string, limit = 30) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: { venue: Venue; via?: string }[] = [];
  for (const v of venues) {
    if (v.name.toLowerCase().includes(q)) hits.push({ venue: v });
    else {
      const via = v.aliases.find((a) => a.toLowerCase().includes(q));
      if (via) hits.push({ venue: v, via });
    }
  }
  // Name matches first, then venues with more mapped layouts.
  return hits
    .sort(
      (a, b) =>
        Number(!!a.via) - Number(!!b.via) ||
        b.venue.layouts.length - a.venue.layouts.length,
    )
    .slice(0, limit);
}

export const layoutSourceText: Record<LayoutSource, string> = {
  relation: "Mapped as a named layout by OpenStreetMap contributors.",
  way: "Mapped as one closed loop in OpenStreetMap.",
  pieces:
    "Assembled from mapped track pieces. Check it against the circuit's own map.",
};

export function catalogVenues(data: {
  venues?: Venue[];
  tracks?: { id: string; name: string; lat: number; lon: number }[];
}): Venue[] {
  const venues = data.venues ?? [];
  const ids = new Set(venues.map((v) => v.id));
  return [
    ...venues,
    ...(data.tracks ?? [])
      .filter((t) => !ids.has(t.id))
      .map((t) => ({
        ...t,
        bbox: [t.lat, t.lon, t.lat, t.lon] as [number, number, number, number],
        cell: "",
        aliases: [],
        layouts: [],
      })),
  ];
}
