import type { Session } from "./model";
import { trackIdFromName } from "./vbo";
import { distanceToPath, lineFromSession } from "./laps";
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
