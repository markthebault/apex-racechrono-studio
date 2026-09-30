import type { Session } from "./model";
import { lower } from "./analysis";
export type LapRow = {
  id: string;
  number: number;
  ms: number;
  // Time behind the best lap of the session, in ms.
  delta: number;
  best: boolean;
  interrupted: boolean;
  gap: boolean;
  // Bar length between 0 and 1, longer the further behind the best lap.
  bar: number;
};
export type Summary = { bestMs: number; rows: LapRow[]; topSpeed: number };
const isInterrupted = (issues: string[]) =>
  issues.some((i) => i.startsWith("Interrupted") || i.includes("invalid"));
// Lap-by-lap view of one session. Interrupted or invalid laps never set the best time.
export function summarize(s: Session): Summary {
  const ms = (l: { start: number; end: number }) => l.end - l.start;
  const counted = s.laps.filter((l) => !isInterrupted(l.issues));
  // A session without laps yet has no best lap.
  const bestMs = s.laps.length
    ? Math.min(...(counted.length ? counted : s.laps).map(ms))
    : NaN;
  const behind = counted.map((l) => ms(l) - bestMs);
  const widest = Math.max(0, ...behind);
  const rows = s.laps.map((l) => {
    const interrupted = isInterrupted(l.issues),
      delta = ms(l) - bestMs;
    return {
      id: l.id,
      number: l.number,
      ms: ms(l),
      delta,
      best: !interrupted && delta === 0,
      interrupted,
      gap: l.issues.some((i) => i.startsWith("GPS gap")),
      bar: interrupted ? 1 : widest ? delta / widest : 0,
    };
  });
  return { bestMs, rows, topSpeed: topSpeed(s) };
}
// Highest GPS speed in km/h while a timed lap was running.
export function topSpeed(s: Session) {
  const c = s.channels.find((x) => x.id === "speed");
  if (!c) return NaN;
  let top = NaN;
  for (const l of s.laps)
    for (
      let i = lower(c.times, l.start);
      i < c.times.length && c.times[i] <= l.end;
      i++
    )
      if (!(c.values[i] <= top)) top = c.values[i];
  return top;
}
export function formatGap(ms: number) {
  const sign = ms < 0 ? "-" : "+",
    v = Math.abs(ms) / 1000;
  return v < 60
    ? `${sign}${v.toFixed(2)}`
    : `${sign}${Math.floor(v / 60)}:${(v % 60).toFixed(2).padStart(5, "0")}`;
}
