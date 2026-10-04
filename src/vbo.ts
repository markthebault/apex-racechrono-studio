import type { Channel, Session } from "./model";
import { definitions } from "./model";

const KMH_PER_MPH = 1.609344;
const DAY = 86400000;

// Track name from a filename such as dragylap_20250418_165151_Salzburgring.vbo.
export function trackFromFilename(name: string) {
  const base = name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const words = base
    .split(/[_\-\s]+/)
    .filter((w) => w && !/^\d+$/.test(w) && !/^dragy(lap)?$/i.test(w));
  return words.join(" ") || "Unnamed track";
}
// Stable, negative id for tracks that have no RaceChrono id, so it never collides.
export function trackIdFromName(name: string) {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) | 0;
  return -(Math.abs(h) || 1);
}

// Racelogic VBO, as written by VBOX loggers, Dragy, RaceChrono and others: text sections,
// time as HHMMSS.sss in UTC without a date, coordinates in minutes of arc with west
// positive. A VBO usually has no laps, so the session comes back without any; they are
// worked out afterwards from a finish line.
export function decodeVbo(
  bytes: Uint8Array,
  filename: string,
  id: string,
): Session {
  if (bytes.length > 256 * 1024 * 1024)
    throw Error("Session exceeds the 256 MB import limit.");
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
  const section = (name: string) =>
    lines.findIndex((l) => l.trim().toLowerCase() === `[${name}]`);
  const at = section("data");
  if (at < 0) throw Error("Not a VBO file: the [data] section is missing.");
  const block = (name: string) => {
    const s = section(name);
    if (s < 0) return [];
    const out: string[] = [];
    for (let i = s + 1; i < lines.length && !/^\s*\[/.test(lines[i]); i++)
      if (lines[i].trim()) out.push(lines[i].trim());
    return out;
  };

  const rows: string[][] = [];
  for (let i = at + 1; i < lines.length; i++)
    if (lines[i].trim() && !lines[i].trim().startsWith("["))
      rows.push(lines[i].trim().split(/\s+/));
  const width = rows.reduce(
    (best, r) => (r.length > best ? r.length : best),
    0,
  );
  if (!rows.length) throw Error("The VBO file has no data rows.");

  // Column names: the [column names] line when it matches the data, otherwise [header].
  const tokens = (block("column names")[0] || "").split(/\s+/).filter(Boolean);
  const headerNames = block("header");
  const names =
    tokens.length === width
      ? tokens
      : headerNames.length === width
        ? headerNames
        : [];
  if (!names.length)
    throw Error("The VBO column names do not match the data columns.");
  const lower = names.map((n) => n.toLowerCase());
  const col = (...options: RegExp[]) =>
    lower.findIndex((n) => options.some((o) => o.test(n)));
  const iTime = col(/^time$/),
    iLat = col(/^lat(itude)?$/),
    iLon = col(/^lon(g|gitude)?$/),
    iSpeed = col(/^(velocity|speed)/),
    iHead = col(/^head(ing)?$/),
    iHeight = col(/^(height|alt)/),
    iSats = col(/^sat(s|ellites)?$/);
  if (iTime < 0 || iLat < 0 || iLon < 0)
    throw Error("The VBO file needs time, latitude and longitude columns.");
  const mph = iSpeed >= 0 && /mph/.test(lower[iSpeed] + headerNames[iSpeed]);

  // The date is only in the text; the times are UTC time of day.
  const text = lines.slice(0, at).join("\n");
  const stamp =
    /UTC Date Started:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/i.exec(
      text,
    ) ||
    /File created on\s+(\d{2})\/(\d{2})\/(\d{4})\s*@?\s*(\d{2}):(\d{2})/i.exec(
      text,
    );
  if (!stamp)
    throw Error("The VBO file does not say what day it was recorded.");
  const day0 = Date.UTC(+stamp[3], +stamp[2] - 1, +stamp[1]);
  const headerTod = (+stamp[4] * 3600 + +stamp[5] * 60) * 1000;

  const tod = (x: number) => {
    const h = Math.floor(x / 10000),
      m = Math.floor((x % 10000) / 100),
      s = x % 100;
    return (h * 3600 + m * 60 + s) * 1000;
  };
  const t: number[] = [],
    la: number[] = [],
    lo: number[] = [];
  const extra = new Map<number, number[]>();
  const keep = names
    .map((_, i) => i)
    .filter((i) => ![iTime, iLat, iLon].includes(i));
  for (const i of keep) extra.set(i, []);
  let dayShift = 0,
    prev = NaN,
    first = true,
    skipped = 0;
  for (const r of rows) {
    if (r.length !== width) {
      skipped++;
      continue;
    }
    const v = r.map(Number);
    if (
      !Number.isFinite(v[iTime]) ||
      !Number.isFinite(v[iLat]) ||
      !Number.isFinite(v[iLon])
    ) {
      skipped++;
      continue;
    }
    let ms = tod(v[iTime]);
    if (first) {
      // Pick the day so the first sample sits within 12 hours of the stated start.
      if (ms - headerTod < -12 * 3600000) dayShift = 1;
      else if (ms - headerTod > 12 * 3600000) dayShift = -1;
      first = false;
    } else if (ms + dayShift * DAY < prev - 12 * 3600000) dayShift++;
    ms += dayShift * DAY;
    const lat = v[iLat] / 60,
      lon = -v[iLon] / 60;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) {
      skipped++;
      continue;
    }
    const time = day0 + ms;
    // Repeated or backwards timestamps cannot be kept.
    if (t.length && time <= t[t.length - 1]) {
      skipped++;
      continue;
    }
    prev = ms;
    t.push(time);
    la.push(lat);
    lo.push(lon);
    for (const i of keep) extra.get(i)!.push(v[i]);
  }
  if (t.length < 2) throw Error("The VBO file has no usable GPS rows.");

  const times = Float64Array.from(t);
  const channels: Channel[] = [];
  const add = (id: string, values: number[], source: string, scale = 1) =>
    channels.push({
      id,
      ...(definitions[id] || { name: id, unit: "raw" }),
      times,
      values: Float64Array.from(values, (x) => x * scale),
      source,
    });
  const named: [number, string, number][] = [
    [iSpeed, "speed", mph ? KMH_PER_MPH : 1],
    [iHead, "heading", 1],
    [iHeight, "altitude", 1],
    [iSats, "satellites", 1],
  ];
  for (const [i, id, scale] of named)
    if (i >= 0) add(id, extra.get(i)!, `column ${names[i]}`, scale);
  for (const i of keep)
    if (!named.some(([n]) => n === i) && extra.get(i)!.every(Number.isFinite))
      channels.push({
        id: `Raw column ${names[i]}`,
        name:
          definitions[`Raw column ${names[i]}`]?.name || `Raw column ${names[i]}`,
        unit: "raw",
        times,
        values: Float64Array.from(extra.get(i)!),
        source: `column ${names[i]}`,
      });

  const track = trackFromFilename(filename);
  return {
    id,
    filename,
    size: bytes.length,
    track,
    trackId: trackIdFromName(track),
    start: times[0],
    end: times[times.length - 1],
    importedOptimal: NaN,
    times,
    lat: Float64Array.from(la),
    lon: Float64Array.from(lo),
    channels,
    laps: [],
    unknown: skipped ? [`${skipped} rows skipped`] : [],
    format: "vbo",
  };
}
