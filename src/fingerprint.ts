import { createSHA256 } from "hash-wasm";
const EDGE = 1024 * 1024;
// A cheap stand-in for hashing a whole file: its size, when it was last modified, and a
// hash of its first and last megabyte. It reads 2 MB however big the file is, so the
// full SHA-256 of a video only has to be computed once. Two different files that agree on
// all three parts are not a realistic worry.
export async function fingerprintOf(
  file: Blob & { lastModified?: number },
): Promise<string> {
  const hash = await createSHA256();
  hash.init();
  hash.update(new Uint8Array(await file.slice(0, EDGE).arrayBuffer()));
  hash.update(
    new Uint8Array(
      await file.slice(Math.max(0, file.size - EDGE)).arrayBuffer(),
    ),
  );
  return `${file.size}:${file.lastModified ?? 0}:${hash.digest("hex")}`;
}
