import { useMemo, useState } from "react";
import { Flag } from "lucide-react";
import type { Trace } from "./model";
import { lapTime } from "./model";
import { interpolate, type Opportunity } from "./analysis";

const W = 640,
  H = 400,
  PAD = 44,
  // Gains under this many ms are noise, not opportunities.
  MIN_GAIN = 50;
const seconds = (ms: number) => (ms / 1000).toFixed(2);

export function Opportunities({
  shape,
  opps,
  bestMs,
  optMs,
  scopeLabel,
  days,
  day,
  onDay,
  labelOf,
}: {
  shape: Trace;
  opps: Opportunity[];
  bestMs: number;
  optMs: number;
  scopeLabel: string;
  days?: { key: string; label: string }[];
  day?: string;
  onDay?: (key: string) => void;
  labelOf: (t: Trace) => string;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const list = useMemo(
    () =>
      opps.filter((o) => o.gain >= MIN_GAIN).sort((a, b) => b.gain - a.gain),
    [opps],
  );
  const maxGain = list[0]?.gain || 1;
  // Equirectangular fit of the lap into the drawing area.
  const project = useMemo(() => {
    const lats: number[] = [],
      lons: number[] = [];
    for (let i = 0; i < shape.lat.length; i += 4)
      if (Number.isFinite(shape.lat[i]) && Number.isFinite(shape.lon[i])) {
        lats.push(shape.lat[i]);
        lons.push(shape.lon[i]);
      }
    const k = Math.cos(
        (lats.reduce((n, v) => n + v, 0) / lats.length / 180) * Math.PI,
      ),
      xs = lons.map((v) => v * k),
      ys = lats.map((v) => -v);
    const x0 = Math.min(...xs),
      y0 = Math.min(...ys);
    const scale = Math.min(
      (W - 2 * PAD) / (Math.max(...xs) - x0 || 1),
      (H - 2 * PAD) / (Math.max(...ys) - y0 || 1),
    );
    const ox = (W - scale * (Math.max(...xs) - x0)) / 2,
      oy = (H - scale * (Math.max(...ys) - y0)) / 2;
    return (lat: number, lon: number): [number, number] => [
      ox + (lon * k - x0) * scale,
      oy + (-lat - y0) * scale,
    ];
  }, [shape]);
  const at = (d: number) =>
    project(
      interpolate(shape.distance, shape.lat, d),
      interpolate(shape.distance, shape.lon, d),
    );
  const path = (from: number, to: number) => {
    const pts: string[] = [];
    const add = ([x, y]: [number, number]) =>
      Number.isFinite(x) && pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
    add(at(from));
    for (let i = 0; i < shape.distance.length; i += 6)
      if (shape.distance[i] > from && shape.distance[i] < to)
        add(project(shape.lat[i], shape.lon[i]));
    add(at(to));
    return "M" + pts.join(" L");
  };
  const whole = useMemo(() => path(0, shape.length), [shape, project]);
  const [sx, sy] = at(0),
    [nx, ny] = at(Math.min(40, shape.length)),
    len = Math.hypot(nx - sx, ny - sy) || 1,
    px = -(ny - sy) / len,
    py = (nx - sx) / len;
  const step = (dir: 1 | -1) => {
    if (!list.length) return;
    const at = list.findIndex((o) => o.index === focus);
    const next = at < 0 ? (dir > 0 ? 0 : list.length - 1) : at + dir;
    setFocus(next < 0 || next >= list.length ? null : list[next].index);
  };
  const total = Math.max(0, bestMs - optMs);
  return (
    <section className="panel opps">
      <div className="opps-head">
        <h2>
          <Flag size={18} /> Opportunities
        </h2>
        <span className="muted">Against the fastest lap of {scopeLabel}</span>
        {days && days.length > 1 && (
          <select
            aria-label="Day for opportunities"
            value={day}
            onChange={(e) => onDay?.(e.target.value)}
          >
            {days.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="opps-numbers">
        <div>
          <strong>
            -{seconds(total)} <em>s</em>
          </strong>
          <span>Opportunities</span>
        </div>
        <div>
          <strong>{lapTime(optMs)}</strong>
          <span>OPT</span>
        </div>
        <div>
          <strong>{lapTime(bestMs)}</strong>
          <span>BEST</span>
        </div>
      </div>
      <div className="opps-map">
        <button aria-label="Previous opportunity" onClick={() => step(-1)}>
          ‹
        </button>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Track map with time to gain per sector"
        >
          <path d={whole} className="opps-track" />
          {list.map((o) => (
            <path
              key={o.index}
              d={path(o.start, o.end)}
              className="opps-gain"
              style={{
                opacity:
                  focus === null
                    ? 0.5 + (0.5 * o.gain) / maxGain
                    : focus === o.index
                      ? 1
                      : 0.18,
              }}
            />
          ))}
          <g>
            <line
              x1={sx - px * 16}
              y1={sy - py * 16}
              x2={sx + px * 16}
              y2={sy + py * 16}
              stroke="#fff"
              strokeWidth="6"
            />
            <line
              x1={sx - px * 16}
              y1={sy - py * 16}
              x2={sx + px * 16}
              y2={sy + py * 16}
              stroke="#111"
              strokeWidth="6"
              strokeDasharray="4 4"
            />
            <text x={sx} y={sy - 24} textAnchor="middle" className="opps-flag">
              START / FINISH
            </text>
          </g>
          {list.map((o) => {
            const [x, y] = at((o.start + o.end) / 2),
              text = "-" + seconds(o.gain),
              w = text.length * 7.5 + 14;
            return (
              <g
                key={o.index}
                transform={`translate(${x} ${y})`}
                className="opps-badge"
                style={{
                  opacity: focus === null || focus === o.index ? 1 : 0.35,
                  cursor: "pointer",
                }}
                onClick={() => setFocus(focus === o.index ? null : o.index)}
              >
                <rect x={-w / 2} y={-11} width={w} height={22} rx={6} />
                <text textAnchor="middle" y={4}>
                  {text}
                </text>
              </g>
            );
          })}
        </svg>
        <button aria-label="Next opportunity" onClick={() => step(1)}>
          ›
        </button>
      </div>
      {list.length === 0 ? (
        <p className="muted">
          No sector is worth more than 0.05 s. The fastest lap already holds the
          best sectors.
        </p>
      ) : (
        <ol className="opps-list">
          {list.slice(0, 8).map((o) => (
            <li key={o.index}>
              <button
                className={focus === o.index ? "active" : ""}
                onClick={() => setFocus(focus === o.index ? null : o.index)}
              >
                <b>S{o.index + 1}</b>
                <span>
                  {(o.start / 1000).toFixed(1)}–{(o.end / 1000).toFixed(1)} km
                </span>
                <em>-{seconds(o.gain)} s</em>
                <small>{labelOf(o.source)}</small>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
