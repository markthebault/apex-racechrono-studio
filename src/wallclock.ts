const pad = (n: number, w = 2) => String(n).padStart(w, "0");
// Local time of day with milliseconds, for example 14:10:04.500.
export function formatWallClock(ms: number) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
// Local date, for example 27 Sep 2026.
export const formatWallDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
// Typed local time. "14:10", "14:10:04", "14:10:04.5" use the date of `reference`;
// "2026-09-27 14:10:04.500" carries its own date. Returns NaN when it makes no sense.
export function parseWallClock(text: string, reference: number) {
  const m = text
    .trim()
    .match(
      /^(?:(\d{4})-(\d{2})-(\d{2})[ T])?(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?$/,
    );
  if (!m) return NaN;
  const base = new Date(reference);
  const [h, min, s, frac] = [
    +m[4],
    +m[5],
    m[6] ? +m[6] : 0,
    m[7] ? +m[7].padEnd(3, "0") : 0,
  ];
  if (h > 23 || min > 59 || s > 59) return NaN;
  const [y, mo, d] = m[1]
    ? [+m[1], +m[2] - 1, +m[3]]
    : [base.getFullYear(), base.getMonth(), base.getDate()];
  const out = new Date(y, mo, d, h, min, s, frac);
  return out.getMonth() === mo ? out.getTime() : NaN;
}
