import { useEffect, useMemo, useState } from "react";
import type { Clip, Session } from "./model";
import {
  cameraAcceleration,
  readGoProMotion,
  sessionAcceleration,
} from "./videoTelemetry";
import type { CameraMotion, GraphPoint } from "./videoTelemetry";
import "./videoMotionSync.css";
export type MotionConfig = {
  camera: "none" | "gopro";
  axis: number;
  invert: boolean;
  baseline: number;
};
const defaults: MotionConfig = {
  camera: "none",
  axis: 2,
  invert: false,
  baseline: 0,
};
const cameras = [
  { id: "none", name: "No camera telemetry" },
  { id: "gopro", name: "GoPro · embedded GPMF" },
] as const;
function MotionGraph({
  points,
  cursor,
  onPick,
  name,
  windowSeconds,
}: {
  points: GraphPoint[];
  cursor: number;
  onPick?: (t: number) => void;
  name: string;
  windowSeconds: number;
}) {
  const start = cursor - windowSeconds / 2,
    end = start + windowSeconds;
  const shown = points.filter((p) => p.t >= start && p.t <= end);
  let path = "",
    last = NaN;
  for (const p of shown) {
    if (!Number.isFinite(p.g)) {
      last = NaN;
      continue;
    }
    const x = 36 + ((p.t - start) / windowSeconds) * 528,
      y = 90 - Math.max(-2, Math.min(2, p.g)) * 32;
    path += `${!Number.isFinite(last) || p.t - last > 2 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
    last = p.t;
  }
  const nearest = shown.reduce<GraphPoint | undefined>(
    (a, p) => (!a || Math.abs(p.t - cursor) < Math.abs(a.t - cursor) ? p : a),
    undefined,
  );
  return (
    <div className="motion-graph">
      <div className="motion-graph-title">
        <b>{name}</b>
        <span>
          {nearest &&
          Math.abs(nearest.t - cursor) < 1 &&
          Number.isFinite(nearest.g)
            ? `${nearest.g.toFixed(2)} g`
            : "No sample"}
        </span>
      </div>
      <svg
        viewBox="0 0 600 190"
        role="img"
        aria-label={`${name} acceleration graph. Click to select a braking event.`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 600;
          onPick?.(
            Math.max(
              points[0]?.t ?? start,
              Math.min(
                points.at(-1)?.t ?? end,
                start +
                  Math.max(0, Math.min(1, (x - 36) / 528)) * windowSeconds,
              ),
            ),
          );
        }}
      >
        {[-2, -1, 0, 1, 2].map((g) => (
          <g key={g}>
            <line
              x1="36"
              x2="564"
              y1={90 - g * 32}
              y2={90 - g * 32}
              className="motion-grid"
            />
            <text x="3" y={94 - g * 32}>
              {g}g
            </text>
          </g>
        ))}
        <path d={path} className="motion-line" />
        <line x1="300" x2="300" y1="20" y2="158" className="motion-cursor" />
        <text x="36" y="178">
          {start.toFixed(1)}s
        </text>
        <text x="278" y="178">
          {cursor.toFixed(2)}s
        </text>
        <text x="528" y="178">
          {end.toFixed(1)}s
        </text>
      </svg>
    </div>
  );
}
export function VideoMotionSync({
  session,
  clip,
  file,
  stamp,
  seek,
  sessionFrom,
  sessionTo,
  onGoTo,
  onSeek,
  onConfig,
}: {
  session: Session;
  clip: Clip;
  file?: File;
  stamp: number;
  seek: number;
  sessionFrom: number;
  sessionTo: number;
  onGoTo?: (t: number) => void;
  onSeek: (t: number) => void;
  onConfig: (c: MotionConfig) => void;
}) {
  const config = clip.motion ?? defaults;
  const [motion, setMotion] = useState<CameraMotion>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [windowSeconds, setWindow] = useState(20);
  useEffect(() => {
    setMotion(undefined);
    setError("");
    setLoading(false);
    if (config.camera !== "gopro" || !file) return;
    const abort = new AbortController();
    setLoading(true);
    readGoProMotion(file, abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) setMotion(data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e.message));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [file, config.camera]);
  const gps = useMemo(
    () =>
      sessionAcceleration(session).map((p) => ({
        ...p,
        t: p.t - session.start / 1000,
      })),
    [session],
  );
  const camera = useMemo(
    () =>
      cameraAcceleration(
        motion?.acceleration ?? [],
        config.axis,
        config.invert,
        config.baseline,
      ),
    [motion, config.axis, config.invert, config.baseline],
  );
  const change = (next: Partial<MotionConfig>) =>
    onConfig({ ...config, ...next });
  return (
    <div className="motion-sync">
      <h4>Align a braking event</h4>
      <p>
        Pick the same negative acceleration dip in each graph, then press Sync
        here below. Deceleration indicates slowing down; it does not measure
        brake pedal pressure.
      </p>
      <div className="motion-controls">
        <label>
          Camera for this clip{" "}
          <select
            aria-label="Camera telemetry format"
            value={config.camera}
            onChange={(e) =>
              change({ camera: e.target.value as MotionConfig["camera"] })
            }
          >
            {cameras.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Graph window{" "}
          <select
            aria-label="Acceleration graph window"
            value={windowSeconds}
            onChange={(e) => setWindow(+e.target.value)}
          >
            {[10, 20, 60, 120].map((n) => (
              <option key={n} value={n}>
                {n} seconds
              </option>
            ))}
          </select>
        </label>
        {config.camera === "gopro" && (
          <>
            <label>
              Forward axis{" "}
              <select
                aria-label="Camera forward axis"
                value={config.axis}
                onChange={(e) => change({ axis: +e.target.value, baseline: 0 })}
              >
                {[0, 1, 2].map((n) => (
                  <option key={n} value={n}>
                    Recorded axis {n + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={config.invert}
                onChange={(e) => change({ invert: e.target.checked })}
              />
              Invert sign
            </label>
            <button
              disabled={!motion?.acceleration.length}
              onClick={() => {
                const samples = motion!.acceleration.filter(
                  (s) => Math.abs(s.t - seek) <= 0.25,
                );
                if (samples.length)
                  change({
                    baseline:
                      samples.reduce((sum, s) => sum + s.v[config.axis], 0) /
                      samples.length,
                  });
              }}
            >
              Zero at this frame
            </button>
            <button
              disabled={!config.baseline}
              onClick={() => change({ baseline: 0 })}
            >
              Reset zero
            </button>
          </>
        )}
      </div>
      {config.camera === "gopro" && (
        <p className="muted">
          Choose the axis showing forward acceleration. If braking points
          upward, invert it. Zero on a stationary or steady-speed section to
          remove the mounting offset. Camera acceleration includes gravity and
          vibration.
        </p>
      )}
      {loading && <p role="status">Reading embedded camera telemetry…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {config.camera === "gopro" && !file && (
        <p>Reload this video to read its embedded telemetry.</p>
      )}
      {motion && (
        <p role="status">
          {motion.acceleration.length.toLocaleString()} acceleration samples ·{" "}
          {motion.gyro.length.toLocaleString()} gyro samples. Gyro measures
          rotation; the graph uses the accelerometer.
        </p>
      )}
      {motion && !motion.acceleration.length && (
        <p>
          No accelerometer samples. Gyro-only data cannot supply a braking
          G-force graph.
        </p>
      )}
      <div className="motion-graphs">
        <div>
          <MotionGraph
            points={gps}
            cursor={(stamp - session.start) / 1000}
            onPick={(t) =>
              onGoTo?.(
                Math.max(
                  sessionFrom,
                  Math.min(sessionTo, session.start + t * 1000),
                ),
              )
            }
            name="Session · GPS-derived acceleration"
            windowSeconds={windowSeconds}
          />
          <label>
            Session time{" "}
            <input
              aria-label="Braking session time"
              type="range"
              min={(sessionFrom - session.start) / 1000}
              max={(sessionTo - session.start) / 1000}
              step=".01"
              value={(stamp - session.start) / 1000}
              disabled={!onGoTo}
              onChange={(e) => onGoTo?.(session.start + +e.target.value * 1000)}
            />
          </label>
          <small>
            Calculated from speed. GPS gaps over 2 seconds stay empty.
          </small>
          {!onGoTo && <small>The session cursor follows Lap A.</small>}
          {!gps.length && <p>No speed channel in this session.</p>}
        </div>
        <div>
          <MotionGraph
            points={camera}
            cursor={seek}
            onPick={onSeek}
            name="Camera · recorded acceleration"
            windowSeconds={windowSeconds}
          />
          <label>
            Video time{" "}
            <input
              aria-label="Braking video time"
              type="range"
              min="0"
              max={clip.duration}
              step=".01"
              value={seek}
              onChange={(e) => onSeek(+e.target.value)}
            />
          </label>
          {config.camera === "none" && (
            <small>
              Select GoPro to load acceleration from this clip's original MP4.
            </small>
          )}
        </div>
      </div>
    </div>
  );
}
