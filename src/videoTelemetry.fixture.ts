// Synthetic sensor data only. Used by tests and local browser validation.
export function join(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}
export const text = (s: string) => new TextEncoder().encode(s);
export function u32(...values: number[]) {
  const b = new Uint8Array(values.length * 4),
    d = new DataView(b.buffer);
  values.forEach((v, i) => d.setUint32(i * 4, v));
  return b;
}
export function box(type: string, ...parts: Uint8Array[]) {
  const payload = join(...parts);
  return join(u32(payload.length + 8), text(type), payload);
}
function klv(
  key: string,
  type: string,
  size: number,
  count: number,
  data: Uint8Array,
) {
  const h = join(
    text(key),
    new Uint8Array([type.charCodeAt(0), size, count >> 8, count & 255]),
  );
  return join(h, data, new Uint8Array((4 - (data.length % 4)) % 4));
}
export function fakePayload(second: number, gyroOnly = false) {
  const sensor = (key: string) => {
    const b = new Uint8Array(120),
      d = new DataView(b.buffer);
    for (let i = 0; i < 20; i++) {
      const t = second + i / 20,
        g = t >= 4 && t < 6 ? -0.7 : t >= 9 && t < 10 ? -0.4 : 0;
      [
        key === "ACCL" ? 9.80665 : 0,
        0,
        key === "ACCL" ? g * 9.80665 : Math.sin(t) * 0.2,
      ].forEach((v, j) => d.setInt16(i * 6 + j * 2, Math.round(v * 1000)));
    }
    const unit = text(key === "ACCL" ? "m/s²" : "rad/s");
    const inner = join(
      klv("SCAL", "l", 4, 1, u32(1000)),
      klv("SIUN", "c", unit.length, 1, unit),
      klv(key, "s", 6, 20, b),
    );
    return klv("STRM", "\0", 1, inner.length, inner);
  };
  const inner = join(...(gyroOnly ? [] : [sensor("ACCL")]), sensor("GYRO"));
  return klv("DEVC", "\0", 1, inner.length, inner);
}
export function fakeTelemetryTrack(
  offset: number,
  seconds = 12,
  gyroOnly = false,
) {
  const packets = Array.from({ length: seconds }, (_, i) =>
    fakePayload(i, gyroOnly),
  );
  const track = box(
    "trak",
    box("tkhd", u32(7, 0, 0, 2, 0, seconds * 1000), new Uint8Array(60)),
    box(
      "mdia",
      box("mdhd", u32(0, 0, 0, 1000, seconds * 1000), new Uint8Array(4)),
      box(
        "hdlr",
        u32(0, 0),
        text("meta"),
        new Uint8Array(12),
        text("GoPro MET\0"),
      ),
      box(
        "minf",
        box("gmhd", box("gmin", new Uint8Array(16))),
        box("dinf", box("dref", u32(0, 1), box("url ", u32(1)))),
        box(
          "stbl",
          box(
            "stsd",
            u32(0, 1),
            box("gpmd", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1])),
          ),
          box("stts", u32(0, 1, seconds, 1000)),
          box("stsc", u32(0, 1, 1, seconds, 1)),
          box("stsz", u32(0, 0, seconds, ...packets.map((b) => b.length))),
          box("stco", u32(0, 1, offset)),
        ),
      ),
    ),
  );
  return { track, payload: join(...packets) };
}
export function fakeMotionMp4(gyroOnly = false) {
  const ftyp = box("ftyp", text("isom"), u32(0), text("isom"));
  const { track, payload } = fakeTelemetryTrack(ftyp.length + 8, 12, gyroOnly);
  return join(ftyp, box("mdat", payload), box("moov", track));
}
