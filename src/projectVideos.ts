import type { SyncFile } from "./model";
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
