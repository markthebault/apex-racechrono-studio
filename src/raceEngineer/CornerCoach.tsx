import { useTurnCatalogue, engineerTurnLinks } from "../agent/turns";
import { reviewSelection } from "../agent/selection";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import type { Session } from "../model";
import { trace } from "../analysis";
import type { EngineerSettings, Evidence, Report, Snapshot } from "./contracts";
import { cornerReview, type CornerReview } from "./cornerReview";
import { metricValue, sectionName } from "./focus";
import { SectionPicture } from "./FocusCards";
const colors = ["#7dd8de", "#bcafff", "#e9c67c", "#ffad7e"];
function PassTraces({
  data,
  speedUnit,
}: {
  data: CornerReview;
  speedUnit: "km/h" | "mph";
}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(240, Math.floor(entries[0].contentRect.width))),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const plotEnd = width - 16,
    plotWidth = plotEnd - 48;
  const factor = speedUnit === "mph" ? 2.236936 : 3.6;
  return (
    <div className="corner-traces" ref={root}>
      <div className="corner-trace-heading">
        <h4>Compare the whole corner</h4>
        <span>
          Same distance · best {Math.min(3, data.eligiblePasses)} passes
          {data.passes.some((p) => !p.rank) ? " + review lap" : ""}
        </span>
      </div>
      <div className="corner-trace-legend">
        {data.passes.map((p, i) => (
          <span key={p.evidenceId} style={{ color: colors[i] }}>
            ● Lap {p.lapNumber}
            {p.rank ? ` · #${p.rank}` : ""}
            {p.isReviewLap ? " · review" : ""}
          </span>
        ))}
      </div>
      {[
        { index: 1, title: `Speed (${speedUnit})`, factor },
        {
          index: 2,
          title: "Longitudinal G · + acceleration / − deceleration",
          factor: 1,
        },
        { index: 3, title: "Lateral G · signed axis", factor: 1 },
      ].map((axis) => {
        const values = data.passes
          .flatMap((p) =>
            p.rows
              .map((r) => r[axis.index])
              .filter((v): v is number => v !== null),
          )
          .map((v) => v * axis.factor);
        if (!values.length)
          return (
            <div className="corner-trace-empty" key={axis.index}>
              {axis.title} unavailable — no valid samples.
            </div>
          );
        const min = Math.min(...values, ...(axis.index > 1 ? [0] : [])),
          max = Math.max(...values, ...(axis.index > 1 ? [0] : [])),
          pad = Math.max(axis.index === 1 ? 1 : 0.05, (max - min) * 0.12);
        const y = (v: number) =>
          22 + ((max + pad - v) / (max - min + 2 * pad)) * 94;
        return (
          <div className="corner-trace" key={axis.index}>
            <strong>{axis.title}</strong>
            <svg
              viewBox={`0 0 ${width} 150`}
              role="img"
              aria-label={`${axis.title} by distance for ${data.passes.map((p) => `lap ${p.lapNumber}`).join(", ")}`}
            >
              {[min, (min + max) / 2, max].map((v, i) => (
                <g key={i}>
                  <line
                    x1="48"
                    x2={plotEnd}
                    y1={y(v)}
                    y2={y(v)}
                    className="corner-grid"
                  />
                  <text x="40" y={y(v) + 4} textAnchor="end">
                    {v.toFixed(axis.index === 1 ? 0 : 2)}
                  </text>
                </g>
              ))}
              {data.passes.map((p, i) => {
                let pen = false;
                const d = p.rows
                  .map((r) => {
                    const v = r[axis.index],
                      distance = r[0];
                    if (v === null || distance === null) {
                      pen = false;
                      return "";
                    }
                    const move = pen ? "L" : "M";
                    pen = true;
                    return `${move}${48 + ((distance - data.corner.start) / (data.corner.end - data.corner.start)) * plotWidth},${y(v * axis.factor)}`;
                  })
                  .join(" ");
                return (
                  <path
                    key={p.evidenceId}
                    d={d}
                    stroke={colors[i]}
                    fill="none"
                    strokeWidth={p.rank === 1 ? 2.4 : 1.6}
                    strokeDasharray={!p.rank ? "5 4" : undefined}
                  />
                );
              })}
              <text x="48" y="144">
                {Math.round(data.corner.start)} m
              </text>
              <text x={plotEnd} y="144" textAnchor="end">
                {Math.round(data.corner.end)} m
              </text>
            </svg>
            {axis.index > 1 && (
              <p>
                {[
                  ...new Set(
                    data.passes.map(
                      (p) =>
                        (axis.index === 2
                          ? p.forces.longitudinal
                          : p.forces.lateral
                        ).source,
                    ),
                  ),
                ]
                  .map((s) =>
                    s === "recorded"
                      ? "Recorded mapped sensor"
                      : s === "speed-derived"
                        ? "Speed-derived estimate"
                        : s === "gps-derived"
                          ? "GPS estimate"
                          : "Unavailable",
                  )
                  .join(" / ")}{" "}
                · gaps stay blank. Compare shape and timing, not just peak G.
              </p>
            )}
          </div>
        );
      })}
      <p className="corner-force-note">
        G estimates are affected by GPS noise, slope and banking. Sensor axes
        require verified orientation and calibration. Higher G alone does not
        prove better driving or spare tyre grip.
      </p>
    </div>
  );
}
export function CornerCoach({
  snapshot,
  sessions,
  settings,
  cornerId,
  onCornerChange,
  report,
  speedUnit,
  onEvidence,
  onAnalyze,
  busy,
  canAnalyze,
  humanize,
}: {
  snapshot: Snapshot;
  sessions: Session[];
  settings: EngineerSettings;
  cornerId: string;
  onCornerChange: (id: string) => void;
  report?: Report;
  speedUnit: "km/h" | "mph";
  onEvidence: (a: Evidence, b?: Evidence) => void;
  onAnalyze: () => void;
  busy: boolean;
  canAnalyze: boolean;
  humanize: (s: string) => string;
}) {
  const turnCatalogue = useTurnCatalogue();
  const links = useMemo(
    () => engineerTurnLinks(snapshot, sessions),
    [snapshot, sessions, turnCatalogue],
  );
  const turnIds =
    links.sections.find((s) => s.cornerId === cornerId)?.turnIds ?? [];
  const data = useMemo(
    () => cornerReview(snapshot, sessions, settings, cornerId),
    [snapshot, sessions, settings, cornerId],
  );
  const [chosen, setChosen] = useState("");
  const advice = report?.cornerReviews?.find((c) => c.cornerId === cornerId);
  const reference = snapshot.evidence.find(
    (e) => e.cornerId === cornerId && e.lapId === snapshot.referenceId,
  );
  const referenceTrace = useMemo(() => {
    const s = sessions.find((s) =>
        s.laps.some((l) => l.id === snapshot.referenceId),
      ),
      l = s?.laps.find((l) => l.id === snapshot.referenceId);
    return s && l ? trace(s, l) : undefined;
  }, [snapshot.referenceId, sessions]);
  const comparisonPass =
    data.passes.find(
      (p) => p.evidenceId === chosen && p.lapId !== reference?.lapId,
    ) ?? data.passes.find((p) => p.lapId !== reference?.lapId);
  const comparison = snapshot.evidence.find(
    (e) => e.id === comparisonPass?.evidenceId,
  );
  useEffect(() => {
    reviewSelection.set({
      turnIds,
      cornerId,
      snapshotId: snapshot.id,
      referenceLapId: snapshot.referenceId,
      comparisonLapId: comparisonPass?.lapId,
    });
    return () => reviewSelection.set(null);
  }, [
    cornerId,
    snapshot.id,
    snapshot.referenceId,
    comparisonPass?.lapId,
    turnIds.join("|"),
  ]);
  const corner = data.corner,
    index = snapshot.corners.findIndex((c) => c.id === cornerId);
  const best = data.passes.find((p) => p.rank === 1),
    refTime = metricValue(reference, "elapsed", "ms"),
    bestTime = best?.metrics.elapsed.value;
  const factor = speedUnit === "mph" ? 2.236936 : 3.6;
  const sources = (axis: "longitudinal" | "lateral") =>
    [...new Set(data.passes.map((p) => p.forces[axis].source))]
      .map((s) =>
        s === "recorded"
          ? "recorded sensor"
          : s === "speed-derived"
            ? "speed estimate"
            : s === "gps-derived"
              ? "GPS path estimate"
              : "unavailable",
      )
      .join(" / ");
  const n = (e: Evidence | undefined, key: string) => {
    const v = metricValue(e, key, "m/s");
    return v === undefined ? "—" : (v * factor).toFixed(1);
  };
  return (
    <div className="corner-workspace">
      <div className="corner-browser">
        <div>
          <span className="debrief-kicker">CORNER BY CORNER</span>
          <h2>Your three best passes. One clearer next step.</h2>
          <p>
            Ranked by time through this section, across your selected comparable
            laps.
          </p>
        </div>
        <div className="corner-picker">
          <button
            disabled={index === 0 || busy}
            aria-label="Previous corner"
            onClick={() => onCornerChange(snapshot.corners[index - 1].id)}
          >
            <ArrowLeft size={16} />
          </button>
          <label>
            <span className="sr-only">Corner / section</span>
            <select
              aria-label="Corner / section"
              value={cornerId}
              disabled={busy}
              onChange={(e) => onCornerChange(e.target.value)}
            >
              {snapshot.corners.map((c) => (
                <option key={c.id} value={c.id}>
                  {sectionName(c)}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={index === snapshot.corners.length - 1 || busy}
            aria-label="Next corner"
            onClick={() => onCornerChange(snapshot.corners[index + 1].id)}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
      <article
        className="corner-card"
        aria-label={`${sectionName(corner)} corner review`}
      >
        <div className="corner-card-heading">
          <span className="focus-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div>
            <h3>
              {sectionName(corner)}
              {turnIds.length > 0 && (
                <small className="engineer-turn-labels">
                  {" "}
                  · {turnIds.join(" / ")}
                </small>
              )}
            </h3>
            <p>
              {Math.round(corner.start).toLocaleString()}–
              {Math.round(corner.end).toLocaleString()} m ·{" "}
              {data.eligiblePasses} valid pass
              {data.eligiblePasses === 1 ? "" : "es"}
            </p>
          </div>
          <span>{Math.round(corner.end - corner.start)} m</span>
        </div>
        <div className="corner-main">
          <div className="corner-visual">
            <SectionPicture
              item={{ corner, reference, comparison, combined: false }}
              referenceTrace={referenceTrace}
              speedUnit={speedUnit}
              comparisonNumber={comparisonPass?.lapNumber}
              comparisonColor={
                colors[Math.max(0, data.passes.indexOf(comparisonPass!))]
              }
            />
            <div className="corner-top-three">
              <div className="corner-top-heading">
                <strong>
                  Best {Math.min(3, data.passes.filter((p) => p.rank).length)}{" "}
                  passes through this section
                </strong>
                <span>Select a pass to compare on the map</span>
                <span>
                  G source · longitudinal: {sources("longitudinal")} · lateral:{" "}
                  {sources("lateral")}
                </span>
              </div>
              {!best && <p>No quality-eligible pass in this section yet.</p>}
              {data.passes
                .filter((p) => p.rank)
                .map((p, i) => {
                  const e = snapshot.evidence.find(
                    (e) => e.id === p.evidenceId,
                  )!;
                  const g = (key: string) => {
                    const v = metricValue(e, key, "g");
                    return v === undefined ? "—" : `${v.toFixed(2)} g`;
                  };
                  return (
                    <button
                      className={`corner-pass ${comparisonPass?.evidenceId === p.evidenceId ? "selected" : ""}`}
                      aria-pressed={comparisonPass?.evidenceId === p.evidenceId}
                      key={p.evidenceId}
                      onClick={() => setChosen(p.evidenceId)}
                      style={{ borderLeftColor: colors[i] }}
                    >
                      <span className="corner-pass-rank">#{p.rank}</span>
                      <div>
                        <strong>
                          Lap {p.lapNumber}
                          {snapshot.sessionIds.length > 1
                            ? ` · recording ${p.recording}`
                            : ""}
                          {p.isReviewLap ? " · review" : ""}
                        </strong>
                        <span>
                          Entry {n(e, "entrySpeed")} · min{" "}
                          {n(e, "minimumSpeed")} · exit {n(e, "exitSpeed")}{" "}
                          {speedUnit}
                        </span>
                        <small>
                          Decel P95 {g("brakingG95")} · lateral |G| P95{" "}
                          {g("lateralG95")}
                        </small>
                      </div>
                      <b>{(p.metrics.elapsed.value! / 1000).toFixed(3)} s</b>
                    </button>
                  );
                })}
              {data.passes.filter((p) => p.rank).length < 3 && (
                <p className="corner-short-data">
                  Only {data.passes.filter((p) => p.rank).length} valid pass
                  {data.passes.length === 1 ? "" : "es"} available. Three
                  distinct laps are needed for a full comparison.
                </p>
              )}
              <p className="corner-metric-note">
                P95 is the 95th percentile, not the absolute peak. Source and
                signed traces are below. Valid sections of a GPS-gap lap may
                still qualify.
              </p>
            </div>
          </div>
          <div className="corner-advice">
            <span className="corner-eyebrow">
              {advice
                ? `${Math.min(3, data.eligiblePasses)} TOP PASSES LINKED · AI CORNER REVIEW`
                : "YOUR CORNER COACH"}
            </span>
            <h3>
              {refTime !== undefined && typeof bestTime === "number"
                ? Math.abs(refTime - bestTime) < 0.001
                  ? "Your review lap is the quickest here"
                  : `${((refTime - bestTime) / 1000).toFixed(2)} s from your quickest pass`
                : "Compare this corner"}
            </h3>
            <p className="corner-time-note">
              Observed section difference · not a promised gain
            </p>
            {advice ? (
              <>
                <div className="corner-next-step">
                  <span>NEXT SESSION</span>
                  <p>{humanize(advice.advice)}</p>
                </div>
                <div className="corner-advice-block">
                  <span>HOW TO CHECK IT</span>
                  <p>{humanize(advice.successCheck)}</p>
                </div>
                <details className="corner-reasoning">
                  <summary>Why this advice? · compare the passes</summary>
                  <div className="corner-advice-block">
                    <span>WHAT THE PASSES SHOW</span>
                    <p>{humanize(advice.observation)}</p>
                  </div>
                  <div className="corner-advice-block">
                    <span>POSSIBLE MISTAKES · WORKING EXPLANATION</span>
                    <p>{humanize(advice.possibleMistakes)}</p>
                  </div>
                  <div>
                    <span className="corner-eyebrow">
                      WHAT REMAINS UNCERTAIN
                    </span>
                    <p>{humanize(advice.limitations)}</p>
                  </div>
                </details>
              </>
            ) : (
              <div className="corner-ai-invite">
                <Sparkles size={24} />
                <h4>Ask your engineer to compare these passes.</h4>
                <p>
                  Find where speed and G-force traces diverge, which differences
                  repeat, and what to practise next.
                </p>
                <button
                  disabled={busy || !canAnalyze || !best}
                  onClick={onAnalyze}
                >
                  Copy corner review request <Sparkles size={14} />
                </button>
                <p>
                  {!canAnalyze
                    ? "Connect your MCP agent above to request advice."
                    : "Uses the selected model and reasoning effort."}
                </p>
              </div>
            )}
            <div className="corner-advice-actions">
              <button
                disabled={!reference}
                onClick={() => reference && onEvidence(reference, comparison)}
              >
                Open this section <ArrowUpRight size={14} />
              </button>
              {advice && (
                <button disabled={busy || !canAnalyze} onClick={onAnalyze}>
                  Refresh corner advice
                </button>
              )}
            </div>
            <p className="corner-auto-note">
              Auto sections may contain several bends. Use Laps &amp; context to
              verify or edit boundaries.
            </p>
          </div>
        </div>
        <PassTraces data={data} speedUnit={speedUnit} />
      </article>
    </div>
  );
}
