import { useEffect, useRef } from "react";
import type { Session } from "./model";
import { lapTime } from "./model";
import { lapConsistency, formatGap, type Summary } from "./summary";

export function SessionSummary({
  session,
  summary,
  optMs,
  optSource,
  speedUnit,
  onClose,
  onLap,
}: {
  session: Session;
  summary: Summary;
  optMs: number;
  optSource: "app" | "racechrono";
  speedUnit: "km/h" | "mph";
  onClose: () => void;
  onLap: (lapId: string) => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const speed =
    speedUnit === "mph" ? summary.topSpeed / 1.609344 : summary.topSpeed;
  const when = new Date(session.start);
  const consistency = lapConsistency(session);
  const width = (bar: number) => `${(42 + 58 * bar).toFixed(0)}%`;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="summary-card"
        role="dialog"
        aria-modal="true"
        aria-label={`Lap times, ${session.track}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={close}
          className="summary-close"
          aria-label="Close summary"
          onClick={onClose}
        >
          ×
        </button>
        <div className="summary-track">{session.track}</div>
        <div className="summary-stats">
          <div>
            <strong>
              {Number.isFinite(speed) ? Math.round(speed) : "-"}
              <em>{speedUnit}</em>
            </strong>
            <span>TOP SPEED</span>
          </div>
          <div>
            <strong>{session.laps.length}</strong>
            <span>LAPS</span>
          </div>
          <div>
            <strong>{lapTime(summary.bestMs)}</strong>
            <span>BEST</span>
          </div>
        </div>
        <span className="summary-date">
          {when.toLocaleDateString("en-GB")}{" "}
          {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        <div className="lap-consistency">
          <h3>Lap consistency</h3>
          {consistency.spread === undefined ? (
            <p>
              Need at least two complete, uninterrupted laps.{" "}
              {consistency.count} available.
            </p>
          ) : (
            <>
              <div>
                <span>
                  <strong>{(consistency.spread / 1000).toFixed(2)} s</strong>{" "}
                  fastest to slowest
                </span>
                <span>
                  <strong>
                    {(consistency.deviation! / 1000).toFixed(2)} s
                  </strong>{" "}
                  standard deviation
                </span>
                <span>
                  <strong>{lapTime(consistency.median!)}</strong> median lap
                </span>
              </div>
              <p>
                {consistency.count} complete, uninterrupted laps
                {consistency.excluded > 0
                  ? ` · ${consistency.excluded} flagged ${consistency.excluded === 1 ? "lap" : "laps"} omitted`
                  : ""}
                . Smaller spread means more repeatable times.
              </p>
            </>
          )}
        </div>
        <div className="summary-table">
          <div className="summary-row summary-labels">
            <span>Lap</span>
            <span />
            <span>Time</span>
          </div>
          {summary.rows.map((r) => (
            <button
              key={r.id}
              className={`summary-row${r.best ? " best" : ""}`}
              title="Analyze this lap"
              onClick={() => onLap(r.id)}
            >
              <span className="lapno">{String(r.number).padStart(2, "0")}</span>
              <span className="bar">
                <i
                  className={r.best ? "fill best" : "fill"}
                  style={{ width: r.best ? "100%" : width(r.bar) }}
                >
                  {!r.best && formatGap(r.delta)}
                </i>
              </span>
              <span className="time">
                {lapTime(r.ms)}
                {(r.interrupted || r.gap) && (
                  <small>{r.interrupted ? "Interrupted" : "GPS gap"}</small>
                )}
              </span>
            </button>
          ))}
          {Number.isFinite(optMs) && (
            <div className="summary-row opt">
              <span className="lapno">opt</span>
              <span className="bar">
                <i className="fill opt" style={{ width: "100%" }}>
                  {formatGap(optMs - summary.bestMs)}
                </i>
              </span>
              <span className="time">
                {lapTime(optMs)}
                {optSource === "racechrono" && <small>RaceChrono</small>}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
