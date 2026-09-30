import type { FinishLine, Session } from "./model";
import { trackIdFromName } from "./vbo";
import { distanceToPath, lineAtStart, lineFromSession } from "./laps";
import { lower } from "./analysis";
import { applyLine } from "./vboImport";

export type KnownTrack = { trackId: number; name: string; sessions: number };
// The tracks that sessions already belong to, for choosing from.
export function knownTracks(sessions: Session[]): KnownTrack[] {
  const byId = new Map<number, KnownTrack>();
  for (const s of sessions) {
    const t = byId.get(s.trackId) ?? {
      trackId: s.trackId,
      name: s.track,
      sessions: 0,
    };
    t.sessions++;
    byId.set(s.trackId, t);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type TrackChoice = { trackId: number } | { name: string };
// Puts a session on another track, or on a new one, and marks the choice as deliberate so
// automatic matching leaves it alone. RaceChrono laps come from the file, so they stay. A VBO
// has no laps of its own, so they are cut again from a finish line of the new track when one
// lies on its path, and cleared otherwise until a line is placed.
export function assignTrack(
  s: Session,
  others: Session[],
  choice: TrackChoice,
): Session {
  let track: string, trackId: number;
  if ("trackId" in choice) {
    const t = others.find((o) => o.trackId === choice.trackId);
    if (!t) throw Error("That track no longer exists.");
    ({ track, trackId } = t);
  } else {
    const name = choice.name.trim();
    if (!name) throw Error("Type a name for the track.");
    const same = others.find(
      (o) => o.track.toLowerCase() === name.toLowerCase(),
    );
    if (same) ({ track, trackId } = same);
    else {
      track = name;
      trackId = trackIdFromName(name);
    }
  }
  const moved: Session = { ...s, track, trackId, trackEdited: true };
  if (s.format !== "vbo") return moved;
  for (const o of others.filter((x) => x.trackId === trackId)) {
    const line = o.line ?? lineFromSession(o);
    if (line && distanceToPath(s.lat, s.lon, line) <= 40) {
      const cut = applyLine(moved, { ...line, source: "session" });
      if (cut.laps.length) return cut;
    }
  }
  return { ...moved, laps: [], line: undefined };
}

export type TrackSummary = {
  trackId: number;
  name: string;
  sessions: Session[];
  laps: number;
  best?: { ms: number; session: Session; lapNumber: number };
  lengthM: number;
  line: FinishLine | null;
  // Where the line came from, in words for the screen.
  lineFrom: "you" | "session" | "laps" | "lap start" | "none";
  // The fastest lap as map points, or the whole path when no lap exists yet.
  outline: [number, number][];
  // The fastest lap of each of the other sessions, drawn faintly.
  others: { sessionId: string; points: [number, number][] }[];
};

const slow = (issues: string[]) =>
  issues.some((i) => i.startsWith("Interrupted") || i.includes("invalid"));
// Map points of a stretch of a session, thinned to about 600 points, and its length.
function stretch(s: Session, from: number, to: number) {
  const a = lower(s.times, from),
    b = Math.min(s.times.length, lower(s.times, to) + 1);
  const step = Math.max(1, Math.ceil((b - a) / 600));
  const points: [number, number][] = [];
  let length = 0;
  const k = (Math.PI / 180) * 6371000;
  for (let i = a; i < b; i++) {
    if (i > a) {
      const dy = (s.lat[i] - s.lat[i - 1]) * k,
        dx =
          (s.lon[i] - s.lon[i - 1]) * k * Math.cos((s.lat[i] * Math.PI) / 180);
      length += Math.hypot(dx, dy);
    }
    if ((i - a) % step === 0) points.push([s.lat[i], s.lon[i]]);
  }
  return { points, length };
}

// One entry per track in use, with what the Tracks screen shows: the trace, the start/finish
// line, and the numbers. Busiest tracks first.
export function summarizeTracks(sessions: Session[]): TrackSummary[] {
  const groups = new Map<number, Session[]>();
  for (const s of sessions)
    groups.set(s.trackId, [...(groups.get(s.trackId) ?? []), s]);
  const out: TrackSummary[] = [];
  for (const [trackId, list] of groups) {
    let best: TrackSummary["best"];
    const fastest = new Map<string, { from: number; to: number }>();
    for (const s of list) {
      for (const l of s.laps) {
        if (slow(l.issues)) continue;
        const ms = l.end - l.start;
        if (!best || ms < best.ms)
          best = { ms, session: s, lapNumber: l.number };
        const seen = fastest.get(s.id);
        if (!seen || ms < seen.to - seen.from)
          fastest.set(s.id, { from: l.start, to: l.end });
      }
    }
    // The trace: the fastest lap, or the whole first session while it has no laps.
    const ref = best?.session ?? list[0];
    const span = best
      ? fastest.get(best.session.id)!
      : { from: ref.times[0], to: ref.times[ref.times.length - 1] };
    const outline = stretch(ref, span.from, span.to);
    // The line: one a session stores or its laps imply, else the start of the fastest lap.
    const byLaps = [...list].sort((x, y) => y.laps.length - x.laps.length);
    let line: FinishLine | null = null;
    let lineFrom: TrackSummary["lineFrom"] = "none";
    for (const s of byLaps) {
      if (s.line) {
        line = s.line;
        lineFrom = s.line.source === "user" ? "you" : "session";
        break;
      }
    }
    if (!line)
      for (const s of byLaps) {
        const found = lineFromSession(s);
        if (found) {
          line = found;
          lineFrom = "laps";
          break;
        }
      }
    if (!line && best) {
      const lap = best.session.laps.find((l) => l.number === best!.lapNumber)!;
      line = lineAtStart(best.session, lap);
      lineFrom = "lap start";
    }
    const others = list
      .filter((s) => s.id !== ref.id && fastest.has(s.id))
      .slice(0, 8)
      .map((s) => {
        const f = fastest.get(s.id)!;
        return { sessionId: s.id, points: stretch(s, f.from, f.to).points };
      });
    out.push({
      trackId,
      name: list[0].track,
      sessions: list,
      laps: list.reduce((n, s) => n + s.laps.length, 0),
      best,
      lengthM: outline.length,
      line,
      lineFrom,
      outline: outline.points,
      others,
    });
  }
  return out.sort(
    (a, b) =>
      b.sessions.length - a.sessions.length || a.name.localeCompare(b.name),
  );
}
