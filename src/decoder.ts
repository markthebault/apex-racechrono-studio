import { unzipSync, strFromU8 } from "fflate";
import type { Session, Channel } from "./model";
import { definitions } from "./model";
export function decode(
  bytes: Uint8Array,
  filename: string,
  id: string,
): Session {
  if (bytes.length > 256 * 1024 * 1024)
    throw Error("Session exceeds the 256 MB import limit.");
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (f.originalSize > 256 * 1024 * 1024)
        throw Error("Archive entry is too large.");
      return true;
    },
  });
  if (!files["session.json"])
    throw Error("Not a RaceChrono archive: session.json is missing.");
  const meta = JSON.parse(strFromU8(files["session.json"]));
  if (meta.version !== 1 || !Array.isArray(meta.laps))
    throw Error("Unsupported RaceChrono session version.");
  const keys = Object.keys(files);
  const gps = keys.find((k) => /^channel_1_\d+_0_1_1$/.test(k));
  if (!gps) throw Error("No supported GPS timestamp channel found.");
  const base = gps.slice(0, -3);
  const used = new Set<string>();
  function read(name: string, kind: "i32" | "i64" | "f64", scale = 1) {
    const b = files[name];
    if (!b) throw Error(`Missing channel ${name}`);
    used.add(name);
    const step = kind === "i32" ? 4 : 8;
    if (b.length % step) throw Error(`Truncated channel ${name}`);
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return Float64Array.from(
      { length: b.length / step },
      (_, i) =>
        (kind === "i32"
          ? view.getInt32(i * step, true)
          : kind === "i64"
            ? Number(view.getBigInt64(i * step, true))
            : view.getFloat64(i * step, true)) * scale,
    );
  }
  const times = read(gps, "i64");
  const coords = read(base + "3_1", "i32", 1 / 6000000);
  if (coords.length !== times.length * 2 || times.length < 2)
    throw Error("GPS coordinates and timestamps do not match.");
  const lat = Float64Array.from(times, (_, i) => coords[i * 2]);
  const lon = Float64Array.from(times, (_, i) => coords[i * 2 + 1]);
  for (let i = 0; i < times.length; i++)
    if (
      !Number.isFinite(times[i]) ||
      (i && times[i] <= times[i - 1]) ||
      Math.abs(lat[i]) > 90 ||
      Math.abs(lon[i]) > 180
    )
      throw Error("Invalid GPS coordinates or timestamp order.");
  const channels: Channel[] = [];
  function add(id: string, t: Float64Array, v: Float64Array, source: string) {
    if (t.length !== v.length) throw Error(`Channel length mismatch: ${id}`);
    for (let i = 0; i < t.length; i++)
      if (!Number.isFinite(v[i]) || (i && t[i] <= t[i - 1]))
        throw Error(`Invalid channel ${id}`);
    channels.push({
      id,
      ...(definitions[id] || { name: id, unit: "raw" }),
      times: t,
      values: v,
      source,
    });
  }
  for (const [suffix, id, scale] of [
    ["4_0", "speed", 0.0036],
    ["5_0", "altitude", 0.001],
    ["6_0", "heading", 0.001],
    ["30002_0", "satellites", 1],
  ] as const)
    if (files[base + suffix])
      add(id, times, read(base + suffix, "i32", scale), base + suffix);
  const obd: Record<string, string> = {
    "4": "obdSpeed",
    "10024": "rpm",
    "10025": "throttle",
    "10026": "coolant",
    "10029": "intake",
  };
  for (const key of keys) {
    const m = key.match(/^channel2_(5_\d+)_(\d+)_\2_3$/);
    if (!m) continue;
    const name = obd[m[2]] || `Raw channel ${m[2]}`;
    const timeKey = `channel_${m[1]}_${m[2]}_1_1`;
    add(
      name,
      read(timeKey, "i64"),
      read(key, "f64", name === "obdSpeed" ? 3.6 : 1),
      key,
    );
  }
  for (const key of keys) {
    if (
      used.has(key) ||
      !key.startsWith(base) ||
      !key.endsWith("_0") ||
      files[key].length !== times.length * 4
    )
      continue;
    add(
      `Raw GPS channel ${key.slice(base.length, -2)}`,
      times,
      read(key, "i32"),
      key,
    );
  }
  // RaceChrono lists the lap still running when recording stopped without a finish
  // time. It was never timed, so it is left out rather than treated as corrupt.
  const finished = meta.laps.filter(
    (l: { finishTimestamp?: number | null }) =>
      l.finishTimestamp !== undefined && l.finishTimestamp !== null,
  );
  const laps = finished.map(
    (l: {
      number: number;
      startTimestamp: number;
      finishTimestamp: number;
      isInvalid: boolean;
    }) => {
      if (
        !Number.isFinite(l.startTimestamp) ||
        !Number.isFinite(l.finishTimestamp) ||
        l.finishTimestamp <= l.startTimestamp
      )
        throw Error("Invalid lap boundaries.");
      return {
        id: `${id}:${l.number}`,
        number: l.number,
        start: l.startTimestamp,
        end: l.finishTimestamp,
        issues: l.isInvalid ? ["Marked invalid by RaceChrono"] : [],
      };
    },
  );
  const durations = laps
    .map((l: { start: number; end: number }) => l.end - l.start)
    .sort((a: number, b: number) => a - b);
  const median = durations[Math.floor((durations.length - 1) / 2)];
  for (const l of laps) {
    if (l.end - l.start > median * 1.8)
      l.issues.push("Interrupted lap: unusually long duration");
    if (l.start < times[0] || l.end > times[times.length - 1])
      l.issues.push("Incomplete GPS coverage");
    for (let i = 1; i < times.length; i++)
      if (
        times[i] >= l.start &&
        times[i - 1] <= l.end &&
        times[i] - times[i - 1] > 2000
      ) {
        l.issues.push("GPS gap longer than 2 seconds");
        break;
      }
  }
  return {
    id,
    filename,
    size: bytes.length,
    track: meta.trackName || "Unnamed track",
    trackId: meta.trackId,
    start: meta.firstTimestamp,
    end: meta.latestTimestamp,
    importedOptimal: meta.optimalLaptime,
    times,
    lat,
    lon,
    channels,
    laps,
    unknown: keys.filter((k) => k.startsWith("channel") && !used.has(k)),
  };
}
