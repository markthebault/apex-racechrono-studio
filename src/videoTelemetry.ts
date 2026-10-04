// GoPro GPMF specification: https://github.com/gopro/gpmf-parser/tree/main/docs
// Sensor values stay in their recorded axis order. A mount is not a vehicle frame.
import type { Session } from "./model";
export type MotionSample = { t: number; v: [number, number, number] };
export type GpsSample = {
  t: number;
  lat: number;
  lon: number;
  altitude?: number;
  speed?: number;
  utc?: number;
  fix: number;
  dop?: number;
};
export type CameraMotion = {
  acceleration: MotionSample[];
  gyro: MotionSample[];
  gps?: GpsSample[];
  model?: string;
  warnings?: string[];
  schema?: string;
  orientationSamples?: number;
};
const ascii = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0/g, "");
type Box = { type: string; at: number; end: number };
function boxes(b: Uint8Array, from = 0, end = b.length): Box[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength),
    result: Box[] = [];
  for (let p = from; p + 8 <= end;) {
    let size = d.getUint32(p),
      header = 8;
    if (size === 1) {
      if (p + 16 > end) throw Error("Truncated MP4 box.");
      size = Number(d.getBigUint64(p + 8));
      header = 16;
    }
    if (!size) size = end - p;
    if (!Number.isSafeInteger(size) || size < header || p + size > end)
      throw Error("Invalid MP4 box.");
    result.push({
      type: ascii(b.subarray(p + 4, p + 8)),
      at: p + header,
      end: p + size,
    });
    p += size;
  }
  return result;
}
function numbers(b: Uint8Array, type: string): number[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const widths: Record<string, number> = {
    b: 1,
    B: 1,
    s: 2,
    S: 2,
    l: 4,
    L: 4,
    f: 4,
    d: 8,
    j: 8,
    J: 8,
  };
  const width = widths[type];
  if (!width || b.length % width) throw Error("Unsupported GPMF numeric type.");
  return Array.from({ length: b.length / width }, (_, i) => {
    const p = i * width;
    switch (type) {
      case "b":
        return d.getInt8(p);
      case "B":
        return d.getUint8(p);
      case "s":
        return d.getInt16(p);
      case "S":
        return d.getUint16(p);
      case "l":
        return d.getInt32(p);
      case "L":
        return d.getUint32(p);
      case "f":
        return d.getFloat32(p);
      case "d":
        return d.getFloat64(p);
      case "j":
        return Number(d.getBigInt64(p));
      default:
        return Number(d.getBigUint64(p));
    }
  });
}
export function parseGpmf(
  b: Uint8Array,
  start: number,
  duration: number,
): CameraMotion {
  const result: CameraMotion = { acceleration: [], gyro: [], gps: [] };
  function nest(data: Uint8Array, depth = 0) {
    if (depth > 8) throw Error("GPMF nesting is too deep.");
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let scale = [1],
      unit = "",
      offset = 0,
      gpsUtc = NaN,
      gpsFix = 0,
      gpsDop = NaN,
      complexType = "";
    for (let p = 0; p + 8 <= data.length;) {
      const key = ascii(data.subarray(p, p + 4)),
        type = String.fromCharCode(data[p + 4]);
      const size = data[p + 5],
        count = d.getUint16(p + 6),
        length = size * count;
      if (p + 8 + length > data.length) throw Error("Truncated GPMF payload.");
      const value = data.subarray(p + 8, p + 8 + length);
      if (data[p + 4] === 0) nest(value, depth + 1);
      else if (key === "SCAL") scale = numbers(value, type);
      else if (key === "SIUN" || key === "UNIT") unit = ascii(value);
      else if (key === "TIMO") offset = numbers(value, type)[0];
      else if (key === "TYPE") complexType = ascii(value);
      else if (key === "DVNM" && !result.model) result.model = ascii(value);
      else if (key === "GPSU") {
        const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2}(?:\.\d+)?)/.exec(
          ascii(value),
        );
        if (m)
          gpsUtc =
            Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0) +
            +m[6] * 1000;
      } else if (key === "GPSF") gpsFix = numbers(value, type)[0];
      else if (key === "GPSP") gpsDop = numbers(value, type)[0] / 100;
      else if (key === "GPS5" || key === "GPS9") {
        const width = key === "GPS5" ? 5 : 9;
        let values: number[];
        if (type === "?") {
          if (complexType !== "lllllllSS" || size !== 32)
            throw Error("Unsupported GPS9 structure.");
          const view = new DataView(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          );
          values = Array.from({ length: count }, (_, i) =>
            Array.from({ length: 9 }, (_, j) =>
              j < 7
                ? view.getInt32(i * 32 + j * 4)
                : view.getUint16(i * 32 + 28 + (j - 7) * 2),
            ),
          ).flat();
        } else values = numbers(value, type);
        if (
          values.length !== count * width ||
          ![1, width].includes(scale.length) ||
          scale.some((n) => !Number.isFinite(n) || !n)
        )
          throw Error("Invalid GPMF GPS structure.");
        for (let i = 0; i < count; i++) {
          const v = values
            .slice(i * width, (i + 1) * width)
            .map((n, j) => n / scale[j % scale.length]);
          const t = start + (duration * i) / count - offset;
          const utc =
            key === "GPS9"
              ? Date.UTC(2000, 0, 1) + v[5] * 86400000 + v[6] * 1000
              : gpsUtc + ((duration * i) / count) * 1000;
          const point: GpsSample = {
            t,
            lat: v[0],
            lon: v[1],
            altitude: v[2],
            speed: v[3],
            fix: key === "GPS9" ? v[8] : gpsFix,
            dop: key === "GPS9" ? v[7] : gpsDop,
            ...(Number.isFinite(utc) ? { utc } : {}),
          };
          if (
            Number.isFinite(t) &&
            Math.abs(point.lat) <= 90 &&
            Math.abs(point.lon) <= 180 &&
            Number.isFinite(point.speed) &&
            point.speed! >= 0
          )
            result.gps!.push(point);
        }
      } else if (key === "ACCL" || key === "GYRO") {
        const values = numbers(value, type);
        if (
          !count ||
          values.length !== count * 3 ||
          (scale.length !== 1 && scale.length !== 3) ||
          scale.some((s) => !Number.isFinite(s) || s === 0)
        )
          throw Error("Unsupported GPMF sensor structure.");
        const factor =
          key === "ACCL"
            ? unit === "g"
              ? 1
              : unit.startsWith("m/s")
                ? 1 / 9.80665
                : NaN
            : unit.startsWith("rad/s")
              ? 1
              : unit.startsWith("deg/s")
                ? Math.PI / 180
                : NaN;
        if (!Number.isFinite(factor))
          throw Error(`Unsupported ${key} units: ${unit || "missing"}.`);
        for (let i = 0; i < count; i++) {
          const v = values
            .slice(i * 3, i * 3 + 3)
            .map((n, j) => (n / scale[j % scale.length]) * factor) as [
            number,
            number,
            number,
          ];
          if (v.some((n) => !Number.isFinite(n)))
            throw Error("Invalid sensor value.");
          result[key === "ACCL" ? "acceleration" : "gyro"].push({
            t: start + (duration * i) / count - offset,
            v,
          });
        }
      }
      p += 8 + Math.ceil(length / 4) * 4;
    }
  }
  nest(b);
  return result;
}
// Read only the movie index and telemetry samples, never the multi-GB video payload.
export async function readMetadataTrack(
  file: Blob,
  types: string[],
  onPacket: (
    data: Uint8Array,
    t: number,
    duration: number,
    type: string,
  ) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const check = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  let moov: Uint8Array | undefined;
  for (let p = 0; p + 8 <= file.size;) {
    check();
    const h = new Uint8Array(await file.slice(p, p + 16).arrayBuffer());
    const d = new DataView(h.buffer);
    let size = d.getUint32(0),
      header = 8;
    if (size === 1) {
      size = Number(d.getBigUint64(8));
      header = 16;
    }
    if (!size) size = file.size - p;
    if (!Number.isSafeInteger(size) || size < header || p + size > file.size)
      throw Error("Invalid MP4 index.");
    if (ascii(h.subarray(4, 8)) === "moof")
      throw Error(
        "Fragmented MP4 telemetry is not supported. Use the original GoPro MP4.",
      );
    if (ascii(h.subarray(4, 8)) === "moov") {
      if (size > 64 * 1024 * 1024) throw Error("MP4 index exceeds 64 MB.");
      moov = new Uint8Array(
        await file.slice(p + header, p + size).arrayBuffer(),
      );
      break;
    }
    p += size;
  }
  if (!moov) throw Error("No MP4 movie index found.");
  let found = false,
    total = 0;
  for (const track of boxes(moov).filter((b) => b.type === "trak")) {
    const child = (parent: Box, type: string) =>
      boxes(moov!, parent.at, parent.end).find((b) => b.type === type);
    const mdia = child(track, "mdia"),
      minf = mdia && child(mdia, "minf"),
      stbl = minf && child(minf, "stbl");
    if (!mdia || !stbl) continue;
    const stsd = child(stbl, "stsd");
    if (!stsd) continue;
    const entries = boxes(moov, stsd.at + 8, stsd.end);
    if (!entries.some((b) => types.includes(b.type))) continue;
    found = true;
    // Edited timelines need explicit handling rather than silently shifted graphs.
    const edts = child(track, "edts");
    const timelineOffset = 0;
    if (edts) {
      const elst = child(edts, "elst");
      if (elst) {
        const v = new DataView(
          moov.buffer,
          moov.byteOffset + elst.at,
          elst.end - elst.at,
        );
        if (
          v.getUint8(0) !== 0 ||
          v.getUint32(4) !== 1 ||
          v.getInt32(12) !== 0 ||
          v.getInt16(16) !== 1 ||
          v.getInt16(18) !== 0
        )
          throw Error(
            "Edited camera telemetry timeline is unsupported. Use the original MP4.",
          );
      }
    }
    const table = (type: string) => {
      const box = child(stbl, type);
      if (!box) throw Error(`Missing MP4 ${type} table.`);
      return new DataView(
        moov!.buffer,
        moov!.byteOffset + box.at,
        box.end - box.at,
      );
    };
    const mdhd = child(mdia, "mdhd");
    if (!mdhd) throw Error("Missing telemetry clock.");
    const clock = new DataView(
      moov.buffer,
      moov.byteOffset + mdhd.at,
      mdhd.end - mdhd.at,
    );
    const rate = clock.getUint32(clock.getUint8(0) === 1 ? 20 : 12);
    if (!rate) throw Error("Invalid telemetry clock.");
    if (child(stbl, "ctts"))
      throw Error("Telemetry composition offsets are unsupported.");
    const sz = table("stsz"),
      count = sz.getUint32(8),
      fixed = sz.getUint32(4);
    if (count > 2000000) throw Error("Too many telemetry packets.");
    const sizes = Array.from(
      { length: count },
      (_, i) => fixed || sz.getUint32(12 + i * 4),
    );
    const durations: number[] = [],
      stts = table("stts");
    for (let i = 0; i < stts.getUint32(4); i++) {
      const n = stts.getUint32(8 + i * 8),
        delta = stts.getUint32(12 + i * 8);
      if (!delta || durations.length + n > count)
        throw Error("Invalid telemetry timing.");
      for (let j = 0; j < n; j++) durations.push(delta / rate);
    }
    if (durations.length !== count)
      throw Error("Telemetry timing does not match packets.");
    const co64 = !!child(stbl, "co64"),
      offsets = table(co64 ? "co64" : "stco"),
      sc = table("stsc");
    const chunks = Array.from({ length: sc.getUint32(4) }, (_, i) => ({
      first: sc.getUint32(8 + i * 12),
      n: sc.getUint32(12 + i * 12),
      description: sc.getUint32(16 + i * 12),
    }));
    let sample = 0,
      t = timelineOffset,
      rule = 0;
    for (let c = 1; c <= offsets.getUint32(4); c++) {
      check();
      while (rule + 1 < chunks.length && chunks[rule + 1].first <= c) rule++;
      const entry = chunks[rule];
      if (
        !entry ||
        entry.first > c ||
        !types.includes(entries[entry.description - 1]?.type)
      )
        throw Error("Invalid telemetry chunk map.");
      let at = co64
        ? Number(offsets.getBigUint64(8 + (c - 1) * 8))
        : offsets.getUint32(8 + (c - 1) * 4);
      if (sample + entry.n > count)
        throw Error("Invalid telemetry chunk sample count.");
      for (let j = 0; j < entry.n;) {
        check();
        // Small CAMM/DJI samples share a contiguous chunk. Read bounded batches,
        // rather than requesting hundreds of thousands of tiny Blob slices.
        let n = 0,
          length = 0;
        while (j + n < entry.n) {
          const size = sizes[sample + n];
          if (!size || size > 16 * 1024 * 1024)
            throw Error("Invalid or excessive telemetry payload.");
          if (n && length + size > 8 * 1024 * 1024) break;
          length += size;
          n++;
        }
        if (at + length > file.size || (total += length) > 128 * 1024 * 1024)
          throw Error("Invalid or excessive telemetry payload.");
        const bytes = new Uint8Array(
          await file.slice(at, at + length).arrayBuffer(),
        );
        let offset = 0;
        for (let k = 0; k < n; k++) {
          check();
          const size = sizes[sample];
          await onPacket(
            bytes.subarray(offset, offset + size),
            t,
            durations[sample],
            entries[entry.description - 1].type,
          );
          t += durations[sample++];
          offset += size;
        }
        at += length;
        j += n;
      }
    }
    if (sample !== count) throw Error("Incomplete telemetry chunk map.");
  }
  if (!found)
    throw Error(
      `No ${types.join("/")} telemetry track. Use an original camera file; edited exports often remove telemetry.`,
    );
}
export async function readGoProMotion(
  file: Blob,
  signal?: AbortSignal,
): Promise<CameraMotion> {
  const result: CameraMotion = { acceleration: [], gyro: [], gps: [] };
  await readMetadataTrack(
    file,
    ["gpmd"],
    (data, t, duration) => {
      const motion = parseGpmf(data, t, duration);
      if (
        result.acceleration.length + motion.acceleration.length > 2000000 ||
        result.gyro.length + motion.gyro.length > 2000000
      )
        throw Error(
          "Telemetry exceeds two million samples. Select a shorter clip.",
        );
      result.acceleration.push(...motion.acceleration);
      result.gyro.push(...motion.gyro);
      result.gps!.push(...motion.gps!);
      result.model ||= motion.model;
    },
    signal,
  );
  if (!result.acceleration.length && !result.gyro.length && !result.gps!.length)
    throw Error("No motion or GPS samples in this GoPro video.");
  return result;
}
export type GraphPoint = { t: number; g: number };
export function sessionAcceleration(session: Session): GraphPoint[] {
  const speed = session.channels.find((c) => c.id === "speed");
  if (!speed) return [];
  const factor =
    speed.unit === "mph" ? 0.44704 : speed.unit === "m/s" ? 1 : 1 / 3.6;
  return Array.from(speed.times, (t, i) => {
    const a = Math.max(0, i - 1),
      b = Math.min(speed.times.length - 1, i + 1),
      dt = (speed.times[b] - speed.times[a]) / 1000;
    const gap =
      (i > 0 && t - speed.times[i - 1] > 2000) ||
      (i + 1 < speed.times.length && speed.times[i + 1] - t > 2000);
    return {
      t: t / 1000,
      g:
        dt > 0 && !gap
          ? ((speed.values[b] - speed.values[a]) * factor) / dt / 9.80665
          : NaN,
    };
  });
}
export function cameraAcceleration(
  samples: MotionSample[],
  axis: number,
  invert: boolean,
  baseline: number,
): GraphPoint[] {
  // 100 ms bins reduce vibration without bridging missing intervals.
  const bins = new Map<number, { t: number; sum: number; n: number }>();
  for (const s of samples) {
    const key = Math.floor(s.t * 10),
      bin = bins.get(key) ?? { t: s.t, sum: 0, n: 0 };
    bin.sum += s.v[axis];
    bin.n++;
    bins.set(key, bin);
  }
  return [...bins.values()].map((b) => ({
    t: b.t,
    g: (b.sum / b.n - baseline) * (invert ? -1 : 1),
  }));
}
