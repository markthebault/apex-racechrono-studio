import { useEffect, useRef, useState } from "react";
import { Check, Volume2, VolumeX } from "lucide-react";
import { ClockInput } from "./ClockInput";
import { lapTime } from "./model";
import type { Binding, Identity, Session } from "./model";
import { readCreationTime, matchVideoStart } from "./mp4";
import {
  formatClockTenths,
  formatWallClock,
  formatWallDate,
  parseWallClock,
} from "./wallclock";
import {
  cachedHash,
  rememberHash,
  getHandle,
  saveHandle,
  videoTime,
  stampAtVideo,
  work,
  validateSync,
} from "./storage";
// What picking a file should do: open the first video of a session, pick the saved
// video again, replace it with a different one, or add the next clip of a split recording.
type Mode = "first" | "relink" | "replace" | "append";
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
  onGoTo,
  lapStart,
  lapDuration,
  onJumpLap,
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
  onGoTo?: (stamp: number) => void;
  // Start and length of the lap on screen, so the panel can show and set the lap time.
  lapStart?: number;
  lapDuration?: number;
  onJumpLap?: (lapMs: number) => void;
}) {
  const flash = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flash.current), []);
  const pendingMode = useRef<Mode>("first");
  const video = useRef<HTMLVideoElement>(null),
    input = useRef<HTMLInputElement>(null),
    abort = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [selected, setSelected] = useState(0),
    [note, setNote] = useState(""),
    [startText, setStartText] = useState<string | null>(null),
    // What the last Sync linked, and whether to show the confirmation flash.
    [confirm, setConfirm] = useState<{
      what: string;
      video: number;
      lap: number;
      wall: number;
    } | null>(null),
    [justSynced, setJustSynced] = useState(false),
    // Lap A carries the sound. Lap B starts muted so two videos do not talk over each other.
    [muted, setMuted] = useState(label !== "LAP A");
  const [seek, setSeek] = useState(0);
  const vt = binding ? videoTime(binding, stamp) : NaN;
  const active =
    binding?.clips.findIndex(
      (c) => vt >= c.start && vt <= c.start + c.duration,
    ) ?? -1;
  const index = editing ? selected : active;
  const clip = binding?.clips[index];
  const url = clip ? files[clip.sha256] : undefined;
  // When the video and the GPS data start and end, on the telemetry clock.
  const videoStart = binding?.anchors.length ? stampAtVideo(binding, 0) : NaN;
  const videoEnd =
    binding?.anchors.length && binding.clips.length
      ? stampAtVideo(
          binding,
          Math.max(...binding.clips.map((c) => c.start + c.duration)),
        )
      : NaN;
  const overlapStart = session ? Math.max(videoStart, session.start) : NaN;
  const overlapEnd = session ? Math.min(videoEnd, session.end) : NaN;
  const overlaps = overlapStart < overlapEnd;
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
      v.play().catch((e) => {
        // Browsers may refuse sound until the page has been clicked. Fall back to a
        // silent picture and say so, instead of showing nothing.
        if (e.name === "NotAllowedError" && !v.muted) {
          v.muted = true;
          setMuted(true);
          setNote(
            "The browser blocked sound. Click the sound button to turn it on.",
          );
          v.play().catch((x) => setError(`Playback unavailable: ${x.message}`));
        } else setError(`Playback unavailable: ${e.message}`);
      });
    else v.pause();
  }, [vt, url, editing, playing]);
  useEffect(() => () => onBusy(false), []);
  useEffect(() => {
    setSelected(0);
    setEditing(false);
    setError("");
    setNote("");
    setConfirm(null);
  }, [session?.id]);
  async function add(list: File[], handles: any[] | undefined, mode: Mode) {
    if (!session) return;
    onPause();
    setError("");
    abort.current = new AbortController();
    try {
      // Replacing starts over: nothing of the old video or its sync carries across.
      const base = mode === "replace" ? undefined : binding;
      let clips = [...(base?.clips || [])];
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
        // A file seen before is recognised from a 2 MB fingerprint instead of being read
        // through again, which takes half a minute for a multi-gigabyte video.
        setProgress(`Checking ${f.name}`);
        const fingerprint = await work<string>(
          "fingerprint",
          { file: f },
          undefined,
          abort.current.signal,
        );
        const known = await cachedHash(fingerprint);
        let identity: Identity;
        if (known) identity = { sha256: known, name: f.name, size: f.size };
        else {
          setProgress(`Hashing ${f.name}`);
          identity = await work<Identity>(
            "hash",
            { file: f },
            (p) => setProgress(`Hashing ${f.name} · ${Math.round(p * 100)}%`),
            abort.current.signal,
          );
          await rememberHash(fingerprint, identity.sha256);
        }
        const match = clips.find((c) => c.sha256 === identity.sha256);
        if (mode === "relink" && !match)
          throw Error(
            `${f.name} is not the video saved for this session. Pick the original file, or use Replace video to switch to this one.`,
          );
        if (mode === "append" && !match && clips.some((c) => !urls[c.sha256]))
          throw Error("Reload the earlier clips first, then add the next one.");
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
      // A first clip is placed on the telemetry clock from the time recorded in the file,
      // when that time falls inside this session.
      let anchors = base?.anchors ?? [];
      let placed: number | null = null;
      if (!base?.clips.length && clips.length) {
        const shown = (t: number) =>
          new Date(t).toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "medium",
          });
        const created = await readCreationTime(list[0]);
        const match =
          created === null
            ? null
            : matchVideoStart(
                created,
                { start: session.start, end: session.end },
                new Date(created).getTimezoneOffset(),
              );
        if (match) {
          placed = match.start;
          anchors = [
            { videoSeconds: clips[0].start, sessionTimestamp: match.start },
          ];
          setNote(
            `Synced from the time recorded in the video, ${shown(match.start)}` +
              (match.ambiguous
                ? `. It could also be ${shown(match.other)} if the camera stored local time. Check the picture against the map and press Sync here if it is off.`
                : match.reading === "local"
                  ? " (the camera stored local time). Check the picture against the map."
                  : ". Check the picture against the map."),
          );
        } else
          setNote(
            created === null
              ? "This video has no recording time, so it cannot be placed automatically. Sync it by hand with the steps below."
              : `The time recorded in this video (${shown(created)}) is outside this session. It is usually the moment the file was exported, so it cannot place the video. Sync it by hand with the steps below.`,
          );
      }
      const next: Binding = base
        ? { ...base, clips, anchors }
        : {
            session: {
              sha256: session.id,
              name: session.filename,
              size: session.size,
            },
            clips,
            anchors,
          };
      onBinding(next);
      setEditing(!anchors.length);
      if (mode === "replace") setConfirm(null);
      if (placed !== null) onGoTo?.(placed);
      else if (anchors.length) {
        // A synced video that is out of view would look broken, so go to it.
        const from = stampAtVideo(next, 0),
          to = stampAtVideo(
            next,
            Math.max(...clips.map((c) => c.start + c.duration)),
          );
        if (stamp < from || stamp > to) onGoTo?.(Math.max(from, session.start));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress("");
    }
  }
  async function open(mode: Mode = binding ? "relink" : "first") {
    pendingMode.current = mode;
    try {
      if ("showOpenFilePicker" in window) {
        const handles = await (window as any).showOpenFilePicker({
          multiple: mode !== "replace",
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
          mode,
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
      if (handles.some((h) => !h)) return open("relink");
      for (const h of handles)
        if ((await h.requestPermission({ mode: "read" })) !== "granted")
          return open("relink");
      await add(
        await Promise.all(handles.map((h) => h.getFile())),
        handles,
        "relink",
      );
    } catch {
      await open("relink");
    }
  }
  function anchor(second = false) {
    if (!binding || !clip || !video.current) return;
    const seconds = clip.start + video.current.currentTime;
    const a = { videoSeconds: seconds, sessionTimestamp: stamp };
    const next = {
      ...binding,
      anchors: second ? [binding.anchors[0], a] : [a],
    };
    try {
      validateSync({ format: "apex-sync", version: 1, bindings: [next] });
      onBinding(next);
      setError("");
      // Visible proof that the press did something.
      setConfirm({
        what: second ? "Drift correction added" : "Synced",
        video: seconds,
        lap: lapStart === undefined ? NaN : stamp - lapStart,
        wall: stamp,
      });
      setJustSynced(true);
      clearTimeout(flash.current);
      flash.current = setTimeout(() => setJustSynced(false), 2400);
    } catch (e) {
      setError(String(e));
    }
  }
  // The typed start time replaces the anchors, so any drift correction is dropped.
  function commitStart() {
    const text = startText;
    setStartText(null);
    if (text === null || !binding || !session) return;
    const t = parseWallClock(text, session.start);
    if (!Number.isFinite(t)) {
      setError(
        "Type the start time as 14:10:04, 14:10:04.500 or 2026-09-27 14:10:04.",
      );
      return;
    }
    const next = {
      ...binding,
      anchors: [{ videoSeconds: 0, sessionTimestamp: t }],
    };
    try {
      validateSync({ format: "apex-sync", version: 1, bindings: [next] });
      onBinding(next);
      setError("");
      setNote(
        `Video start set to ${formatWallClock(t)}. Press Go to where video and GPS overlap to check it against the map.`,
      );
    } catch (e) {
      setError(String(e));
    }
  }
  // Show the first moment that has both picture and GPS data.
  function goToOverlap() {
    if (!binding || !overlaps) return;
    onGoTo?.(overlapStart);
    const seconds = videoTime(binding, overlapStart);
    const at = binding.clips.findIndex(
      (c) => seconds >= c.start && seconds <= c.start + c.duration,
    );
    if (at >= 0 && at !== selected) setSelected(at);
    if (at >= 0 && video.current && at === index)
      video.current.currentTime = seconds - binding.clips[at].start;
  }
  // Tie the frame on screen to the moment the GPS data begins.
  function syncToGpsStart() {
    if (!binding || !clip || !video.current || !session) return;
    const next = {
      ...binding,
      anchors: [
        {
          videoSeconds: clip.start + video.current.currentTime,
          sessionTimestamp: session.start,
        },
      ],
    };
    try {
      validateSync({ format: "apex-sync", version: 1, bindings: [next] });
      onBinding(next);
      setError("");
      setNote(
        `This frame is now linked to ${formatWallClock(session.start)}, where the GPS data starts.`,
      );
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
        {binding ? (
          <span className="heading-actions">
            <button
              disabled={!session}
              title="Pick the same video file again, for example after reloading the page"
              onClick={reconnect}
            >
              Reload video
            </button>
            <button
              disabled={!session}
              title="Use a different video for this session. The current sync is discarded"
              onClick={() => open("replace")}
            >
              Replace video
            </button>
          </span>
        ) : (
          <button
            disabled={!session}
            title="Choose a video of this session"
            onClick={() => open("first")}
          >
            Open video
          </button>
        )}
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="video/*"
        multiple
        onChange={(e) => {
          const chosen = Array.from(e.target.files || []);
          e.target.value = "";
          add(chosen, undefined, pendingMode.current);
        }}
      />
      {url ? (
        <video
          ref={video}
          src={url}
          muted={muted}
          className={justSynced ? "flash" : undefined}
          controls={editing}
          preload="auto"
          onSeeked={() => onBusy(false)}
          onLoadedData={() => onBusy(false)}
          onWaiting={() => onBusy(true)}
          onCanPlay={() => onBusy(false)}
          onError={() => {
            setError(
              "This browser cannot decode this video. It is probably HEVC (H.265): Safari plays it, Chrome only with hardware support. Convert it with: ffmpeg -i input.MP4 -c:v libx264 -crf 23 -an output.mp4",
            );
            onBusy(false);
          }}
          onTimeUpdate={() => setSeek(video.current?.currentTime || 0)}
        />
      ) : (
        <div className="video-empty">
          <span>▷</span>
          {binding &&
          !editing &&
          active === -1 &&
          Number.isFinite(videoStart) ? (
            <>
              <strong>The video is not showing at this moment</strong>
              <p>
                It covers {formatWallClock(videoStart)} to{" "}
                {formatWallClock(videoEnd)} local time.{" "}
                {overlaps
                  ? "This point on the lap is outside that."
                  : "That does not overlap this session's GPS data, so the start time is probably wrong."}
              </p>
              {overlaps ? (
                <button
                  className="sync-button"
                  onClick={() => onGoTo?.(overlapStart)}
                >
                  Go to where the video starts
                </button>
              ) : (
                <button onClick={() => setEditing(true)}>
                  Fix the start time
                </button>
              )}
            </>
          ) : (
            <>
              <strong>
                {binding ? "Reload your local video" : "Your footage, in sync"}
              </strong>
              <p>
                {binding
                  ? "The sync is saved. The video stays on your device, so pick the file again."
                  : "Open a video, choose a matching moment, save the sync."}
              </p>
              <button
                disabled={!session}
                onClick={() => open(binding ? "relink" : "first")}
              >
                {binding ? "Reload video" : "Choose local video"}
              </button>
            </>
          )}
        </div>
      )}
      {progress && (
        <p>
          {progress}{" "}
          <button onClick={() => abort.current?.abort()}>Cancel</button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {note && <p className="sync-note">{note}</p>}
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
              {editing ? "Done" : "Adjust sync"}
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
            <button
              className={muted ? "" : "active"}
              aria-pressed={!muted}
              title={
                muted ? "Turn the video sound on" : "Turn the video sound off"
              }
              onClick={() => {
                setMuted(!muted);
                setNote("");
              }}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}{" "}
              {muted ? "Sound off" : "Sound on"}
            </button>
            <small className={binding.anchors.length ? "synced" : "unsynced"}>
              {binding.anchors.length === 2
                ? "Synced, with drift correction"
                : binding.anchors.length === 1
                  ? "Synced"
                  : "Not synced yet"}
            </small>
          </div>
          {editing && (
            <div className="sync-editor">
              <div
                className={`sync-status ${binding.anchors.length ? "ok" : "todo"}`}
                role="status"
                aria-live="polite"
              >
                {binding.anchors.length ? (
                  <>
                    <Check size={15} /> Synced. The video starts at{" "}
                    {formatWallClock(videoStart)} local time.
                  </>
                ) : (
                  "Not synced yet. Follow the three steps."
                )}
              </div>
              {confirm && (
                <div
                  className={`sync-confirm${justSynced ? " pop" : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  <Check size={16} />
                  <span>
                    <b>{confirm.what}.</b> Video {confirm.video.toFixed(1)} s is
                    now linked to
                    {Number.isFinite(confirm.lap)
                      ? ` lap time ${lapTime(confirm.lap)}`
                      : ""}{" "}
                    ({formatClockTenths(confirm.wall)}).
                  </span>
                </div>
              )}
              <ol className="sync-flow">
                <li>
                  <h4>
                    <span>1</span> Pause the video on a moment you can recognise
                  </h4>
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
                      ◂ Frame
                    </button>
                    <b>{seek.toFixed(2)} s</b>
                    <button
                      onClick={() => {
                        if (video.current) video.current.currentTime += 1 / 30;
                      }}
                    >
                      Frame ▸
                    </button>
                  </div>
                </li>
                <li>
                  <h4>
                    <span>2</span> Put the telemetry on the same moment
                  </h4>
                  <div className="row">
                    {onJumpLap && lapStart !== undefined ? (
                      <label className="lap-jump">
                        Lap time{" "}
                        <ClockInput
                          ms={stamp - lapStart}
                          max={lapDuration ?? 0}
                          onJump={onJumpLap}
                        />
                      </label>
                    ) : (
                      Number.isFinite(stamp - (lapStart ?? NaN)) && (
                        <span>Lap time {lapTime(stamp - (lapStart ?? 0))}</span>
                      )
                    )}
                    <small>Time of day {formatClockTenths(stamp)}</small>
                  </div>
                  <p className="muted">
                    Type a lap time and press Enter, click the map or a chart,
                    or use the left and right arrow keys.
                  </p>
                </li>
                <li>
                  <h4>
                    <span>3</span> Link them
                  </h4>
                  <button
                    className={`sync-button big${justSynced ? " done" : ""}`}
                    disabled={!url}
                    onClick={() => anchor()}
                  >
                    {justSynced ? (
                      <>
                        <Check size={18} /> Synced
                      </>
                    ) : (
                      "Sync here"
                    )}
                  </button>
                </li>
              </ol>
              <details className="sync-more">
                <summary>Other ways to sync</summary>
                <div className="start-time">
                  <p>
                    <b>You know when the video started.</b> Type it and the rest
                    follows.
                  </p>
                  <label>
                    Video started at{" "}
                    <input
                      aria-label="Time the video started, local time"
                      placeholder="14:10:04"
                      value={
                        startText ??
                        (Number.isFinite(videoStart)
                          ? formatWallClock(videoStart)
                          : "")
                      }
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setStartText(e.target.value)}
                      onBlur={commitStart}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") commitStart();
                        if (e.key === "Escape") setStartText(null);
                      }}
                    />{" "}
                    <small>
                      {session ? formatWallDate(session.start) : ""}, local time
                    </small>
                  </label>
                  {session && (
                    <p className="muted">
                      GPS data {formatWallClock(session.start)} to{" "}
                      {formatWallClock(session.end)}.{" "}
                      {Number.isFinite(videoStart)
                        ? `Video ${formatWallClock(videoStart)} to ${formatWallClock(videoEnd)}. ` +
                          (overlaps
                            ? `Both run from ${formatWallClock(overlapStart)} to ${formatWallClock(overlapEnd)}.`
                            : "They do not overlap, so check the start time.")
                        : ""}
                    </p>
                  )}
                  <div className="row">
                    <button disabled={!overlaps} onClick={goToOverlap}>
                      Show where video and GPS overlap
                    </button>
                  </div>
                </div>
                <div className="start-time">
                  <p>
                    <b>The video began before the GPS data.</b> Pause on the
                    frame where the GPS data starts, then link it.
                  </p>
                  <div className="row">
                    <button disabled={!url} onClick={syncToGpsStart}>
                      Link this frame to GPS start
                    </button>
                  </div>
                </div>
                <div className="start-time">
                  <p>
                    <b>Long video that drifts out of step.</b> After syncing at
                    the start, sync again on a later moment.
                  </p>
                  <div className="row">
                    <button
                      disabled={!url || !binding.anchors.length}
                      onClick={() => anchor(true)}
                    >
                      Add drift correction
                    </button>
                  </div>
                </div>
                <div className="start-time">
                  <p>
                    <b>The recording is split into several files.</b> Add the
                    next file so it plays after this one.
                  </p>
                  <div className="row">
                    <button disabled={!session} onClick={() => open("append")}>
                      Add next clip
                    </button>
                  </div>
                </div>
                {binding.clips.length > 1 && (
                  <div className="start-time">
                    <p>
                      <b>Several clips.</b> Choose the clip on screen and where
                      it starts in the recording.
                    </p>
                    <div className="row">
                      <select
                        aria-label="Clip"
                        value={selected}
                        onChange={(e) => setSelected(+e.target.value)}
                      >
                        {binding.clips.map((c, i) => (
                          <option key={c.sha256} value={i}>
                            {i + 1}. {c.name}
                          </option>
                        ))}
                      </select>
                      <label>
                        Starts at{" "}
                        <input
                          type="number"
                          min="0"
                          step=".001"
                          value={clip?.start ?? 0}
                          onChange={(e) => {
                            const next = {
                              ...binding,
                              clips: binding.clips.map((c, i) =>
                                i === selected
                                  ? { ...c, start: +e.target.value }
                                  : c,
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
                        s
                      </label>
                    </div>
                  </div>
                )}
              </details>
            </div>
          )}
        </>
      )}
    </section>
  );
}
