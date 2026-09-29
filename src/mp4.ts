// Recording time of an MP4 or MOV, read from its movie header without loading the file.
// Only the box headers and the small mvhd box are read, so a 1 GB file costs a few reads.
const EPOCH_1904_TO_1970_S = 2082844800;
async function bytes(file: Blob, start: number, length: number) {
  return new DataView(await file.slice(start, start + length).arrayBuffer());
}
// Unix milliseconds of the movie header's creation time, or null when there is none.
export async function readCreationTime(file: Blob): Promise<number | null> {
  try {
    const find = async (start: number, end: number, type: string) => {
      for (let p = start; p + 8 <= end;) {
        const h = await bytes(file, p, 16);
        let size = h.getUint32(0);
        let header = 8;
        if (size === 1 && h.byteLength >= 16) {
          size = Number(h.getBigUint64(8));
          header = 16;
        } else if (size === 0) size = end - p;
        if (size < header) return null;
        const name = String.fromCharCode(
          h.getUint8(4),
          h.getUint8(5),
          h.getUint8(6),
          h.getUint8(7),
        );
        if (name === type) return { at: p + header, end: p + size };
        p += size;
      }
      return null;
    };
    const moov = await find(0, file.size, "moov");
    const mvhd = moov && (await find(moov.at, moov.end, "mvhd"));
    if (!mvhd) return null;
    const d = await bytes(file, mvhd.at, 12);
    const seconds =
      d.getUint8(0) === 1
        ? Number((await bytes(file, mvhd.at, 12)).getBigUint64(4))
        : d.getUint32(4);
    if (!seconds) return null;
    return (seconds - EPOCH_1904_TO_1970_S) * 1000;
  } catch {
    return null;
  }
}
// Where the recording time puts the start of the video on the telemetry clock. Cameras
// disagree: some write UTC, others write local wall-clock digits as if they were UTC. The
// reading that lands inside the session (with some slack) wins. When both fit, UTC is
// used and the result is marked ambiguous so the person can check it against the picture.
export function matchVideoStart(
  created: number,
  session: { start: number; end: number },
  localOffsetMinutes: number,
  slackMs = 10 * 60000,
): {
  start: number;
  reading: "utc" | "local";
  ambiguous: boolean;
  other: number;
} | null {
  const utc = created,
    local = created + localOffsetMinutes * 60000;
  const fits = (t: number) =>
    t >= session.start - slackMs && t <= session.end + slackMs;
  if (fits(utc))
    return {
      start: utc,
      reading: "utc",
      ambiguous: fits(local) && local !== utc,
      other: local,
    };
  if (fits(local))
    return { start: local, reading: "local", ambiguous: false, other: utc };
  return null;
}
