import { readGoProMotion, readMetadataTrack } from "./videoTelemetry";
import type { CameraMotion, GpsSample, MotionSample } from "./videoTelemetry";
import { protobuf, message, numeric, stringField } from "./protobuf";
export type CameraFormat = "none" | "auto" | "gopro" | "dji" | "insta360";
export const cameraFormats = [
  { id: "none", name: "No camera telemetry" },
  { id: "auto", name: "Detect camera automatically" },
  { id: "gopro", name: "GoPro · GPMF" },
  { id: "dji", name: "DJI Osmo Action · DJI metadata" },
  { id: "insta360", name: "Insta360 · original MP4 / INSV" },
] as const;
function cancelled(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
function validGps(p: GpsSample) {
  return (
    [p.t, p.lat, p.lon].every(Number.isFinite) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lon) <= 180
  );
}
function sample(t: number, v: number[]): MotionSample | undefined {
  return Number.isFinite(t) && v.length === 3 && v.every(Number.isFinite)
    ? { t, v: v as [number, number, number] }
    : undefined;
}

// DJI field paths: https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/DJI.pm
// Action 4/5/6 accelerometer values are recorded in g; fusion attitudes are not raw gyro.
export function parseDjiPacket(
  bytes: Uint8Array,
  t: number,
  duration: number,
  out: CameraMotion,
) {
  const root = protobuf(bytes),
    header = message(root, 1, 1);
  const schema = stringField(header, 1);
  if (schema) out.schema = schema;
  out.model = stringField(header, 10) ?? out.model;
  const action = /^dvtm_ac20[346]\.proto$/.test(out.schema ?? "");
  const fusion = /(?:wm169|wa530|WA530|oq101)/.test(out.schema ?? "");
  if (!action && !fusion)
    throw Error(
      `Unsupported DJI metadata schema: ${out.schema ?? "missing header"}. Use manual sync for this clip.`,
    );
  const frames = root.get(3) ?? [];
  let firstClock: number | undefined;
  for (let i = 0; i < frames.length; i++) {
    const field = frames[i];
    if (!(field.value instanceof Uint8Array)) continue;
    const frame = protobuf(field.value),
      frameClock = numeric(message(frame, 1), 2);
    firstClock ??= frameClock;
    const time =
      frames.length === 1
        ? t
        : frameClock !== undefined && firstClock !== undefined
          ? t + (frameClock - firstClock) / 1e6
          : t + (duration * i) / frames.length;
    const camera = message(frame, 2);
    if (action) {
      const acc = message(camera, 10),
        point = sample(
          time,
          [2, 3, 4].map((id) => numeric(acc, id) ?? 0),
        );
      if (acc.size && point) out.acceleration.push(point);
      if (message(camera, 9).size)
        out.orientationSamples = (out.orientationSamples ?? 0) + 1;
      const gps = message(frame, 4, 2),
        coords = message(gps, 1);
      const lat = numeric(coords, 2),
        lon = numeric(coords, 3);
      if (lat !== undefined && lon !== undefined) {
        const factor = numeric(coords, 1) === 1 ? 1 : 180 / Math.PI;
        const date = stringField(message(gps, 6), 1);
        const utc =
          date && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?$/.test(date)
            ? Date.parse(date.replace(" ", "T") + "Z")
            : undefined;
        const p: GpsSample = {
          t: time,
          lat: lat * factor,
          lon: lon * factor,
          altitude: (numeric(gps, 2) ?? 0) / 1000,
          fix: (numeric(gps, 3) ?? 0) === 1 ? 0 : coords.size ? 3 : 0,
          ...(numeric(gps, 5) && Number.isFinite(utc) ? { utc } : {}),
        };
        if (validGps(p)) out.gps!.push(p);
      }
    } else {
      const attitudes = message(frame, 3, 2);
      out.orientationSamples =
        (out.orientationSamples ?? 0) + (attitudes.get(3)?.length ?? 0);
    }
    if (out.acceleration.length > 2_000_000 || out.gps!.length > 2_000_000)
      throw Error("Camera telemetry exceeds the sample limit.");
  }
}
export async function readDjiMotion(
  file: Blob,
  signal?: AbortSignal,
): Promise<CameraMotion> {
  const out: CameraMotion = {
    acceleration: [],
    gyro: [],
    gps: [],
    warnings: [],
  };
  await readMetadataTrack(
    file,
    ["djmd"],
    (bytes, t, duration) => parseDjiPacket(bytes, t, duration, out),
    signal,
  );
  if (out.orientationSamples)
    out.warnings!.push(
      "DJI orientation data is present. It is not raw gyroscope data and cannot supply a braking G-force graph.",
    );
  if (out.gps!.some((p) => p.utc !== undefined))
    out.warnings!.push(
      "DJI GPS clock timestamps may have one-second precision. Check the alignment against the video.",
    );
  if (!out.acceleration.length && !out.gps!.length && !out.orientationSamples)
    throw Error(
      "No supported DJI motion or GPS samples. Try the original camera file, or use manual sync.",
    );
  return out;
}

// Trailer layout and IMU units adapted from telemetry-parser (MIT), see THIRD_PARTY_NOTICES.md.
export const instaMagic = "8db42d694ccc418790edff439fe026bf";
// CAMM fields and units: https://developers.google.com/streetview/publish/camm-spec
export async function readCammMotion(
  file: Blob,
  signal?: AbortSignal,
): Promise<CameraMotion> {
  const out: CameraMotion = {
    acceleration: [],
    gyro: [],
    gps: [],
    model: "CAMM camera metadata",
    warnings: [],
  };
  await readMetadataTrack(
    file,
    ["camm"],
    (bytes, t) => {
      const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (bytes.length < 4 || d.getUint16(0, true) !== 0)
        throw Error("Invalid CAMM metadata packet.");
      const type = d.getUint16(2, true);
      const lengths: Record<number, number> = {
        0: 16,
        1: 12,
        2: 16,
        3: 16,
        4: 16,
        5: 28,
        6: 60,
        7: 16,
      };
      if (lengths[type] !== undefined && bytes.length !== lengths[type])
        throw Error("Truncated CAMM metadata packet.");
      if (type === 2 || type === 3) {
        const point = sample(
          t,
          [4, 8, 12].map(
            (p) => d.getFloat32(p, true) / (type === 3 ? 9.80665 : 1),
          ),
        );
        if (point) (type === 3 ? out.acceleration : out.gyro).push(point);
      } else if (type === 0)
        out.orientationSamples = (out.orientationSamples ?? 0) + 1;
      else if (type === 5 || type === 6) {
        const gps: GpsSample = {
          t,
          lat: d.getFloat64(type === 5 ? 4 : 16, true),
          lon: d.getFloat64(type === 5 ? 12 : 24, true),
          altitude:
            type === 5 ? d.getFloat64(20, true) : d.getFloat32(32, true),
          fix: type === 5 ? 2 : d.getInt32(12, true),
          ...(type === 6
            ? {
                speed: Math.hypot(
                  d.getFloat32(44, true),
                  d.getFloat32(48, true),
                ),
              }
            : {}),
        };
        if (validGps(gps)) out.gps!.push(gps);
      }
    },
    signal,
  );
  if (out.gps!.length)
    out.warnings!.push(
      "CAMM GPS positions support route matching. GPS epoch timestamps are not treated as UTC; use GPS route matching or manual sync for this format.",
    );
  if (
    !out.acceleration.length &&
    !out.gyro.length &&
    !out.gps!.length &&
    !out.orientationSamples
  )
    throw Error("No usable motion or GPS in the CAMM track.");
  return out;
}
export async function readInsta360Motion(
  file: Blob,
  signal?: AbortSignal,
): Promise<CameraMotion> {
  const camm = () =>
    readCammMotion(file, signal).catch((error: Error) => {
      if (error.message.startsWith("No camm telemetry track"))
        throw Error(
          "No Insta360 trailer or CAMM track. An app export may have removed telemetry; choose the original recording.",
        );
      throw error;
    });
  if (file.size < 72) return camm();
  const footer = new Uint8Array(await file.slice(-72).arrayBuffer());
  cancelled(signal);
  if (new TextDecoder().decode(footer.subarray(40)) !== instaMagic)
    return camm();
  const size = new DataView(footer.buffer).getUint32(32, true);
  if (size < 72 || size > file.size || size > 128 * 1024 * 1024)
    throw Error("Invalid or oversized Insta360 telemetry trailer.");
  const records = new Map<number, Uint8Array[]>();
  let end = file.size - 72,
    count = 0;
  while (end > file.size - size) {
    cancelled(signal);
    if (++count > 10000 || end - 6 < file.size - size)
      throw Error("Invalid Insta360 record table.");
    const h = new Uint8Array(await file.slice(end - 6, end).arrayBuffer()),
      id = h[1],
      length = new DataView(h.buffer).getUint32(2, true);
    const start = end - 6 - length;
    if (start < file.size - size)
      throw Error("Truncated Insta360 telemetry record.");
    if ([1, 3, 7, 128].includes(id)) {
      const list = records.get(id) ?? [];
      list.unshift(
        new Uint8Array(await file.slice(start, end - 6).arrayBuffer()),
      );
      records.set(id, list);
    }
    end = start;
  }
  const md = records.get(1)?.[0];
  if (!md) throw Error("Missing Insta360 timing metadata.");
  const metadata = protobuf(md),
    first = numeric(metadata, 24);
  if (first === undefined)
    throw Error(
      "Missing Insta360 first-frame timestamp; cannot safely place motion on the video timeline.",
    );
  if (records.has(128))
    throw Error(
      "This Insta360 file has a retimed or trimmed timeline. Use the original recording or manual sync.",
    );
  const raw = !!numeric(metadata, 62),
    cfg = message(metadata, 65);
  const offset = numeric(metadata, 29) ? (numeric(metadata, 28) ?? 0) : 0;
  const accRange = numeric(cfg, 1) || 16,
    gyroRange = numeric(cfg, 2) || 2000;
  const out: CameraMotion = {
    acceleration: [],
    gyro: [],
    gps: [],
    model: stringField(metadata, 2),
    warnings: [],
  };
  for (const bytes of records.get(3) ?? []) {
    const length = raw ? 20 : 56;
    if (bytes.length % length)
      throw Error("Unsupported Insta360 IMU record layout.");
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let p = 0; p < bytes.length; p += length) {
      const time =
        (Number(d.getBigUint64(p, true)) - first) / (raw ? 1e9 : 1e6) -
        offset / 1e6;
      const values = Array.from({ length: 6 }, (_, j) =>
        raw
          ? ((d.getUint16(p + 8 + j * 2, true) - 32768) / 32768) *
            (j < 3 ? accRange : (gyroRange * Math.PI) / 180)
          : d.getFloat64(p + 8 + j * 8, true),
      );
      const acc = sample(time, values.slice(0, 3)),
        gyro = sample(time, values.slice(3));
      if (acc) out.acceleration.push(acc);
      if (gyro) out.gyro.push(gyro);
      if (out.acceleration.length > 2_000_000)
        throw Error("Camera telemetry exceeds the sample limit.");
    }
  }
  const firstGps = numeric(metadata, 36);
  let firstUtc: number | undefined;
  for (const bytes of records.get(7) ?? []) {
    if (bytes.length % 53)
      throw Error("Unsupported Insta360 GPS record layout.");
    const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let p = 0; p < bytes.length; p += 53) {
      const utc =
        Number(d.getBigUint64(p, true)) * 1000 + d.getUint16(p + 8, true);
      firstUtc ??= utc;
      if (firstGps === undefined) continue;
      const gps: GpsSample = {
        t: (firstGps - first) / (raw ? 1e9 : 1e6) + (utc - firstUtc) / 1000,
        utc,
        lat:
          Math.abs(d.getFloat64(p + 11, true)) *
          (bytes[p + 19] === 83 ? -1 : 1),
        lon:
          Math.abs(d.getFloat64(p + 20, true)) *
          ([79, 87].includes(bytes[p + 28]) ? -1 : 1),
        speed: d.getFloat64(p + 29, true),
        altitude: d.getFloat64(p + 45, true),
        fix: bytes[p + 10] === 65 ? 3 : 0,
      };
      if (
        validGps(gps) &&
        [78, 83].includes(bytes[p + 19]) &&
        [69, 79, 87].includes(bytes[p + 28])
      )
        out.gps!.push(gps);
    }
  }
  if (records.has(7) && firstGps === undefined)
    out.warnings!.push(
      "GPS is present but its video timing reference is missing. GPS sync is unavailable for this file.",
    );
  if (!out.acceleration.length && !out.gyro.length && !out.gps!.length)
    throw Error(
      "No usable Insta360 motion or GPS samples. Try the original FreeFrame recording or manual sync.",
    );
  return out;
}
export async function readCameraTelemetry(
  file: Blob,
  camera: CameraFormat,
  signal?: AbortSignal,
): Promise<CameraMotion> {
  if (camera === "gopro") return readGoProMotion(file, signal);
  if (camera === "dji") return readDjiMotion(file, signal);
  if (camera === "insta360") return readInsta360Motion(file, signal);
  if (camera !== "auto") throw Error("Choose a camera telemetry format.");
  const tail = new Uint8Array(await file.slice(-32).arrayBuffer());
  cancelled(signal);
  if (new TextDecoder().decode(tail) === instaMagic)
    return readInsta360Motion(file, signal);
  let codec = "";
  await readMetadataTrack(
    file,
    ["gpmd", "djmd", "camm"],
    (_b, _t, _d, type) => {
      codec = type;
    },
    signal,
  );
  if (codec === "camm") return readCammMotion(file, signal);
  return codec === "djmd"
    ? readDjiMotion(file, signal)
    : readGoProMotion(file, signal);
}
