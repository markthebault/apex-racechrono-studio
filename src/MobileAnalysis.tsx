import { TouchButton } from "./TouchButton";
import { openAgentConnection, useAgentConnection } from "./agent/connection";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Chart } from "./Chart";
import { TrackMap } from "./Map";
import { zoomRange } from "./analysis";
import {
  definitions,
  lapTime,
  type Binding,
  type Comparison,
  type Settings,
  type Trace,
} from "./model";
import { videoTime } from "./storage";
import { useStoredView, viewBoolean } from "./viewState";
import type { DetectedTurn } from "./turns";
import type { ChartInteraction } from "./mobileAnalysis";
import "./mobileAnalysis.css";

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 390, height: 260 });
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, ...size };
}
export type MobileMedia = { tag: string; stamp: number; binding?: Binding };
export function MobileVideo({
  media,
  files,
  playing,
  rate,
}: {
  media: MobileMedia;
  files: Record<string, string>;
  playing: boolean;
  rate: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const seconds = media.binding ? videoTime(media.binding, media.stamp) : NaN;
  const clip = media.binding?.clips.find(
    (c) => seconds >= c.start && seconds <= c.start + c.duration,
  );
  const url = clip && files[clip.sha256];
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || !clip || !url || !Number.isFinite(seconds)) return;
    const sync = () => {
      if (
        Math.abs(el.currentTime - (seconds - clip.start)) >
        (playing ? 0.25 : 0.04)
      )
        el.currentTime = Math.max(0, seconds - clip.start);
    };
    if (el.readyState) sync();
    else el.addEventListener("loadedmetadata", sync, { once: true });
    el.playbackRate = Math.max(0.25, Math.min(4, rate));
    if (playing)
      void el
        .play()
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    else el.pause();
    return () => el.removeEventListener("loadedmetadata", sync);
  }, [url, seconds, playing, rate, clip]);
  return (
    <div className="ma-video" data-video-tag={media.tag}>
      {url ? (
        <video
          ref={ref}
          src={url}
          playsInline
          muted={muted}
          preload="auto"
          aria-label={`Lap ${media.tag} synchronized video`}
        />
      ) : (
        <span>
          {media.tag} ·{" "}
          {clip ? "Relink local video" : "No synchronized clip here"}
        </span>
      )}
      {blocked && (
        <TouchButton
          onClick={() => void ref.current?.play().then(() => setBlocked(false))}
        >
          Play video
        </TouchButton>
      )}
      {url && (
        <TouchButton
          className="ma-video-audio"
          aria-label={`${muted ? "Unmute" : "Mute"} lap ${media.tag} video`}
          onClick={() => setMuted(!muted)}
        >
          {muted ? "Sound off" : "Sound on"}
        </TouchButton>
      )}
      <b>{media.tag}</b>
    </div>
  );
}
export function MobileAnalysis({
  a,
  chartA,
  mapOthers,
  laps,
  others,
  settings,
  onSettings,
  range,
  cursor,
  elapsed,
  delta,
  playing,
  rate,
  onRate,
  onPlay,
  onCursor,
  onRange,
  onFocusTurn,
  turns,
  selectedTurn,
  gates,
  channels,
  media,
  files,
  onVideoSetup,
  optimal,
  sectorCount,
  trackName,
  onView,
  onFullTools,
}: {
  onFullTools: () => void;
  onView?: (
    view: { channels: string[]; interaction: ChartInteraction } | null,
  ) => void;
  a: Trace;
  chartA: Trace;
  mapOthers: Comparison[];
  laps: Trace[];
  others: Comparison[];
  settings: Settings;
  onSettings: (p: Partial<Settings>) => void;
  range: [number, number];
  cursor: number;
  elapsed: number;
  delta: number;
  playing: boolean;
  rate: number;
  onRate: (rate: number) => void;
  onPlay: () => void;
  onCursor: (d: number) => void;
  onRange: (r: [number, number]) => void;
  onFocusTurn: (id: string | null) => void;
  turns: DetectedTurn[];
  selectedTurn: string | null;
  gates: number[];
  channels: string[];
  media: MobileMedia[];
  files: Record<string, string>;
  onVideoSetup: () => void;
  optimal?: Trace;
  sectorCount: number;
  trackName: string;
}) {
  const connection = useAgentConnection();
  const [interaction, setInteraction] = useStoredView<ChartInteraction>(
    "mobile-gesture",
    "scrub",
    (v): v is ChartInteraction => ["scrub", "pan", "range"].includes(String(v)),
  );
  const [split, setSplit] = useStoredView(
    "mobile-split",
    42,
    (v): v is number => typeof v === "number" && v >= 25 && v <= 65,
  );
  const [showVideo, setShowVideo] = useStoredView(
    "mobile-video",
    false,
    viewBoolean,
  );
  const defaults = [
    "speed",
    "acceleration",
    "rpm",
    "throttle",
    "altitude",
    "heading",
  ]
    .filter((c) => channels.includes(c))
    .slice(0, 3);
  const [chosenChannels, setChosenChannels] = useStoredView(
    "mobile-channels",
    defaults,
    (v): v is string[] =>
      Array.isArray(v) &&
      v.length > 0 &&
      v.length <= 8 &&
      v.every((c) => typeof c === "string" && c.length < 80),
  );
  const available = chosenChannels.filter((c) => channels.includes(c));
  const shown = available.length ? available : defaults;
  useEffect(() => {
    onView?.({ channels: shown, interaction });
    return () => onView?.(null);
  }, [onView, shown.join("|"), interaction]);
  const [sheet, setSheet] = useState<"A" | "B" | "channels" | "options" | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const resize = useRef(false);
  const mapBox = useSize(),
    chartBox = useSize();
  useEffect(() => {
    if (sheet && !dialog.current?.open) dialog.current?.showModal();
    if (!sheet && dialog.current?.open) dialog.current.close();
    setSearch("");
  }, [sheet]);
  const close = () => setSheet(null);
  const chooseLap = (id: string) => {
    onSettings(sheet === "A" ? { a: id } : { b: id });
    close();
  };
  const span = range[1] - range[0];
  const chartHeight = Math.max(
    60,
    Math.min(160, chartBox.height / Math.min(shown.length || 1, 4) - 29),
  );
  const b = others[0]?.trace;
  const name = (t?: Trace) => (t ? `Lap ${t.lap.number}` : "Compare lap");
  const scrub = (d: number) => onCursor(Math.max(0, Math.min(a.length, d)));
  const resizeAt = (x: number, y: number) => {
    const box = stage.current!.getBoundingClientRect();
    const horizontal = window.matchMedia(
      "(min-width: 700px) and (orientation: landscape)",
    ).matches;
    const percent = horizontal
      ? ((x - box.left) / box.width) * 100
      : ((y - box.top) / box.height) * 100;
    setSplit(Math.max(25, Math.min(65, Math.round(percent))));
  };
  return (
    <section
      className="mobile-analysis"
      aria-label="Mobile lap analysis"
      data-cursor={cursor.toFixed(2)}
      data-range={range.join(",")}
      data-interaction={interaction}
    >
      <div className="ma-lapbar">
        <TouchButton
          className="ma-lap"
          aria-label="Choose lap A"
          onClick={() => setSheet("A")}
        >
          <i style={{ background: settings.colors[0] }} />
          <span>
            <b>A · {name(a)}</b>
            <small>{lapTime(a.lap.end - a.lap.start)}</small>
          </span>
          <span>⌄</span>
        </TouchButton>
        <TouchButton
          className="ma-lap"
          aria-label="Choose lap B"
          onClick={() => setSheet("B")}
        >
          <i style={{ background: settings.colors[1] }} />
          <span>
            <b>{b?.id === "optimal" ? "B · Optimal" : `B · ${name(b)}`}</b>
            <small>
              {b ? lapTime(b.lap.end - b.lap.start) : "Add comparison"}
              {b?.id === "optimal" ? ` · ${sectorCount} sectors` : ""}
            </small>
          </span>
          <span>⌄</span>
        </TouchButton>
        <select
          aria-label="Focus turn"
          value={selectedTurn ?? ""}
          onChange={(e) => onFocusTurn(e.target.value || null)}
        >
          <option value="">Lap</option>
          {turns.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <TouchButton
          aria-label="Analysis options"
          onClick={() => setSheet("options")}
        >
          •••
        </TouchButton>
      </div>
      {a.issues.length > 0 || b?.issues.length ? (
        <div className="ma-quality" role="status">
          {a.issues.length > 0 ? `A: ${a.issues.join(" · ")}` : ""}
          {a.issues.length > 0 && b?.issues.length ? " / " : ""}
          {b?.issues.length ? `B: ${b.issues.join(" · ")}` : ""}
        </div>
      ) : null}
      <div
        className="ma-stage"
        ref={stage}
        style={{ "--ma-split": `${split}%` } as CSSProperties}
      >
        <div className="ma-map-pane">
          {showVideo && (
            <div className="ma-videos">
              {media.some((m) => m.binding?.clips.length) ? (
                media.map((m) => (
                  <MobileVideo
                    key={m.tag}
                    media={m}
                    files={files}
                    playing={playing}
                    rate={rate}
                  />
                ))
              ) : (
                <TouchButton onClick={onVideoSetup}>
                  Link & sync local video in Video sync →
                </TouchButton>
              )}
            </div>
          )}
          <div className="ma-map-box" ref={mapBox.ref}>
            <TrackMap
              a={a}
              others={mapOthers}
              colors={settings.colors}
              cursor={cursor}
              range={range}
              gates={gates}
              turns={turns}
              selectedTurn={selectedTurn}
              onTurn={onFocusTurn}
              onCursor={scrub}
              height={Math.max(80, mapBox.height)}
              onHeight={() => {}}
              speedUnit={settings.speedUnit}
              compact
            />
          </div>
          <div className="ma-map-caption">
            <span>{trackName}</span>
            <TouchButton
              aria-pressed={showVideo}
              onClick={() => setShowVideo(!showVideo)}
            >
              Video {showVideo ? "on" : "off"}
            </TouchButton>
          </div>
        </div>
        <div
          className="ma-divider"
          role="separator"
          aria-label="Map and telemetry split"
          aria-valuemin={25}
          aria-valuemax={65}
          aria-valuenow={split}
          tabIndex={0}
          onPointerDown={(e) => {
            resize.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (resize.current) resizeAt(e.clientX, e.clientY);
          }}
          onPointerUp={() => {
            resize.current = false;
          }}
          onPointerCancel={() => {
            resize.current = false;
          }}
          onKeyDown={(e) => {
            if (
              ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              e.stopPropagation();
              setSplit(
                Math.max(
                  25,
                  Math.min(
                    65,
                    split + (["ArrowUp", "ArrowLeft"].includes(e.key) ? -5 : 5),
                  ),
                ),
              );
            }
          }}
        >
          <span />
        </div>
        <div className="ma-telemetry">
          <div className="ma-chart-tools">
            <div role="group" aria-label="Chart gesture">
              {(["scrub", "pan", "range"] as const).map((m) => (
                <TouchButton
                  key={m}
                  aria-pressed={m === interaction}
                  onClick={() => setInteraction(m)}
                >
                  {m === "range" ? "Zoom" : m === "scrub" ? "Scrub" : "Pan"}
                </TouchButton>
              ))}
            </div>
            <TouchButton
              aria-label="Zoom telemetry in"
              onClick={() => onRange(zoomRange(range, cursor, 0.6, a.length))}
            >
              ＋
            </TouchButton>
            <TouchButton
              aria-label="Zoom telemetry out"
              onClick={() => onRange(zoomRange(range, cursor, 1.7, a.length))}
            >
              −
            </TouchButton>
            <TouchButton
              aria-label="Reset telemetry zoom"
              onClick={() => onFocusTurn(null)}
            >
              Full
            </TouchButton>
            <TouchButton
              aria-label="Choose telemetry channels"
              onClick={() => setSheet("channels")}
            >
              Channels
            </TouchButton>
          </div>
          <div className="ma-chart-stack" ref={chartBox.ref}>
            {shown.map((channel) => (
              <Chart
                key={channel}
                config={{
                  id: `mobile-${channel}`,
                  channels: [channel],
                  height: chartHeight,
                }}
                compact
                interaction={interaction}
                a={a}
                others={others}
                colors={settings.colors}
                speedUnit={settings.speedUnit}
                joins={
                  others.some((o) => o.trace.id === "optimal")
                    ? gates.slice(1, -1)
                    : []
                }
                cursor={cursor}
                range={range}
                onCursor={scrub}
                onZoom={onRange}
                length={a.length}
                onRange={(r) => {
                  onRange(r);
                  scrub(r[0]);
                }}
                onChange={() => {}}
                onRemove={() => {}}
                onUp={() => {}}
              />
            ))}
            {!shown.length && (
              <p className="ma-empty">
                No recorded telemetry channels are available for this lap.
              </p>
            )}
          </div>
          <div className="ma-transport">
            <TouchButton
              className="ma-play"
              aria-label={playing ? "Pause playback" : "Play playback"}
              onClick={onPlay}
            >
              {playing ? "Ⅱ" : "▶"}
            </TouchButton>
            <span>{lapTime(elapsed)}</span>
            <input
              aria-label="Track position"
              type="range"
              min={range[0]}
              max={range[1]}
              step={0.1}
              value={Math.max(range[0], Math.min(range[1], cursor))}
              onChange={(e) => scrub(+e.target.value)}
            />
            <output aria-label="Lap time delta">
              {Number.isFinite(delta)
                ? `${delta > 0 ? "+" : ""}${(delta / 1000).toFixed(2)}s`
                : `${(cursor / 1000).toFixed(2)}km`}
            </output>
          </div>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="ma-sheet"
        aria-label={
          sheet === "A" || sheet === "B"
            ? `Select lap ${sheet}`
            : sheet === "channels"
              ? "Telemetry channels"
              : "Analysis settings"
        }
        onCancel={close}
        onClose={close}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          backdropPress.current =
            e.target === e.currentTarget &&
            (e.clientX < r.left ||
              e.clientX > r.right ||
              e.clientY < r.top ||
              e.clientY > r.bottom);
        }}
        onClick={() => {
          if (backdropPress.current) close();
          backdropPress.current = false;
        }}
      >
        <div className="ma-sheet-heading">
          <h2>
            {sheet === "A" || sheet === "B"
              ? `Choose lap ${sheet}`
              : sheet === "channels"
                ? "Telemetry channels"
                : "Analysis options"}
          </h2>
          <TouchButton aria-label="Close analysis sheet" onClick={close}>
            ✕
          </TouchButton>
        </div>
        {(sheet === "A" || sheet === "B") && (
          <>
            <input
              aria-label="Search laps"
              placeholder="Find a lap or recording…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {sheet === "B" && (
              <TouchButton
                className="ma-lap-option"
                onClick={() => chooseLap("")}
              >
                No comparison
              </TouchButton>
            )}
            {laps
              .filter(
                (t) =>
                  (sheet === "A" || t.id !== a.id) &&
                  `${t.label} ${new Date(t.lap.start).toLocaleString()}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
              )
              .map((t) => (
                <TouchButton
                  key={t.id}
                  className="ma-lap-option"
                  aria-pressed={t.id === (sheet === "A" ? a.id : b?.id)}
                  onClick={() => chooseLap(t.id)}
                >
                  <span>
                    <b>{name(t)}</b>
                    <small>
                      {new Date(t.lap.start).toLocaleString()}{" "}
                      {t.issues.length ? " · ⚠ Check GPS quality" : ""}
                    </small>
                  </span>
                  <strong>{lapTime(t.lap.end - t.lap.start)}</strong>
                </TouchButton>
              ))}
            {sheet === "B" && optimal && (
              <TouchButton
                className="ma-lap-option"
                aria-pressed={b?.id === "optimal"}
                onClick={() => chooseLap("optimal")}
              >
                <span>
                  <b>Theoretical optimal</b>
                  <small>{sectorCount} best sectors · recorded composite</small>
                </span>
                <strong>{lapTime(optimal.lap.end)}</strong>
              </TouchButton>
            )}
          </>
        )}
        {sheet === "channels" && (
          <>
            <p>
              Up to eight channels. Available telemetry only; desktop chart
              settings are kept separately.
            </p>
            {channels.map((c) => (
              <label className="ma-channel-option" key={c}>
                <input
                  type="checkbox"
                  checked={shown.includes(c)}
                  disabled={
                    (!shown.includes(c) && shown.length >= 8) ||
                    (shown.length === 1 && shown.includes(c))
                  }
                  onChange={(e) =>
                    setChosenChannels(
                      e.target.checked
                        ? [...shown, c]
                        : shown.filter((x) => x !== c),
                    )
                  }
                />
                <span>{definitions[c]?.name || c}</span>
              </label>
            ))}
            <TouchButton className="primary" onClick={close}>
              Done
            </TouchButton>
          </>
        )}
        {sheet === "options" && (
          <div className="ma-settings">
            <TouchButton
              onClick={() => {
                close();
                openAgentConnection();
              }}
            >
              {connection === "connected"
                ? "Agent connected"
                : "Connect AI agent"}
            </TouchButton>
            <label>
              Speed units
              <select
                aria-label="Speed units"
                value={settings.speedUnit}
                onChange={(e) =>
                  onSettings({
                    speedUnit: e.target.value as Settings["speedUnit"],
                  })
                }
              >
                <option>km/h</option>
                <option>mph</option>
              </select>
            </label>
            <label>
              Comparison alignment
              <select
                aria-label="Comparison alignment"
                value={settings.mode}
                onChange={(e) =>
                  onSettings({ mode: e.target.value as Settings["mode"] })
                }
              >
                <option value="distance">By distance</option>
                <option value="time">Elapsed-time replay</option>
              </select>
            </label>
            <label>
              Playback speed
              <select
                aria-label="Playback speed"
                value={rate}
                onChange={(e) => onRate(+e.target.value)}
              >
                {[0.25, 0.5, 1, 2].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
            <p>
              Mobile focuses on laps A and B. Extra desktop comparisons remain
              saved.
            </p>
            <p>
              Scrub moves the cars and linked videos. Pan moves the timeline
              without changing its scale. Zoom deliberately selects a distance
              range. Swipe vertically to scroll channels.
            </p>
            <TouchButton onClick={onFullTools}>
              Open full analysis tools
            </TouchButton>
            <TouchButton onClick={onVideoSetup}>
              Link or synchronize video →
            </TouchButton>
            {optimal && (
              <p>
                Theoretical optimal: {lapTime(optimal.lap.end)} · {sectorCount}{" "}
                sectors.
              </p>
            )}
            <div>
              <a href="/privacy.html">Privacy</a> ·{" "}
              <a href="/terms.html">Terms</a>
            </div>
            <small>
              {(a.length / 1000).toFixed(2)} km · current window{" "}
              {(span / 1000).toFixed(2)} km · GPS does not establish exact
              track-edge clearance.
            </small>
          </div>
        )}
      </dialog>
    </section>
  );
}
