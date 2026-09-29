import type { Session } from "./model";
export type GroupBy = "track" | "date";
export type Group = { key: string; label: string; sessions: Session[] };
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// Sessions grouped by track (A to Z) or by local calendar day (newest first).
// Sessions inside a group run oldest first.
export function groupSessions(sessions: Session[], by: GroupBy): Group[] {
  const groups = new Map<string, Group>();
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    const key =
      by === "track" ? `track:${s.trackId ?? s.track}` : dayKey(s.start);
    const label =
      by === "track"
        ? s.track
        : new Date(s.start).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "long",
            year: "numeric",
          });
    if (!groups.has(key)) groups.set(key, { key, label, sessions: [] });
    groups.get(key)!.sessions.push(s);
  }
  const list = [...groups.values()];
  return by === "track"
    ? list.sort((a, b) => a.label.localeCompare(b.label))
    : list.sort((a, b) => b.sessions[0].start - a.sessions[0].start);
}
// An empty collection means every session is in the analyzer.
export const isSelected = (collection: string[], id: string) =>
  !collection.length || collection.includes(id);
// Returns the next collection. It refuses to leave the analyzer empty, and returns
// an empty list when everything is selected so later imports join automatically.
export function toggleSessions(
  all: string[],
  collection: string[],
  ids: string[],
  on: boolean,
): string[] {
  const current = all.filter((id) => isSelected(collection, id));
  const next = on
    ? all.filter((id) => current.includes(id) || ids.includes(id))
    : current.filter((id) => !ids.includes(id));
  const result = next.length ? next : current;
  return result.length === all.length ? [] : result;
}
// Analyze only these sessions.
export const onlySessions = (all: string[], ids: string[]) => {
  const next = all.filter((id) => ids.includes(id));
  return next.length === all.length || !next.length ? [] : next;
};
export function selectionState(
  collection: string[],
  ids: string[],
): "all" | "some" | "none" {
  const n = ids.filter((id) => isSelected(collection, id)).length;
  return n === 0 ? "none" : n === ids.length ? "all" : "some";
}

export type OpportunityScope = {
  mode: "selected" | "day";
  ids: string[];
  label: string;
  day?: string;
};
// Sessions that feed the opportunities: the ticked sessions when there is an explicit
// selection, otherwise every session of one day. The day is the one asked for, else
// the day of the anchor session, else the most recent day.
export function opportunityScope(
  sessions: Session[],
  collection: string[],
  day?: string,
  anchorId?: string,
): OpportunityScope {
  const chosen = sessions.filter((s) => collection.includes(s.id));
  if (chosen.length)
    return {
      mode: "selected",
      ids: chosen.map((s) => s.id),
      label: `${chosen.length} selected ${chosen.length === 1 ? "session" : "sessions"}`,
    };
  const days = groupSessions(sessions, "date");
  const anchor = days.find((g) => g.sessions.some((s) => s.id === anchorId));
  const pick = days.find((g) => g.key === day) || anchor || days[0];
  return pick
    ? {
        mode: "day",
        ids: pick.sessions.map((s) => s.id),
        label: `${pick.sessions.length} ${pick.sessions.length === 1 ? "session" : "sessions"} on ${pick.label}`,
        day: pick.key,
      }
    : { mode: "day", ids: [], label: "No sessions" };
}
