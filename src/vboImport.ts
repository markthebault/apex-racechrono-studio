import type { FinishLine, Session } from "./model";
import { distanceToPath, lapsFromLine, lineFromSession } from "./laps";

// Cuts a session into laps at a finish line and remembers the line.
export function applyLine(s: Session, line: FinishLine): Session {
  return {
    ...s,
    line,
    laps: lapsFromLine(s.id, s.times, s.lat, s.lon, line),
  };
}

// Gives a freshly decoded VBO session its laps and its track, from what is already known:
// - the same file imported before keeps the line it had, including one placed by hand;
// - a finish line of another session that lies on this path identifies the track and
//   gives the laps, so the session joins that track;
// - otherwise a session of a track with the same name only lends its identity, and the
//   laps stay empty until a line is placed.
export function resolveVbo(s: Session, known: Session[]): Session {
  const before = known.find((k) => k.id === s.id && k.line);
  if (before?.line)
    return applyLine(
      { ...s, track: before.track, trackId: before.trackId },
      before.line,
    );
  let best: { from: Session; line: FinishLine } | undefined;
  for (const k of known) {
    if (k.id === s.id) continue;
    const line = k.line ?? lineFromSession(k);
    if (!line || distanceToPath(s.lat, s.lon, line) > 40) continue;
    if (!best || k.laps.length > best.from.laps.length)
      best = { from: k, line };
  }
  if (best) {
    const adopted = {
      ...s,
      track: best.from.track,
      trackId: best.from.trackId,
    };
    const withLaps = applyLine(adopted, { ...best.line, source: "session" });
    // A line that the path never crosses in the right direction is no use.
    return withLaps.laps.length ? withLaps : adopted;
  }
  const named = known.find(
    (k) => k.id !== s.id && k.track.toLowerCase() === s.track.toLowerCase(),
  );
  return named ? { ...s, track: named.track, trackId: named.trackId } : s;
}

// A VBO session may have joined a track before, or without, a RaceChrono session of the same
// circuit. Once one exists, give the VBO sessions its identity and, if they have no line of
// their own, its finish line. A line placed by hand is kept. Returns the same array when
// nothing changed, and reuses the untouched sessions.
export function reconcileVbo(sessions: Session[]): Session[] {
  let changed = false;
  const out = sessions.map((s) => {
    if (s.format !== "vbo") return s;
    const others = sessions.filter((o) => o.id !== s.id);
    let next = s;
    const named = others.find(
      (o) =>
        o.format !== "vbo" && o.track.toLowerCase() === s.track.toLowerCase(),
    );
    if (named && s.trackId !== named.trackId)
      next = { ...next, track: named.track, trackId: named.trackId };
    if (!next.line) next = resolveVbo(next, others);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? out : sessions;
}
