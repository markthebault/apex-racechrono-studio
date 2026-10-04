import { stampAtVideo } from "./storage";
import type { Session, SyncFile } from "./model";
// Video bytes never enter the project archive. Full hashes identify the local originals.
export async function matchProjectVideos(
  files: File[],
  sync: SyncFile,
  hash: (file: File) => Promise<string>,
) {
  const expected = new Set(
    sync.bindings.flatMap((b) => b.clips.map((c) => c.sha256)),
  );
  const matched: Record<string, File> = {},
    unmatched: string[] = [];
  for (const file of files) {
    const digest = await hash(file);
    if (expected.has(digest)) matched[digest] = file;
    else unmatched.push(file.name);
  }
  return { matched, unmatched };
}

// Open a lap that actually overlaps a linked original, rather than the previous
// workspace's selection or a moment before the recording starts.
export function restoredVideoPosition(
  sessions: Session[],
  sync: SyncFile,
  hashes: string[],
  preferredLap: string,
) {
  const candidates = sync.bindings.flatMap((binding) => {
    const session = sessions.find((s) => s.id === binding.session.sha256);
    if (!session || !binding.anchors.length) return [];
    return binding.clips
      .filter((c) => hashes.includes(c.sha256))
      .flatMap((clip) => {
        const start = stampAtVideo(binding, clip.start);
        const end = stampAtVideo(binding, clip.start + clip.duration);
        return session.laps
          .filter((l) => l.start < end && l.end > start)
          .map((l) => ({
            lapId: l.id,
            sessionId: session.id,
            timestamp: Math.max(l.start, start),
          }));
      });
  });
  return candidates.find((c) => c.lapId === preferredLap) ?? candidates[0];
}
