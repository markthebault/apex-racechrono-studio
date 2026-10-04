// Synthetic camera records; no private recordings are included in the repository.
import { join, text, u32, box } from "./videoTelemetry.fixture.ts";
export function pv(value: number) {
  const bytes: number[] = [];
  do {
    const b = value % 128;
    value = Math.floor(value / 128);
    bytes.push(b | (value ? 128 : 0));
  } while (value);
  return new Uint8Array(bytes);
}
export const pvar = (id: number, value: number) => join(pv(id * 8), pv(value));
export const pmsg = (id: number, value: Uint8Array) =>
  join(pv(id * 8 + 2), pv(value.length), value);
export const pstr = (id: number, value: string) => pmsg(id, text(value));
export function pfloat(id: number, value: number, double = false) {
  const b = new Uint8Array(double ? 8 : 4),
    d = new DataView(b.buffer);
  if (double) d.setFloat64(0, value, true);
  else d.setFloat32(0, value, true);
  return join(pv(id * 8 + (double ? 1 : 5)), b);
}
export function djiPayload(second: number, schema = "dvtm_ac206.proto") {
  const header = pmsg(
    1,
    pmsg(1, join(pstr(1, schema), pstr(10, "DJI OsmoAction6"))),
  );
  const acc = pmsg(
    2,
    pmsg(
      10,
      join(
        pfloat(2, 0),
        pfloat(3, second >= 4 && second < 6 ? -0.7 : 0),
        pfloat(4, 1),
      ),
    ),
  );
  const time = pmsg(1, pvar(2, (second + 100) * 1e6));
  const utc = new Date(Date.UTC(2026, 0, 1, 12, 0, second + 2))
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  const gps = pmsg(
    4,
    pmsg(
      2,
      join(
        pmsg(
          1,
          join(
            pvar(1, 1),
            pfloat(2, 50 + (second + 2) / 30000, true),
            pfloat(3, 6 + (second + 2) / 30000, true),
          ),
        ),
        pvar(5, 1),
        pmsg(6, pstr(1, utc)),
      ),
    ),
  );
  return join(header, pmsg(3, join(time, acc, gps)));
}
export function metadataTrack(
  codec: string,
  packets: Uint8Array[],
  offset: number,
  delta = 1000,
) {
  const sizes = new Uint8Array(packets.length * 4),
    view = new DataView(sizes.buffer);
  packets.forEach((p, i) => view.setUint32(i * 4, p.length));
  return box(
    "trak",
    box(
      "mdia",
      box(
        "mdhd",
        u32(0, 0, 0, 1000, packets.length * delta),
        new Uint8Array(4),
      ),
      box(
        "minf",
        box(
          "stbl",
          box("stsd", u32(0, 1), box(codec, new Uint8Array(8))),
          box("stts", u32(0, 1, packets.length, delta)),
          box("stsc", u32(0, 1, 1, packets.length, 1)),
          box("stsz", u32(0, 0, packets.length), sizes),
          box("stco", u32(0, 1, offset)),
        ),
      ),
    ),
  );
}
export function djiMp4(schema = "dvtm_ac206.proto") {
  const packets = Array.from({ length: 12 }, (_, s) => djiPayload(s, schema));
  return join(
    box("mdat", join(...packets)),
    box("moov", metadataTrack("djmd", packets, 8)),
  );
}
export function instaTrailer(raw = false, gpsTiming = true, retimed = false) {
  const first = 100_000_000,
    length = raw ? 20 : 56;
  const md = join(
    pstr(2, "Insta360 Synthetic"),
    pvar(24, first),
    pvar(62, +raw),
    ...(gpsTiming ? [pvar(36, first + (raw ? 500_000_000 : 500_000))] : []),
  );
  const imu = new Uint8Array(240 * length),
    d = new DataView(imu.buffer);
  for (let i = 0; i < 240; i++) {
    const t = i / 20,
      p = i * length,
      values = [0, t >= 4 && t < 6 ? -0.7 : 0, 1, 0, 0, 0.2];
    d.setBigUint64(p, BigInt(Math.round(first + t * (raw ? 1e9 : 1e6))), true);
    values.forEach((v, j) =>
      raw
        ? d.setUint16(
            p + 8 + j * 2,
            Math.round(
              32768 + (v / (j < 3 ? 16 : (2000 * Math.PI) / 180)) * 32768,
            ),
            true,
          )
        : d.setFloat64(p + 8 + j * 8, v, true),
    );
  }
  const gps = new Uint8Array(12 * 53),
    g = new DataView(gps.buffer);
  for (let i = 0; i < 12; i++) {
    const p = i * 53;
    g.setBigUint64(p, BigInt(Date.UTC(2026, 0, 1, 12, 0, 2 + i) / 1000), true);
    gps[p + 10] = 65;
    gps[p + 19] = 78;
    gps[p + 28] = 69;
    g.setFloat64(p + 11, 50 + (i + 2.5) / 30000, true);
    g.setFloat64(p + 20, 6 + (i + 2.5) / 30000, true);
    g.setFloat64(p + 29, 12, true);
  }
  const rec = (id: number, payload: Uint8Array) => {
    const h = new Uint8Array(6);
    h[0] = id === 1 ? 1 : 0;
    h[1] = id;
    new DataView(h.buffer).setUint32(2, payload.length, true);
    return join(payload, h);
  };
  const body = join(
    rec(3, imu),
    rec(7, gps),
    rec(1, md),
    ...(retimed ? [rec(128, new Uint8Array(4))] : []),
  );
  const footer = new Uint8Array(72);
  new DataView(footer.buffer).setUint32(32, body.length + 72, true);
  footer.set(text("8db42d694ccc418790edff439fe026bf"), 40);
  return join(body, footer);
}
