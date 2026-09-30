export type FileKind = "session" | "project" | "sync" | "video" | "unsupported";
// What a dropped or chosen file is, judged by its name.
export function classifyFile(name: string): FileKind {
  const n = name.toLowerCase();
  if (n.endsWith(".rcz") || n.endsWith(".vbo")) return "session";
  if (n.endsWith(".zip")) return "project";
  if (n.endsWith(".json")) return "sync";
  if (/\.(mp4|m4v|mov|webm|mkv|avi)$/.test(n)) return "video";
  return "unsupported";
}
export type ImportedSession = {
  track: string;
  laps: number;
  newTrack: boolean;
};
// One status line for a batch: which tracks the sessions belong to, and what was skipped.
export function describeImport(
  imported: ImportedSession[],
  alreadyThere: number,
  videos: number,
) {
  const parts: string[] = [];
  if (imported.length) {
    const byTrack = new Map<
      string,
      { n: number; laps: number; fresh: boolean }
    >();
    for (const s of imported) {
      const t = byTrack.get(s.track) || { n: 0, laps: 0, fresh: false };
      t.n++;
      t.laps += s.laps;
      t.fresh ||= s.newTrack;
      byTrack.set(s.track, t);
    }
    const tracks = [...byTrack].map(
      ([track, t]) =>
        `${track}${t.fresh ? " (new track)" : ""}: ${t.n} ${t.n === 1 ? "session" : "sessions"}, ${t.laps} laps`,
    );
    parts.push(
      `Imported ${imported.length} ${imported.length === 1 ? "session" : "sessions"}. ${tracks.join(" · ")}`,
    );
  }
  if (alreadyThere)
    parts.push(`${alreadyThere} already in your collection, refreshed`);
  if (videos)
    parts.push(
      `${videos} video ${videos === 1 ? "file" : "files"} skipped. Link videos from Video sync`,
    );
  return parts.join(". ");
}
