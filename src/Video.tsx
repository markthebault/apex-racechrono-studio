import { useEffect, useRef, useState } from "react";
import type { Binding, Identity, Session } from "./model";
import {
  getHandle,
  saveHandle,
  videoTime,
  work,
  validateSync,
} from "./storage";
export function VideoPanel({
  session,
  stamp,
  binding,
  onBinding,
  files,
  setFiles,
  onBusy,
  label,
  playing,
  onPause,
  onUnlink,
}: {
  session?: Session;
  stamp: number;
  binding?: Binding;
  onBinding: (b: Binding) => void;
  files: Record<string, string>;
  setFiles: (v: Record<string, string>) => void;
  onBusy: (busy: boolean) => void;
  label: string;
  playing: boolean;
  onPause: () => void;
  onUnlink: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    input = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState(0);
  const [seek, setSeek] = useState(0);
  const vt = binding ? videoTime(binding, stamp) : NaN;
  const active =
    binding?.clips.findIndex(
      (c) => vt >= c.start && vt <= c.start + c.duration,
    ) ?? -1;
  const index = editing ? selected : active;
  const clip = binding?.clips[index];
  const url = clip ? files[clip.sha256] : undefined;
  useEffect(() => {
    if (editing || !video.current || !url || !clip || !Number.isFinite(vt)) {
      onBusy(false);
      return;
    }
    const v = video.current,
      target = Math.max(0, Math.min(clip.duration, vt - clip.start));
    if (Math.abs(v.currentTime - target) > (playing ? 0.35 : 0.04)) {
      onBusy(true);
      v.currentTime = target;
    }
    if (playing && !v.seeking)
      v.play().catch((e) => setError(`Playback unavailable: ${e.message}`));
    else v.pause();
  }, [vt, url, editing, playing]);
  useEffect(() => () => onBusy(false), []);
  useEffect(() => {
    setSelected(0);
    setEditing(false);
    setError("");
  }, [session?.id]);
  async function add(list: File[], handles?: any[]) {
    if (!session) return;
    onPause();
    setError("");
    abort.current = new AbortController();
    try {
      let clips = [...(binding?.clips || [])];
      const ordered = list
        .map((file, i) => ({ file, handle: handles?.[i] }))
        .sort((a, b) =>
          a.file.name.localeCompare(b.file.name, undefined, { numeric: true }),
        );
      list = ordered.map((x) => x.file);
      handles = handles ? ordered.map((x) => x.handle) : undefined;
      const urls = { ...files };
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        setProgress(`Hashing ${f.name}`);
        const identity = await work<Identity>(
          "hash",
          { file: f },
          (p) => setProgress(`Hashing ${f.name} · ${Math.round(p * 100)}%`),
          abort.current.signal,
        );
        const match = clips.find((c) => c.sha256 === identity.sha256);
        if (clips.length && clips.some((c) => !urls[c.sha256]) && !match)
          throw Error(
            "Video hash does not match the saved synchronization. Select the original file.",
          );
        const objectUrl = URL.createObjectURL(f);
        const duration = await new Promise<number>((resolve, reject) => {
          const v = document.createElement("video");
          const timer = setTimeout(
            () => reject(Error("Could not read video metadata.")),
            10000,
          );
          v.preload = "metadata";
          v.onloadedmetadata = () => {
            clearTimeout(timer);
            resolve(v.duration);
          };
          v.onerror = () => {
            clearTimeout(timer);
            URL.revokeObjectURL(objectUrl);
            reject(Error("Unsupported video codec or damaged file."));
          };
          v.src = objectUrl;
        });
        if (!Number.isFinite(duration) || duration <= 0)
          throw Error("Video has no valid duration.");
        urls[identity.sha256] = objectUrl;
        if (handles?.[i]) await saveHandle(identity.sha256, handles[i]);
        if (!match)
          clips.push({
            ...identity,
            duration,
            start: clips.length
              ? clips.at(-1)!.start + clips.at(-1)!.duration
              : 0,
          });
      }
      setFiles(urls);
      onBinding(
        binding
          ? { ...binding, clips }
          : {
              session: {
                sha256: session.id,
                name: session.filename,
                size: session.size,
              },
              clips,
              anchors: [],
            },
      );
      setEditing(!binding?.anchors.length);
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress("");
    }
  }
  async function open() {
    try {
      if ("showOpenFilePicker" in window) {
        const handles = await (window as any).showOpenFilePicker({
          multiple: true,
          types: [
            {
              description: "Videos",
              accept: { "video/*": [".mp4", ".mov", ".webm"] },
            },
          ],
        });
        await add(
          await Promise.all(handles.map((h: any) => h.getFile())),
          handles,
        );
      } else input.current?.click();
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") setError(String(e));
    }
  }
  async function reconnect() {
    if (!binding) return;
    try {
      const handles = await Promise.all(
        binding.clips.map((c) => getHandle(c.sha256)),
      );
      if (handles.some((h) => !h)) return open();
      for (const h of handles)
        if ((await h.requestPermission({ mode: "read" })) !== "granted")
          return open();
      await add(await Promise.all(handles.map((h) => h.getFile())), handles);
    } catch {
      await open();
    }
  }
  function anchor(second = false) {
    if (!binding || !clip || !video.current) return;
    const a = {
      videoSeconds: clip.start + video.current.currentTime,
      sessionTimestamp: stamp,
    };
    const next = {
      ...binding,
      anchors: second ? [binding.anchors[0], a] : [a],
    };
    try {
      validateSync({ format: "apex-sync", version: 1, bindings: [next] });
      onBinding(next);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <section className="video-panel">
      <div className="panel-heading">
        <span>
          {label} <small>{session?.track || "Select a lap"}</small>
        </span>
        <button disabled={!session} onClick={binding ? reconnect : open}>
          {binding ? "Relink / add clips" : "Open video"}
        </button>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="video/*"
        multiple
        onChange={(e) => add(Array.from(e.target.files || []))}
      />
      {url ? (
        <video
          ref={video}
          src={url}
          muted
          controls={editing}
          preload="auto"
          onSeeked={() => onBusy(false)}
          onLoadedData={() => onBusy(false)}
          onWaiting={() => onBusy(true)}
          onCanPlay={() => onBusy(false)}
          onError={() => {
            setError(
              "This browser cannot decode this video. Try an H.264 MP4.",
            );
            onBusy(false);
          }}
          onTimeUpdate={() => setSeek(video.current?.currentTime || 0)}
        />
      ) : (
        <div className="video-empty">
          <span>▷</span>
          <strong>
            {binding
              ? active === -1 && !editing
                ? "No footage at this position"
                : "Relink your local video"
              : "Your footage, in sync"}
          </strong>
          <p>
            {binding
              ? "Timing is saved. Video stays on your device."
              : "Open a video, choose a matching moment, save the sync."}
          </p>
          <button disabled={!session} onClick={open}>
            Choose local video
          </button>
        </div>
      )}
      {progress && (
        <p>
          {progress}{" "}
          <button onClick={() => abort.current?.abort()}>Cancel</button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {binding && (
        <>
          <div className="video-toolbar">
            <button
              className={editing ? "active" : ""}
              onClick={() => {
                onPause();
                setEditing(!editing);
              }}
            >
              {editing ? "Finish synchronization" : "Edit synchronization"}
            </button>
            <button
              title="Remove saved video synchronization for this session"
              onClick={() => {
                onPause();
                setEditing(false);
                onUnlink();
              }}
            >
              Unlink
            </button>
            <small>
              {binding.anchors.length === 2
                ? "Offset + drift correction"
                : binding.anchors.length === 1
                  ? "Offset saved"
                  : "Not synchronized"}
            </small>
          </div>
          {editing && (
            <div className="sync-editor">
              <label>
                Clip{" "}
                <select
                  value={selected}
                  onChange={(e) => setSelected(+e.target.value)}
                >
                  {binding.clips.map((c, i) => (
                    <option key={c.sha256} value={i}>
                      {i + 1}. {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button
                  onClick={() => {
                    if (video.current)
                      video.current.currentTime = Math.max(
                        0,
                        video.current.currentTime - 1 / 30,
                      );
                  }}
                >
                  − 1/30 s
                </button>
                <span>{seek.toFixed(3)} s</span>
                <button
                  onClick={() => {
                    if (video.current) video.current.currentTime += 1 / 30;
                  }}
                >
                  + 1/30 s
                </button>
              </div>
              <label>
                Clip starts at{" "}
                <input
                  type="number"
                  min="0"
                  step=".001"
                  value={clip?.start ?? 0}
                  onChange={(e) => {
                    const next = {
                      ...binding,
                      clips: binding.clips.map((c, i) =>
                        i === selected ? { ...c, start: +e.target.value } : c,
                      ),
                    };
                    try {
                      validateSync({
                        format: "apex-sync",
                        version: 1,
                        bindings: [next],
                      });
                      onBinding(next);
                    } catch {
                      setError("Clip start overlaps another clip.");
                    }
                  }}
                />{" "}
                s in recording
              </label>
              <div className="row">
                <button disabled={!url} onClick={() => anchor()}>
                  Set anchor at cursor
                </button>
                <button
                  disabled={!url || !binding.anchors.length}
                  onClick={() => anchor(true)}
                >
                  Set drift anchor
                </button>
              </div>
              <p className="muted">
                Match this video frame to the telemetry cursor. A later second
                anchor corrects clock drift. Frame steps assume 30 fps.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
