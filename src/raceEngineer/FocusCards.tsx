import { useMemo, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Crosshair, MapPin } from "lucide-react";
import { trace } from "../analysis";
import type { Session, Trace } from "../model";
import type { Evidence, Report, Snapshot } from "./contracts";
import {
  focusCue,
  focusItems,
  metricValue,
  sectionName,
  speedPoints,
  trackPicture,
  type FocusItem,
} from "./focus";

export function SectionPicture({
  item,
  referenceTrace,
  speedUnit,
  comparisonNumber,
  comparisonColor,
}: {
  item: FocusItem;
  referenceTrace?: Trace;
  speedUnit: "km/h" | "mph";
  comparisonNumber?: number;
  comparisonColor?: string;
}) {
  const minimum = metricValue(item.reference, "minimumPosition", "m");
  const geometry = useMemo(
    () => referenceTrace && trackPicture(referenceTrace, item.corner, minimum),
    [referenceTrace, item.corner, minimum],
  );
  const cue = focusCue(item);
  const factor = speedUnit === "mph" ? 2.236936 : 3.6;
  const speed = (e: Evidence | undefined, key: string) => {
    const value = metricValue(e, key, "m/s");
    return value === undefined ? "—" : (value * factor).toFixed(1);
  };
  return (
    <figure
      className="focus-map"
      style={
        comparisonColor
          ? ({ "--review-cyan": comparisonColor } as CSSProperties)
          : undefined
      }
    >
      <div className="focus-map-cue">
        <Crosshair size={15} aria-hidden="true" />
        {cue
          ? `Compare ${cue.label.toLowerCase()} speed`
          : "Inspect this section"}
      </div>
      <div className="focus-map-legend">
        <span className="reference">
          Lap {referenceTrace?.lap.number} · reference
        </span>
        {item.comparison && (
          <span className="comparison">
            Lap {comparisonNumber} · comparison
          </span>
        )}
      </div>
      {geometry ? (
        <>
          <svg
            viewBox="0 0 560 335"
            role="img"
            aria-label={`${sectionName(item.corner)} track image. Orange shows the reviewed GPS path. Markers identify entry, minimum-speed position and exit; these are not braking or apex instructions.`}
          >
            <path d={geometry.context} className="focus-path-context" />
            <path d={geometry.section} className="focus-path-section" />
            {speedPoints.map((point, i) => {
              const position = geometry.markers[point.at],
                x = 92 + i * 188;
              const selected = cue?.at === point.at;
              return (
                <g key={point.key}>
                  {selected && (
                    <rect
                      x={x - 79}
                      y={6}
                      width={158}
                      height={70}
                      rx={10}
                      className="focus-map-label-bg"
                    />
                  )}
                  <text x={x} y={25} className="focus-map-label">
                    {point.label === "Minimum" ? "Slowest sample" : point.label}
                  </text>
                  <text x={x} y={46} className="focus-map-value">
                    {speed(item.reference, point.key)}
                    <tspan className="focus-map-comparison">
                      {item.comparison
                        ? ` / ${speed(item.comparison, point.key)}`
                        : ""}
                    </tspan>
                  </text>
                  <text x={x} y={63} className="focus-map-unit">
                    {speedUnit}
                  </text>
                  {position && (
                    <>
                      <path
                        d={`M${x},80 L${position.x},${position.y}`}
                        className="focus-map-leader"
                      />
                      <circle
                        cx={position.x}
                        cy={position.y}
                        r={selected ? 13 : 10}
                        className={
                          selected ? "focus-pin selected" : "focus-pin"
                        }
                      />
                      <text
                        x={position.x}
                        y={position.y + 4}
                        className="focus-pin-number"
                      >
                        {i + 1}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
          <div
            className="focus-map-inset"
            aria-label="Location on the full recorded lap"
          >
            <svg viewBox="450 5 150 85" aria-hidden="true">
              <path d={geometry.whole} />
              <path d={geometry.location} className="focus-inset-section" />
            </svg>
            <span>On the lap</span>
          </div>
        </>
      ) : (
        <div className="focus-map-unavailable">
          <MapPin size={26} />
          <span>No continuous GPS path available for this section.</span>
        </div>
      )}
      <figcaption>
        Reference GPS · 1 entry · 3 exit ·{" "}
        {geometry?.markers.minimum
          ? "2 slowest sample"
          : "slowest-sample position unavailable"}
      </figcaption>
    </figure>
  );
}

function FocusCard({
  item,
  index,
  snapshot,
  referenceTrace,
  speedUnit,
  onEvidence,
  humanize,
}: {
  item: FocusItem;
  index: number;
  snapshot: Snapshot;
  referenceTrace?: Trace;
  speedUnit: "km/h" | "mph";
  onEvidence: (a: Evidence, b?: Evidence) => void;
  humanize: (s: string) => string;
}) {
  const a = metricValue(item.reference, "elapsed", "ms"),
    b = metricValue(item.comparison, "elapsed", "ms");
  const delta = a === undefined || b === undefined ? undefined : (a - b) / 1000;
  const lap = (e?: Evidence) => snapshot.laps.find((l) => l.id === e?.lapId);
  const reference = lap(item.reference),
    comparison = lap(item.comparison);
  const value = (e: Evidence, key: string) => {
    const unit = key === "elapsed" ? "ms" : "m/s",
      v = metricValue(e, key, unit);
    return v === undefined
      ? "—"
      : (
          v * (unit === "ms" ? 0.001 : speedUnit === "mph" ? 2.236936 : 3.6)
        ).toFixed(unit === "ms" ? 2 : 1);
  };
  const evidence = snapshot.evidence.filter(
    (e) => e.cornerId === item.corner.id,
  );
  const action =
    item.advice?.experiment ??
    "Compare the speed traces in this section. Repeat it under similar conditions before changing your approach.";
  return (
    <article
      className="focus-card"
      aria-label={`Focus ${index + 1}: ${sectionName(item.corner)}`}
    >
      <header className="focus-card-heading">
        <span className="focus-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div>
          <h3>{sectionName(item.corner)}</h3>
          <span>
            {Math.round(item.corner.start).toLocaleString()}–
            {Math.round(item.corner.end).toLocaleString()} m ·{" "}
            {item.advice ? "AI review" : "Measured comparison"}
          </span>
        </div>
        <span className="focus-length">
          {Math.round(item.corner.end - item.corner.start)} m
        </span>
      </header>
      <div className="focus-card-body">
        <SectionPicture
          item={item}
          referenceTrace={referenceTrace}
          speedUnit={speedUnit}
          comparisonNumber={comparison?.number}
        />
        <div className="focus-guidance">
          <div className="focus-time">
            <span className="focus-small-label">OBSERVED DIFFERENCE</span>
            <h4>
              {delta === undefined
                ? "Reference lap"
                : `${Math.abs(delta).toFixed(2)} s ${delta >= 0 ? "longer" : "quicker"}`}
            </h4>
            <p>
              {a === undefined
                ? "Window time unavailable"
                : `Lap ${reference?.number}: ${(a / 1000).toFixed(2)} s`}
              {b !== undefined && (
                <>
                  {" "}
                  <span aria-hidden="true">/</span> Lap {comparison?.number}:{" "}
                  {(b / 1000).toFixed(2)} s
                </>
              )}
            </p>
          </div>
          <div className="focus-action">
            <span className="focus-small-label">
              <ArrowRight size={14} aria-hidden="true" />{" "}
              {item.combined ? "NEXT STEP · COMBINED REVIEW" : "NEXT STEP"}
            </span>
            <p>{humanize(action)}</p>
          </div>
          <div className="focus-card-actions">
            <button
              onClick={() =>
                item.reference && onEvidence(item.reference, item.comparison)
              }
              disabled={!item.reference}
            >
              Open this section <ArrowUpRight size={15} aria-hidden="true" />
            </button>
            <details>
              <summary>Why this focus?</summary>
              {item.combined && (
                <p>
                  This advice originally covered several windows. This card’s
                  map and measurements cover only{" "}
                  {sectionName(item.corner).toLowerCase()}.
                </p>
              )}
              <p>
                <strong>Observation:</strong>{" "}
                {humanize(
                  item.advice?.observation ?? item.measured?.observation ?? "",
                )}
              </p>
              {item.advice && (
                <p>
                  <strong>Possible explanation:</strong>{" "}
                  {humanize(item.advice.explanation)}
                </p>
              )}
              <p>
                <strong>Limits:</strong>{" "}
                {humanize(
                  item.advice?.limitations ??
                    item.measured?.limitations.join(" ") ??
                    "GPS-based window comparison; cause unknown.",
                )}
              </p>
              <div className="engineer-table">
                <table>
                  <caption>Source measurements · {speedUnit}</caption>
                  <thead>
                    <tr>
                      <th>Lap</th>
                      <th>Time (s)</th>
                      <th>Entry</th>
                      <th>Minimum</th>
                      <th>Exit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidence.map((e) => (
                      <tr key={e.id}>
                        <th scope="row">
                          {lap(e)?.number}
                          {e.lapId === snapshot.referenceId
                            ? " · reference"
                            : ""}
                        </th>
                        <td>{value(e, "elapsed")}</td>
                        <td>{value(e, "entrySpeed")}</td>
                        <td>{value(e, "minimumSpeed")}</td>
                        <td>{value(e, "exitSpeed")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                All selected laps for this section are shown, including contrary
                evidence. Missing values are —.{" "}
                {item.reference?.quality.join(" ")}
              </p>
            </details>
          </div>
        </div>
      </div>
    </article>
  );
}

export function FocusCards({
  snapshot,
  sessions,
  report,
  speedUnit,
  onEvidence,
  humanize,
}: {
  snapshot: Snapshot;
  sessions: Session[];
  report?: Report;
  speedUnit: "km/h" | "mph";
  onEvidence: (a: Evidence, b?: Evidence) => void;
  humanize: (s: string) => string;
}) {
  const items = useMemo(() => focusItems(snapshot, report), [snapshot, report]);
  const referenceTrace = useMemo(() => {
    const session = sessions.find((s) =>
      s.laps.some((l) => l.id === snapshot.referenceId),
    );
    const lap = session?.laps.find((l) => l.id === snapshot.referenceId);
    return session && lap ? trace(session, lap) : undefined;
  }, [sessions, snapshot.referenceId]);
  if (!items.length)
    return (
      <div className="engineer-no-focus">
        <MapPin size={24} aria-hidden="true" />
        <h3>No supported focus yet</h3>
        <p>
          {report
            ? "This review did not find a change supported strongly enough to recommend."
            : "Choose comparable laps, or add a turn in Review settings, to find a useful comparison."}
        </p>
      </div>
    );
  return (
    <div className="engineer-focus-list">
      {items.map((item, index) => (
        <FocusCard
          key={item.corner.id}
          {...{
            item,
            index,
            snapshot,
            referenceTrace,
            speedUnit,
            onEvidence,
            humanize,
          }}
        />
      ))}
    </div>
  );
}
