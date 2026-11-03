import { useMemo } from "react";
import { trace } from "../analysis";
import type { Session } from "../model";
import { detectTurns } from "../turns";
import type { Snapshot } from "./contracts";
import { sectionName, trackOverview } from "./focus";

export function TrackPicker({
  snapshot,
  sessions,
  selectedId,
  onSelect,
}: {
  snapshot: Snapshot;
  sessions: Session[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const turns = snapshot.reviewMode === "turns";
  const geometry = useMemo(() => {
    const session = sessions.find((s) =>
      s.laps.some((l) => l.id === snapshot.referenceId),
    );
    const lap = session?.laps.find((l) => l.id === snapshot.referenceId);
    if (!session || !lap) return;
    const ref = trace(session, lap);
    const positions = turns
      ? Object.fromEntries(detectTurns(ref).map((t) => [t.id, t.position]))
      : {};
    return trackOverview(ref, snapshot.corners, positions);
  }, [snapshot, sessions, turns]);
  const selected = snapshot.corners.find((c) => c.id === selectedId);
  if (!geometry)
    return (
      <p>
        Track overview unavailable for this GPS trace. Use the review picker
        below.
      </p>
    );
  return (
    <section
      className="engineer-track-picker"
      aria-label="Track review selector"
    >
      <div className="engineer-track-heading">
        <div>
          <h2>Choose a {turns ? "turn" : "section"} on the track</h2>
          <p>
            Click a highlighted stretch or its label to review the passes below.
          </p>
        </div>
        <span aria-live="polite">
          Selected: {selected && sectionName(selected)}
        </span>
      </div>
      <svg
        viewBox="0 0 900 380"
        role="group"
        aria-label={turns ? "Track turns" : "Track sections"}
      >
        <path d={geometry.whole} className="engineer-track-base" />
        {geometry.regions.map((r) => (
          <g key={r.id} className="engineer-track-segment" aria-hidden="true">
            <path
              d={r.path}
              className={`engineer-track-region ${selectedId === r.id ? "selected" : ""}`}
            />
            <path
              d={r.path}
              className="engineer-track-hit"
              data-region-id={r.id}
              onClick={() => onSelect(r.id)}
            />
          </g>
        ))}
        {geometry.regions.map(
          (r, i) =>
            r.anchor &&
            r.label && (
              <g
                key={r.id}
                className={`engineer-track-label ${selectedId === r.id ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                aria-label={`Select ${sectionName(snapshot.corners[i])}`}
                aria-pressed={selectedId === r.id}
                onClick={() => onSelect(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(r.id);
                  }
                }}
              >
                <title>
                  {sectionName(snapshot.corners[i])} ·{" "}
                  {Math.round(snapshot.corners[i].start)}–
                  {Math.round(snapshot.corners[i].end)} m
                </title>
                <line
                  x1={r.anchor.x}
                  y1={r.anchor.y}
                  x2={r.label.x}
                  y2={r.label.y}
                />
                <circle cx={r.anchor.x} cy={r.anchor.y} r="4" />
                <rect
                  x={r.label.x - 24}
                  y={r.label.y - 14}
                  width="48"
                  height="28"
                  rx="8"
                />
                <text x={r.label.x} y={r.label.y + 5}>
                  {turns ? snapshot.corners[i].name : `S${i + 1}`}
                </text>
              </g>
            ),
        )}
      </svg>
      <p className="engineer-track-caption">
        Full reference lap · {snapshot.corners.length}{" "}
        {turns ? "detected turns" : "review sections"} · GPS geometry
      </p>
    </section>
  );
}
