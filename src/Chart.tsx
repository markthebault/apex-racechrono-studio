import {
  gestureAxis,
  panTimeline,
  type ChartInteraction,
} from "./mobileAnalysis";
import { useEffect, useRef, useState } from "react";
import type { Trace, ChartConfig, Comparison } from "./model";
import { definitions } from "./model";
import { interpolate, atDistance, elapsedDelta, zoomRange } from "./analysis";
import { hoverBus } from "./hover";
import { formatClockTenths } from "./wallclock";
export function Chart({
  config,
  colors,
  speedUnit,
  joins,
  a,
  others,
  cursor,
  range,
  onCursor,
  onRange,
  onZoom,
  length,
  onChange,
  onRemove,
  onUp,
  compact = false,
  interaction = "range",
}: {
  compact?: boolean;
  interaction?: ChartInteraction;
  config: ChartConfig;
  colors: [string, string];
  speedUnit: string;
  joins: number[];
  a: Trace;
  others: Comparison[];
  cursor: number;
  range: [number, number];
  onCursor: (n: number) => void;
  onRange: (r: [number, number]) => void;
  // Wheel zoom: changes the window only, so playback and the cursor carry on.
  onZoom: (r: [number, number]) => void;
  // Length of the lap in metres, the limit of zooming out.
  length: number;
  onChange: (c: ChartConfig) => void;
  onRemove: () => void;
  onUp: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    start = useRef<{
      d: number;
      x: number;
      y: number;
      range: [number, number];
      cursor: number;
      axis: string;
    } | null>(null);
  // Hover only previews values; a click moves the shared cursor.
  const [hover, setHover] = useState<number | null>(null),
    [selection, setSelection] = useState<[number, number] | null>(null);
  const [sharedHover, setSharedHover] = useState<number | null>(null);
  useEffect(() => hoverBus.subscribe(setSharedHover), []);
  // Cumulative time delta of A against each other lap sits behind the speed traces.
  const showDelta =
    others.length > 0 &&
    config.channels.some((id) => id === "speed" || id === "obdSpeed");
  const fmtGap = (ms: number) =>
    Number.isFinite(ms)
      ? (ms >= 0 ? "+" : "−") + (Math.abs(ms) / 1000).toFixed(3)
      : "—";
  const draw = () => {
    const c = canvas.current;
    if (!c) return;
    const w = c.clientWidth,
      h = c.clientHeight,
      dpr = devicePixelRatio;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    const pad = 48;
    ctx.font = "10px Inter, system-ui";
    ctx.lineWidth = 1;
    const gridLines = compact ? 2 : 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = 12 + ((h - 35) * i) / gridLines;
      ctx.strokeStyle = "#35434b";
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - 15, y);
      ctx.stroke();
    }
    const ticks = Math.max(1, Math.min(5, Math.floor((w - pad - 15) / 70)));
    for (let i = 0; i <= ticks; i++) {
      const x = pad + ((w - pad - 15) * i) / ticks;
      ctx.fillStyle = "#b6c1c5";
      ctx.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
      ctx.fillText(
        ((range[0] + ((range[1] - range[0]) * i) / ticks) / 1000).toFixed(1) +
          " km",
        x,
        h - 4,
      );
    }
    ctx.textAlign = "left";
    if (showDelta) {
      const width = w - pad - 15,
        cols = Math.max(2, Math.floor(width / 2));
      const xs: number[] = [];
      for (let i = 0; i <= cols; i++) xs.push(pad + (width * i) / cols);
      const series = others.map((o) =>
        xs.map(
          (_, i) =>
            elapsedDelta(
              a,
              o.trace,
              range[0] + ((range[1] - range[0]) * i) / cols,
            ) / 1000,
        ),
      );
      let peak = 0;
      for (const vs of series)
        for (const v of vs)
          if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
      const M = Math.max(1, Math.ceil(peak)),
        top = 12,
        bottom = h - 23;
      const yOf = (v: number) => top + ((M - v) / (2 * M)) * (bottom - top);
      const y0 = yOf(0);
      // Runs of finite samples, so an outage does not draw a false line.
      const runsOf = (vs: number[]) => {
        const runs: number[][] = [];
        let run: number[] = [];
        vs.forEach((v, i) => {
          if (Number.isFinite(v)) run.push(i);
          else if (run.length) (runs.push(run), (run = []));
        });
        if (run.length) runs.push(run);
        return runs;
      };
      ctx.save();
      // The fill shows who is ahead of the first comparison lap.
      const runs = runsOf(series[0]);
      for (const [above, color] of [
        [true, others[0].color],
        [false, colors[0]],
      ] as const) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(pad, above ? top : y0, width, above ? y0 - top : bottom - y0);
        ctx.clip();
        ctx.fillStyle = color + "38";
        for (const r of runs) {
          ctx.beginPath();
          ctx.moveTo(xs[r[0]], y0);
          for (const i of r) ctx.lineTo(xs[i], yOf(series[0][i]));
          ctx.lineTo(xs[r[r.length - 1]], y0);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.strokeStyle = "#5d6b75";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(pad, y0);
      ctx.lineTo(w - 15, y0);
      ctx.stroke();
      ctx.setLineDash([]);
      series.forEach((vs, k) => {
        ctx.strokeStyle = k ? others[k].color + "cc" : "#c9d4dacc";
        ctx.lineWidth = 1.2;
        for (const r of runsOf(vs)) {
          ctx.beginPath();
          r.forEach((i, n) =>
            n ? ctx.lineTo(xs[i], yOf(vs[i])) : ctx.moveTo(xs[i], yOf(vs[i])),
          );
          ctx.stroke();
        }
      });
      ctx.fillStyle = "#b6c1c5";
      ctx.textAlign = "right";
      ctx.fillText("+" + M + " s", w - 18, top + 9);
      ctx.fillText("0", w - 18, y0 - 3);
      ctx.fillText("−" + M + " s", w - 18, bottom - 3);
      ctx.restore();
    }
    for (const d of joins) {
      if (d < range[0] || d > range[1]) continue;
      const x = pad + ((d - range[0]) / (range[1] - range[0])) * (w - pad - 15);
      ctx.strokeStyle = "#ff885555";
      ctx.setLineDash([2, 5]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - 20);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    config.channels.forEach((id, channelIndex) => {
      const av = a.channels[id];
      let min = Infinity,
        max = -Infinity;
      for (const arr of [av, ...others.map((o) => o.trace.channels[id])])
        if (arr)
          for (let i = 0; i < arr.length; i++)
            if (Number.isFinite(arr[i])) {
              min = Math.min(min, arr[i]);
              max = Math.max(max, arr[i]);
            }
      if (!Number.isFinite(min)) return;
      if (id !== "altitude" && min > 0) min = 0;
      max = Math.max(max, min + 1);
      if (channelIndex === 0) {
        ctx.fillStyle = "#b6c1c5";
        for (let i = 0; i <= gridLines; i++)
          ctx.fillText(
            (max - ((max - min) * i) / gridLines).toFixed(0),
            5,
            16 + ((h - 35) * i) / gridLines,
          );
      }
      const lines: [Trace, Float64Array | undefined, string][] = [
        ...others
          .map(
            (o) =>
              [o.trace, o.trace.channels[id], o.color] as [
                Trace,
                Float64Array | undefined,
                string,
              ],
          )
          .reverse(),
        [a, av, colors[0]],
      ];
      for (const [t, arr, color] of lines) {
        if (!t || !arr) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.setLineDash(channelIndex ? [4, 4] : []);
        ctx.beginPath();
        let active = false,
          lastPixel = -1;
        for (let i = 0; i < arr.length; i++) {
          const d = t.distance[i];
          if (d < range[0] || d > range[1]) continue;
          const x =
            pad + ((d - range[0]) / (range[1] - range[0])) * (w - pad - 15);
          if (
            !Number.isFinite(arr[i]) ||
            (i > 0 && t.times[i] - t.times[i - 1] > 2000)
          ) {
            active = false;
            continue;
          }
          if (Math.floor(x) === lastPixel && i % 3 !== 0) continue;
          lastPixel = Math.floor(x);
          const y = 12 + ((max - arr[i]) / (max - min)) * (h - 35);
          if (active) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          active = true;
        }
        ctx.stroke();
      }
    });
    ctx.setLineDash([]);
    const x =
      pad + ((cursor - range[0]) / (range[1] - range[0])) * (w - pad - 15);
    ctx.strokeStyle = "#e6edf2";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h - 20);
    ctx.stroke();
    for (const o of others) {
      if (Math.abs(o.cursor - cursor) <= 1) continue;
      const bx =
        pad + ((o.cursor - range[0]) / (range[1] - range[0])) * (w - pad - 15);
      ctx.strokeStyle = o.color;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, h - 20);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const px = (d: number) =>
      pad + ((d - range[0]) / (range[1] - range[0])) * (w - pad - 15);
    if (selection) {
      ctx.fillStyle = "#e6edf218";
      const x0 = px(Math.min(...selection)),
        x1 = px(Math.max(...selection));
      ctx.fillRect(x0, 0, x1 - x0, h - 20);
    }
    if (
      sharedHover !== null &&
      sharedHover >= range[0] &&
      sharedHover <= range[1] &&
      !selection
    ) {
      const hx = px(sharedHover);
      ctx.strokeStyle = "#e6edf2";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, h - 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (hover !== null && !selection && !compact) {
      const hx = px(hover);
      const value = (t: Trace | undefined, id: string) => {
        if (!t) return "";
        const v = atDistance(t, t.channels[id] || [], hover);
        return Number.isFinite(v) ? v.toFixed(id === "rpm" ? 0 : 1) : "—";
      };
      const traces = [a, ...others.map((o) => o.trace)];
      // Clock time of each lap at this point, from the GPS timestamps in the recording.
      // The theoretical lap is stitched together from several laps and has no clock time.
      const rows = [
        {
          label: "Time of day",
          values: traces.map((t) =>
            t.sessionId === "optimal"
              ? "—"
              : formatClockTenths(interpolate(t.distance, t.times, hover)),
          ),
        },
        ...config.channels.map((id) => ({
          label:
            compact && id === "acceleration"
              ? "Longitudinal G · calc"
              : definitions[id]?.name || id,
          values: traces.map((t) => value(t, id)),
        })),
      ];
      const head =
        (hover / 1000).toFixed(3) +
        " km" +
        others
          .map((o) => {
            const gap = elapsedDelta(a, o.trace, hover);
            return Number.isFinite(gap)
              ? `   Δ${others.length > 1 ? " " + o.tag : ""} ${fmtGap(gap)} s`
              : "";
          })
          .join("");
      ctx.font = "11px Inter, system-ui";
      const wl = Math.max(...rows.map((r) => ctx.measureText(r.label).width));
      const cols = [a, ...others.map((o) => o.trace)].map((_, k) =>
        Math.max(...rows.map((r) => ctx.measureText(r.values[k]).width)),
      );
      const bw = Math.max(
        ctx.measureText(head).width,
        wl + cols.reduce((n, cw) => n + 12 + cw, 0),
      );
      const boxW = bw + 16,
        boxH = 14 * (rows.length + 1) + 12;
      const bx0 = hx + 10 + boxW > w - 4 ? hx - 10 - boxW : hx + 10;
      ctx.fillStyle = "#101a20ee";
      ctx.strokeStyle = "#3e4c53";
      ctx.beginPath();
      ctx.roundRect(bx0, 4, boxW, boxH, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#c5d1d8";
      ctx.fillText(head, bx0 + 8, 20);
      rows.forEach((r, i) => {
        const y = 20 + 14 * (i + 1);
        ctx.fillStyle = "#b6c1c5";
        ctx.fillText(r.label, bx0 + 8, y);
        let x = bx0 + 8 + wl + 12;
        r.values.forEach((v, k) => {
          ctx.fillStyle = k ? others[k - 1].color : colors[0];
          ctx.fillText(v, x, y);
          x += cols[k] + 12;
        });
      });
    }
  };
  useEffect(() => () => hoverBus.set(null), []);
  // Wheel over a chart zooms around the pointer; with Shift it pans. It has to be a native
  // listener because the page would otherwise scroll as well.
  const view = useRef({ range, length, onZoom });
  view.current = { range, length, onZoom };
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const { range: r, length: len, onZoom: zoom } = view.current;
      e.preventDefault();
      const box = c.getBoundingClientRect();
      const px = Math.max(
        r[0],
        Math.min(
          r[1],
          r[0] +
            ((e.clientX - box.left - 48) / (box.width - 63)) * (r[1] - r[0]),
        ),
      );
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1) + e.deltaX;
      if (e.shiftKey) {
        const shift = (delta / 400) * (r[1] - r[0]);
        const start = Math.max(0, Math.min(len - (r[1] - r[0]), r[0] + shift));
        const next: [number, number] = [start, start + (r[1] - r[0])];
        view.current.range = next;
        zoom(next);
      } else {
        const next = zoomRange(r, px, Math.exp(delta * 0.0015), len);
        // A trackpad sends bursts of events before the next render, so chain them.
        view.current.range = next;
        zoom(next);
      }
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    draw();
    const o = new ResizeObserver(draw);
    o.observe(canvas.current!);
    return () => o.disconnect();
  }, [
    a,
    others,
    cursor,
    range,
    config,
    colors,
    joins,
    hover,
    sharedHover,
    selection,
    compact,
  ]);
  const position = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return Math.max(
      range[0],
      Math.min(
        range[1],
        range[0] +
          ((e.clientX - r.left - 48) / (r.width - 63)) * (range[1] - range[0]),
      ),
    );
  };
  return (
    <section className={`chart-panel ${compact ? "chart-compact" : ""}`}>
      <div className="chart-title">
        <div>
          {config.channels.map((id, index) => (
            <span key={id}>
              {compact && id === "acceleration"
                ? "Longitudinal G · calc"
                : definitions[id]?.name || id}{" "}
              <small>
                {id === "speed" || id === "obdSpeed"
                  ? speedUnit
                  : definitions[id]?.unit || "raw"}
              </small>
              <b style={{ color: colors[0] }}>
                {Number.isFinite(atDistance(a, a.channels[id] || [], cursor))
                  ? atDistance(a, a.channels[id], cursor).toFixed(
                      id === "rpm" ? 0 : 1,
                    )
                  : "—"}
              </b>
              {index > 0 && (
                <button
                  className="remove-overlay"
                  title={`Remove ${id} overlay`}
                  onClick={() =>
                    onChange({
                      ...config,
                      channels: config.channels.filter((c) => c !== id),
                    })
                  }
                >
                  ×
                </button>
              )}
              {others.map((o) => (
                <b key={o.tag} style={{ color: o.color }}>
                  {Number.isFinite(
                    atDistance(o.trace, o.trace.channels[id] || [], o.cursor),
                  )
                    ? atDistance(
                        o.trace,
                        o.trace.channels[id],
                        o.cursor,
                      ).toFixed(id === "rpm" ? 0 : 1)
                    : "—"}
                </b>
              ))}
            </span>
          ))}
          {showDelta &&
            !compact &&
            others.map((o) => (
              <span key={o.tag}>
                Δ time A−{o.tag} <small>s</small>
                <b
                  style={{
                    color:
                      elapsedDelta(a, o.trace, cursor) > 0
                        ? o.color
                        : colors[0],
                  }}
                >
                  {fmtGap(elapsedDelta(a, o.trace, cursor))}
                </b>
              </span>
            ))}
        </div>
        <div className="chart-actions">
          <select
            aria-label="Overlay channel"
            value=""
            onChange={(e) =>
              onChange({
                ...config,
                channels: [...config.channels, e.target.value],
              })
            }
          >
            <option value="">+ Overlay</option>
            {Object.keys(a.channels)
              .filter((k) => !config.channels.includes(k))
              .map((k) => (
                <option key={k} value={k}>
                  {definitions[k]?.name || k}
                </option>
              ))}
          </select>
          <button onClick={onUp} title="Move chart up">
            ↑
          </button>
          <button onClick={onRemove} title="Remove chart">
            ×
          </button>
        </div>
      </div>
      {showDelta && !compact && (
        <small className="muted">
          Background: cumulative time delta, A minus each other lap. Above the
          dashed zero line A is behind; below it A is ahead. The fill follows
          the first comparison lap.
        </small>
      )}
      {config.channels.length > 1 && !compact && (
        <small className="muted">
          Overlaid channels use independent scales. Dashed lines show additional
          channels.
        </small>
      )}
      <canvas
        aria-label={`${config.channels.join(", ")} telemetry chart. ${compact ? `One finger scrubs; two fingers pan or pinch to zoom. Swipe vertically with one finger to scroll channels.` : "Hover to preview values, click to move the cursor, drag to zoom."}`}
        tabIndex={0}
        ref={canvas}
        style={{ height: config.height }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            e.stopPropagation();
            onCursor(
              Math.max(
                0,
                Math.min(
                  length,
                  cursor +
                    (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 50 : 10),
                ),
              ),
            );
          }
        }}
        onPointerDown={(e) => {
          // Compact touch input belongs to the stack's native multi-touch handler.
          if (compact && e.pointerType === "touch") return;
          if (e.button !== 0 || !e.isPrimary) return;
          const d = position(e);
          start.current = {
            d,
            x: e.clientX,
            y: e.clientY,
            range: [...range],
            cursor,
            axis:
              compact && e.pointerType === "touch" ? "pending" : "horizontal",
          };
          if (!compact) {
            setHover(d);
            hoverBus.set(d);
          }
          if (!compact || e.pointerType !== "touch") {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* Pointer already ended. */
            }
          }
        }}
        onPointerMove={(e) => {
          if (compact && e.pointerType === "touch") return;
          const d = position(e),
            from = start.current;
          if (!from) {
            if (!compact) {
              setHover(d);
              hoverBus.set(d);
            }
            return;
          }
          if (from.axis === "pending")
            from.axis = gestureAxis(e.clientX - from.x, e.clientY - from.y);
          if (from.axis === "scroll" || from.axis === "pending") return;
          if (compact) {
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* Pointer cancelled. */
            }
            hoverBus.set(null);
            if (interaction === "scrub") {
              onCursor(d);
              return;
            }
            if (interaction === "pan") {
              const next = panTimeline(
                from.range,
                e.clientX - from.x,
                canvas.current!.clientWidth - 63,
                length,
              );
              onZoom(next);
              onCursor(
                Math.max(
                  next[0],
                  Math.min(next[1], from.cursor + next[0] - from.range[0]),
                ),
              );
              return;
            }
          }
          setHover(d);
          const dragging = Math.abs(e.clientX - from.x) >= (compact ? 8 : 4);
          if (dragging) setSelection([from.d, d]);
          hoverBus.set(dragging ? null : d);
        }}
        onPointerLeave={() => {
          if (!start.current) {
            setHover(null);
            hoverBus.set(null);
          }
        }}
        onPointerCancel={() => {
          start.current = null;
          setSelection(null);
          setHover(null);
          hoverBus.set(null);
        }}
        onPointerUp={(e) => {
          if (compact && e.pointerType === "touch") return;
          const from = start.current,
            end = position(e);
          start.current = null;
          setSelection(null);
          setHover(null);
          hoverBus.set(compact ? null : end);
          if (!from || from.axis === "scroll") return;
          if (compact && interaction !== "range") {
            if (interaction === "scrub" || Math.abs(e.clientX - from.x) < 8)
              onCursor(end);
          } else if (Math.abs(e.clientX - from.x) < (compact ? 8 : 4))
            onCursor(end);
          else if (Math.abs(end - from.d) > 50)
            onRange([Math.min(from.d, end), Math.max(from.d, end)]);
        }}
      />
      <input
        className="chart-height"
        aria-label="Chart height"
        type="range"
        min="90"
        max="320"
        value={config.height}
        onChange={(e) => onChange({ ...config, height: +e.target.value })}
      />
    </section>
  );
}
