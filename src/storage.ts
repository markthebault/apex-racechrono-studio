import { openDB } from "idb";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { Session, Settings, SyncFile, Binding } from "./model";
import { applyLine } from "./vboImport";
const db = openDB("apex-studio", 1, {
  upgrade(d) {
    d.createObjectStore("sessions", { keyPath: "session.id" });
    d.createObjectStore("state");
    d.createObjectStore("handles");
  },
});
export async function load() {
  const d = await db;
  return {
    records: (await d.getAll("sessions")) as { session: Session; file: Blob }[],
    settings: (await d.get("state", "settings")) as Settings | undefined,
    sync: (await d.get("state", "sync")) as SyncFile | undefined,
  };
}
export async function saveSession(session: Session, file: Blob) {
  await (await db).put("sessions", { session, file });
}
// Replaces the decoded session, for example after its laps were recut, keeping the file.
export async function updateSession(session: Session) {
  const d = await db;
  const record = await d.get("sessions", session.id);
  if (!record) throw Error("Session not found.");
  await d.put("sessions", { session, file: record.file });
}
// Remove the stored recording and its references together, retaining shared videos.
export async function removeSession(
  session: Session,
  settings: Settings,
  sync: SyncFile,
) {
  const lapIds = new Set(session.laps.map((lap) => lap.id));
  const ownsLap = (id: string) =>
    lapIds.has(id) || id.startsWith(session.id + ":");
  const nextSettings: Settings = {
    ...settings,
    a: ownsLap(settings.a) ? "" : settings.a,
    b: ownsLap(settings.b) ? "" : settings.b,
    collection: settings.collection.filter((id) => id !== session.id),
    excluded: settings.excluded.filter((id) => !ownsLap(id)),
    included: settings.included.filter((id) => !ownsLap(id)),
    layouts: settings.layouts.filter((layout) => !ownsLap(layout.referenceId)),
    ...(settings.extras && {
      extras: settings.extras.filter((lap) => !ownsLap(lap.id)),
    }),
  };
  const nextSync: SyncFile = {
    ...sync,
    bindings: sync.bindings.filter((b) => b.session.sha256 !== session.id),
  };
  const keptVideos = new Set(
    nextSync.bindings.flatMap((b) => b.clips.map((clip) => clip.sha256)),
  );
  const removedVideos = [
    ...new Set(
      sync.bindings
        .filter((b) => b.session.sha256 === session.id)
        .flatMap((b) => b.clips.map((clip) => clip.sha256))
        .filter((hash) => !keptVideos.has(hash)),
    ),
  ];
  const d = await db;
  const tx = d.transaction(["sessions", "state", "handles"], "readwrite");
  try {
    await tx.objectStore("sessions").delete(session.id);
    await tx.objectStore("state").put(nextSettings, "settings");
    await tx.objectStore("state").put(nextSync, "sync");
    for (const hash of removedVideos)
      await tx.objectStore("handles").delete(hash);
    await tx.done;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw e;
  }
  return { settings: nextSettings, sync: nextSync, removedVideos };
}
export async function commitProject(
  records: { session: Session; file: Blob }[],
  settings: Settings,
  sync: SyncFile,
) {
  const d = await db;
  const tx = d.transaction(["sessions", "state"], "readwrite");
  try {
    for (const r of records) await tx.objectStore("sessions").put(r);
    await tx.objectStore("state").put(settings, "settings");
    await tx.objectStore("state").put(sync, "sync");
    await tx.done;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw e;
  }
}
export async function saveState(key: string, value: unknown) {
  await (await db).put("state", value, key);
}
// Full hashes of large files already computed, keyed by a cheap fingerprint of the file.
export async function cachedHash(fingerprint: string) {
  return (await (await db).get("state", "vh:" + fingerprint)) as
    string | undefined;
}
export async function rememberHash(fingerprint: string, sha256: string) {
  await (await db).put("state", sha256, "vh:" + fingerprint);
}
export async function saveHandle(hash: string, handle: unknown) {
  await (await db).put("handles", handle, hash);
}
export async function getHandle(hash: string) {
  return (await db).get("handles", hash);
}
export function work<T>(
  kind: string,
  data: object,
  onProgress?: (n: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const abort = () => {
      w.terminate();
      reject(Error("Operation cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    w.onerror = (e) => {
      w.terminate();
      reject(Error(e.message));
    };
    w.onmessage = ({ data: d }) => {
      if (d.progress !== undefined) {
        onProgress?.(d.progress);
        return;
      }
      w.terminate();
      signal?.removeEventListener("abort", abort);
      if (d.error) reject(Error(d.error));
      else resolve(d.result);
    };
    w.postMessage({ kind, ...data });
  });
}
export function download(
  name: string,
  data: BlobPart,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function validateSync(v: any): SyncFile {
  if (
    v?.format !== "apex-sync" ||
    v.version !== 1 ||
    !Array.isArray(v.bindings)
  )
    throw Error("Unsupported synchronization file.");
  const identity = (x: any) =>
    x &&
    /^[a-f0-9]{64}$/.test(x.sha256) &&
    typeof x.name === "string" &&
    Number.isSafeInteger(x.size) &&
    x.size >= 0;
  for (const b of v.bindings) {
    if (
      !identity(b.session) ||
      !Array.isArray(b.clips) ||
      !Array.isArray(b.anchors) ||
      b.anchors.length > 2
    )
      throw Error("Invalid synchronization binding.");
    let end = 0;
    for (const c of b.clips) {
      if (
        !identity(c) ||
        !Number.isFinite(c.duration) ||
        c.duration <= 0 ||
        !Number.isFinite(c.start) ||
        c.start < end
      )
        throw Error("Invalid or overlapping video clips.");
      end = c.start + c.duration;
    }
    for (const a of b.anchors)
      if (
        !Number.isFinite(a.videoSeconds) ||
        !Number.isFinite(a.sessionTimestamp)
      )
        throw Error("Invalid synchronization anchor.");
    if (
      b.anchors.length === 2 &&
      (b.anchors[1].videoSeconds <= b.anchors[0].videoSeconds ||
        b.anchors[1].sessionTimestamp <= b.anchors[0].sessionTimestamp)
    )
      throw Error("Drift anchors must advance in both video and session time.");
  }
  const identityOnly = (x: any) => ({
    sha256: x.sha256,
    name: x.name,
    size: x.size,
  });
  return {
    format: "apex-sync",
    version: 1,
    bindings: v.bindings.map((b: any) => ({
      session: identityOnly(b.session),
      clips: b.clips.map((c: any) => ({
        ...identityOnly(c),
        duration: c.duration,
        start: c.start,
      })),
      anchors: b.anchors.map((a: any) => ({
        videoSeconds: a.videoSeconds,
        sessionTimestamp: a.sessionTimestamp,
      })),
    })),
  };
}
export function videoTime(binding: Binding, stamp: number) {
  const [a, b] = binding.anchors;
  if (!a) return NaN;
  const rate = b
    ? (b.videoSeconds - a.videoSeconds) /
      (b.sessionTimestamp - a.sessionTimestamp)
    : 0.001;
  return a.videoSeconds + (stamp - a.sessionTimestamp) * rate;
}
// The telemetry timestamp that a moment of the video (seconds on the clip timeline) falls at.
export function stampAtVideo(binding: Binding, seconds: number) {
  const [a, b] = binding.anchors;
  if (!a) return NaN;
  const rate = b
    ? (b.videoSeconds - a.videoSeconds) /
      (b.sessionTimestamp - a.sessionTimestamp)
    : 0.001;
  return a.sessionTimestamp + (seconds - a.videoSeconds) / rate;
}
export async function exportProject(settings: Settings, sync: SyncFile) {
  const records = (await load()).records;
  const files: Record<string, Uint8Array> = {
    "project.json": strToU8(
      JSON.stringify({
        format: "apex-project",
        version: 1,
        settings,
        sync,
        sessions: records.map((r) => ({
          id: r.session.id,
          filename: r.session.filename,
          ...(r.session.format === "vbo" || r.session.trackEdited
            ? {
                track: r.session.track,
                trackId: r.session.trackId,
                line: r.session.line,
                trackEdited: r.session.trackEdited,
              }
            : {}),
        })),
      }),
    ),
  };
  for (const r of records)
    files[
      `sessions/${r.session.id}.${r.session.format === "vbo" ? "vbo" : "rcz"}`
    ] = new Uint8Array(await r.file.arrayBuffer());
  download("track-day.apex.zip", zipSync(files) as BlobPart, "application/zip");
}
export async function readProject(file: File) {
  const z = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (f) => {
      if (f.originalSize > 256 * 1024 * 1024)
        throw Error("Project entry too large.");
      return true;
    },
  });
  if (!z["project.json"]) throw Error("Missing project manifest.");
  const manifest = JSON.parse(strFromU8(z["project.json"]));
  if (
    manifest.format !== "apex-project" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.sessions) ||
    !manifest.settings ||
    !Array.isArray(manifest.settings.charts) ||
    !Array.isArray(manifest.settings.layouts)
  )
    throw Error("Unsupported project.");
  validateSettings(manifest.settings);
  manifest.sync = validateSync(manifest.sync);
  const records = [];
  for (const entry of manifest.sessions) {
    const bytes =
      z[`sessions/${entry.id}.rcz`] ?? z[`sessions/${entry.id}.vbo`];
    if (!bytes) throw Error("Project session is missing.");
    const f = new File([bytes as BlobPart], entry.filename);
    let session = await work<Session>("decode", { file: f });
    if (session.id !== entry.id) throw Error("Project session hash mismatch.");
    // A VBO carries no laps, and a track can be chosen by hand, so both travel in the manifest.
    if (entry.track !== undefined && Number.isFinite(entry.trackId))
      session = {
        ...session,
        track: String(entry.track),
        trackId: entry.trackId,
        ...(entry.trackEdited ? { trackEdited: true } : {}),
      };
    if (session.format === "vbo" && entry.line)
      session = applyLine(session, entry.line);
    records.push({ session, file: f });
  }
  return { manifest, records };
}

export function validateSettings(s: any) {
  const list = (x: any) =>
    Array.isArray(x) && x.every((v) => typeof v === "string");
  if (
    !s ||
    typeof s.a !== "string" ||
    typeof s.b !== "string" ||
    !["distance", "time"].includes(s.mode) ||
    !list(s.excluded) ||
    !list(s.included) ||
    !list(s.collection)
  )
    throw Error("Invalid saved analysis settings.");
  if (
    !Array.isArray(s.charts) ||
    s.charts.some(
      (c: any) =>
        typeof c.id !== "string" ||
        !list(c.channels) ||
        !c.channels.length ||
        !Number.isFinite(c.height) ||
        c.height < 90 ||
        c.height > 320,
    )
  )
    throw Error("Invalid saved charts.");
  if (s.showEmptyCharts !== undefined && typeof s.showEmptyCharts !== "boolean")
    throw Error("Invalid empty-chart preference.");
  if (
    !Array.isArray(s.layouts) ||
    s.layouts.some(
      (l: any) =>
        typeof l.id !== "string" ||
        typeof l.referenceId !== "string" ||
        !Array.isArray(l.gates) ||
        l.gates.length < 2 ||
        l.gates.some(
          (n: number, i: number) =>
            !Number.isFinite(n) || n < 0 || (i > 0 && n <= l.gates[i - 1]),
        ),
    )
  )
    throw Error("Invalid saved timing gates.");
  if (!Number.isFinite(s.mapHeight) || s.mapHeight < 240 || s.mapHeight > 650)
    throw Error("Invalid map panel size.");
  if (
    s.colors &&
    (!Array.isArray(s.colors) ||
      s.colors.length !== 2 ||
      s.colors.some(
        (c: any) => typeof c !== "string" || !/^#[0-9a-f]{6}$/i.test(c),
      ))
  )
    throw Error("Invalid lap colors.");
  if (
    s.extras !== undefined &&
    (!Array.isArray(s.extras) ||
      s.extras.length > 4 ||
      s.extras.some(
        (e: any) =>
          typeof e?.id !== "string" ||
          typeof e?.color !== "string" ||
          !/^#[0-9a-f]{6}$/i.test(e.color),
      ))
  )
    throw Error("Invalid extra comparison laps.");
  if (s.group && !["track", "date"].includes(s.group))
    throw Error("Invalid session grouping.");
  if (s.speedUnit && !["km/h", "mph"].includes(s.speedUnit))
    throw Error("Invalid speed unit.");
}
