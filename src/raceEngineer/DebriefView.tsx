import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Flag,
  Lightbulb,
  ListChecks,
  TrendingUp,
} from "lucide-react";
import type { Session } from "../model";
import { lapTime } from "../model";
import { trace } from "../analysis";
import type { Evidence, Report, Snapshot } from "./contracts";
import { sessionOverview } from "./debrief";
import { focusItems, sectionName } from "./focus";
import { SectionPicture } from "./FocusCards";

type Finding = NonNullable<Report["debrief"]>["findings"][number];
const findingLabels = {
  pattern: "Recurring pattern",
  progress: "Progress",
  strength: "Working well",
  inconsistency: "Consistency",
};
export function PaceChart({
  snapshot,
  sessions,
  large = false,
}: {
  snapshot: Snapshot;
  sessions: Session[];
  large?: boolean;
}) {
  const data = useMemo(
    () => sessionOverview(snapshot, sessions),
    [snapshot, sessions],
  );
  const laps = data.referenceClean;
  const width = 540,
    height = large ? 240 : 180;
  const times = laps.map((l) => l.durationMs),
    min = Math.min(...times),
    max = Math.max(...times);
  const padding = Math.max(500, (max - min) * 0.18);
  const x = (i: number) =>
    45 + (laps.length === 1 ? 0.5 : i / (laps.length - 1)) * 450;
  const y = (time: number) =>
    25 + ((max + padding - time) / (max - min + 2 * padding)) * (height - 65);
  return (
    <div className={`debrief-pace ${large ? "large" : ""}`}>
      <div className="debrief-chart-heading">
        <span>Lap progression</span>
        <span>Clean laps · same recording</span>
      </div>
      {laps.length ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Clean lap times in recording order: ${laps.map((l) => `Lap ${l.number}, ${lapTime(l.durationMs)}`).join("; ")}. Lower is quicker.`}
        >
          {[0, 0.5, 1].map((f) => (
            <line
              key={f}
              x1={35}
              x2={510}
              y1={25 + f * (height - 65)}
              y2={25 + f * (height - 65)}
              className="pace-grid"
            />
          ))}
          <path
            d={laps
              .map((l, i) => `${i ? "L" : "M"}${x(i)},${y(l.durationMs)}`)
              .join(" ")}
            className="pace-line"
          />
          {laps.map((l, i) => (
            <g key={l.id}>
              <title>{`Lap ${l.number}: ${lapTime(l.durationMs)}`}</title>
              <circle
                cx={x(i)}
                cy={y(l.durationMs)}
                r={l.id === data.best?.id ? 6 : 4}
                className={
                  l.id === data.best?.id ? "pace-point best" : "pace-point"
                }
              />
              {(laps.length <= 8 ||
                i % Math.ceil(laps.length / 6) === 0 ||
                i === laps.length - 1) && (
                <>
                  <text
                    x={x(i)}
                    y={y(l.durationMs) - 13}
                    className="pace-value"
                  >
                    {lapTime(l.durationMs)}
                  </text>
                  <text x={x(i)} y={height - 12} className="pace-label">
                    Lap {l.number}
                  </text>
                </>
              )}
            </g>
          ))}
        </svg>
      ) : (
        <div className="debrief-chart-empty">
          No clean lap-time series in this recording yet.
        </div>
      )}
      <p>
        {data.firstToLastMs === null ? (
          "Two clean laps are needed to describe progression."
        ) : (
          <>
            First → last selected clean lap:{" "}
            <strong>
              {Math.abs(data.firstToLastMs / 1000).toFixed(2)} s{" "}
              {data.firstToLastMs === 0
                ? "unchanged"
                : data.firstToLastMs < 0
                  ? "quicker"
                  : "slower"}
            </strong>
            .{" "}
            {data.trend === "mixed"
              ? "The intervening changes are mixed."
              : "This describes these laps, not a proven learning trend."}
          </>
        )}
      </p>
    </div>
  );
}
export function DebriefPreview({
  snapshot,
  sessions,
}: {
  snapshot: Snapshot;
  sessions: Session[];
}) {
  const overview = sessionOverview(snapshot, sessions);
  return (
    <div className="debrief-preview">
      <div>
        <span className="debrief-kicker">THE WHOLE SESSION</span>
        <h2>Turn your laps into a practice plan.</h2>
        <p>
          Find the patterns you repeat, understand your progress and choose what
          to work on next.
        </p>
        <ul className="debrief-promises">
          <li>
            <Lightbulb size={17} />
            Recurring mistakes & working hypotheses
          </li>
          <li>
            <TrendingUp size={17} />
            Progress, consistency & what went well
          </li>
          <li>
            <ListChecks size={17} />A focused plan with a way to check it
          </li>
        </ul>
        <div className="debrief-readiness">
          <span>{snapshot.laps.length} selected laps</span>
          <span>{overview.referenceClean.length} clean lap times</span>
          <span>{snapshot.corners.length} review sections</span>
        </div>
      </div>
      <PaceChart snapshot={snapshot} sessions={sessions} />
    </div>
  );
}
function EvidenceExample({
  finding,
  snapshot,
  sessions,
  speedUnit,
  onEvidence,
}: {
  finding: Finding;
  snapshot: Snapshot;
  sessions: Session[];
  speedUnit: "km/h" | "mph";
  onEvidence: (a: Evidence, b?: Evidence) => void;
}) {
  const [section, setSection] = useState(0);
  const items = useMemo(
    () =>
      focusItems(snapshot, {
        format: "apex-engineer-report",
        version: 1,
        snapshotId: snapshot.id,
        priorities: [
          {
            category: "telemetry-comparison",
            evidenceIds: finding.evidenceIds,
            observation: finding.observation,
            explanation: finding.interpretation,
            experiment: finding.action,
            limitations: "",
          },
        ],
      }),
    [snapshot, finding],
  );
  const item = items[section] ?? items[0];
  const referenceTrace = useMemo(() => {
    const s = sessions.find((s) =>
        s.laps.some((l) => l.id === snapshot.referenceId),
      ),
      lap = s?.laps.find((l) => l.id === snapshot.referenceId);
    return s && lap ? trace(s, lap) : undefined;
  }, [sessions, snapshot.referenceId]);
  if (!item)
    return (
      <p className="debrief-evidence-note">
        This finding cites whole-lap timing. Open Lap progression to see the
        chronological source laps.
      </p>
    );
  const rows = snapshot.evidence.filter(
    (e) =>
      e.cornerId === item.corner.id &&
      (finding.evidenceIds.includes(e.id) || e.lapId === snapshot.referenceId),
  );
  return (
    <div className="debrief-example">
      <div className="debrief-example-heading">
        <strong>An example on the track</strong>
        {items.length > 1 && (
          <select
            aria-label="Evidence section"
            value={item.corner.id}
            onChange={(e) =>
              setSection(items.findIndex((i) => i.corner.id === e.target.value))
            }
          >
            {items.map((i) => (
              <option value={i.corner.id} key={i.corner.id}>
                {sectionName(i.corner)}
              </option>
            ))}
          </select>
        )}
      </div>
      <SectionPicture
        item={item}
        referenceTrace={referenceTrace}
        speedUnit={speedUnit}
        comparisonNumber={
          snapshot.laps.find((l) => l.id === item.comparison?.lapId)?.number
        }
      />
      <p className="debrief-evidence-note">
        Map context uses the review lap. The table contains cited lap evidence
        and the review lap for comparison.
      </p>
      <div className="engineer-table">
        <table>
          <thead>
            <tr>
              <th>Lap</th>
              <th>Section time</th>
              <th>Minimum ({speedUnit})</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <th scope="row">
                  {snapshot.laps.find((l) => l.id === e.lapId)?.number}
                  {e.lapId === snapshot.referenceId ? " · review" : ""}
                </th>
                <td>
                  {e.metrics.elapsed?.value == null
                    ? "—"
                    : `${(e.metrics.elapsed.value / 1000).toFixed(2)} s`}
                </td>
                <td>
                  {e.metrics.minimumSpeed?.value == null
                    ? "—"
                    : (
                        e.metrics.minimumSpeed.value *
                        (speedUnit === "mph" ? 2.236936 : 3.6)
                      ).toFixed(1)}
                </td>
                <td>
                  {e.quality.length ? e.quality.join("; ") : "Window available"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        disabled={!item.reference}
        onClick={() =>
          item.reference && onEvidence(item.reference, item.comparison)
        }
      >
        Open telemetry <ArrowUpRight size={14} />
      </button>
    </div>
  );
}
export function DebriefView({
  report,
  snapshot,
  sessions,
  speedUnit,
  onEvidence,
  humanize,
  onQuestion,
}: {
  report: Report;
  snapshot: Snapshot;
  sessions: Session[];
  speedUnit: "km/h" | "mph";
  onEvidence: (a: Evidence, b?: Evidence) => void;
  humanize: (s: string) => string;
  onQuestion: (s: string) => void;
}) {
  const [tab, setTab] = useState<"debrief" | "progress" | "plan">("debrief");
  const [selected, setSelected] = useState(0);
  const overview = useMemo(
    () => sessionOverview(snapshot, sessions),
    [snapshot, sessions],
  );
  const findings: Finding[] =
    report.debrief?.findings ??
    report.priorities.map((p) => ({
      kind: "inconsistency",
      title: "Earlier section comparison",
      observation: p.observation,
      interpretation: p.explanation,
      action: p.experiment,
      confidence: "low",
      evidenceIds: p.evidenceIds,
      lapIds: [],
    }));
  const plan =
    report.debrief?.practicePlan ??
    report.priorities.map((p, i) => ({
      title: `Focus ${i + 1}`,
      instruction: p.experiment,
      successCheck:
        "Compare the same window under matching conditions before drawing a conclusion.",
      evidenceIds: p.evidenceIds,
    }));
  return (
    <div className="debrief-result">
      <div className="debrief-verdict">
        <span className="debrief-kicker">
          {report.debrief ? "YOUR SESSION DEBRIEF" : "EARLIER SECTION REVIEW"}
        </span>
        <h2>
          {humanize(
            report.debrief?.headline ??
              "Build a session debrief for the full picture.",
          )}
        </h2>
        <p>
          {humanize(
            report.debrief?.assessment ??
              report.summary ??
              "This earlier review covers selected sections. Run a new debrief to explore whole-session patterns and progression.",
          )}
        </p>
        <div className="debrief-stats">
          <div>
            <span>Best clean lap · review recording</span>
            <strong>
              {overview.best ? lapTime(overview.best.durationMs) : "—"}
            </strong>
          </div>
          <div>
            <span>Lap-time spread (P90–P10)</span>
            <strong>
              {overview.spreadMs === null
                ? "Needs 3 clean laps"
                : `${(overview.spreadMs / 1000).toFixed(2)} s`}
            </strong>
          </div>
          <div>
            <span>Selected laps</span>
            <strong>
              {snapshot.laps.length}{" "}
              <small>· {overview.clean.length} clean timing</small>
            </strong>
          </div>
        </div>
      </div>
      <div
        className="debrief-tabs"
        role="tablist"
        aria-label="Session debrief view"
      >
        {(
          [
            { id: "debrief", label: "What stands out" },
            { id: "progress", label: "Lap progression" },
            { id: "plan", label: "Practice plan" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            id={`debrief-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`debrief-panel-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "plan" && plan.length > 0 && <span>{plan.length}</span>}
          </button>
        ))}
      </div>
      <section
        id={`debrief-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`debrief-tab-${tab}`}
      >
        {tab === "debrief" && (
          <div className="debrief-layout">
            <div className="debrief-findings">
              <div className="debrief-section-heading">
                <h3>What the laps are telling us</h3>
                <span>
                  {findings.length} evidence-linked finding
                  {findings.length === 1 ? "" : "s"}
                </span>
              </div>
              {!findings.length && (
                <div className="debrief-empty">
                  <Lightbulb size={23} />
                  <h3>Too little evidence for a recurring pattern.</h3>
                  <p>
                    The assessment and practice plan can still help you collect
                    a more useful next session.
                  </p>
                </div>
              )}
              {findings.map((f, i) => (
                <article
                  className={`debrief-finding ${selected === i ? "active" : ""}`}
                  key={i}
                >
                  <button
                    className="debrief-finding-toggle"
                    aria-expanded={selected === i}
                    onClick={() => setSelected(selected === i ? -1 : i)}
                  >
                    <span className={`debrief-kind ${f.kind}`}>
                      {findingLabels[f.kind]}
                    </span>
                    <strong>{humanize(f.title)}</strong>
                    <ChevronDown size={17} />
                  </button>
                  {selected === i && (
                    <div className="debrief-finding-body">
                      <p>{humanize(f.observation)}</p>
                      <div className="debrief-hypothesis">
                        <span>Working interpretation</span>
                        <p>{humanize(f.interpretation)}</p>
                      </div>
                      <div className="debrief-coach-idea">
                        <Lightbulb size={17} />
                        <p>{humanize(f.action)}</p>
                      </div>
                      <div className="debrief-finding-footer">
                        <span>
                          {f.confidence === "medium"
                            ? "Moderate evidence"
                            : "Limited evidence"}{" "}
                          ·{" "}
                          {f.evidenceIds.length
                            ? `${f.evidenceIds.length} source windows`
                            : `${f.lapIds.length} source laps`}
                        </span>
                        <button
                          onClick={() =>
                            onQuestion(
                              `Help me understand "${f.title}". What could explain it, what contradicts it, and how should I test it?`,
                            )
                          }
                        >
                          Ask about this <ArrowRight size={13} />
                        </button>
                      </div>
                      <details className="debrief-evidence">
                        <summary>See the evidence</summary>
                        <EvidenceExample
                          key={`${report.snapshotId}-${i}`}
                          {...{
                            finding: f,
                            snapshot,
                            sessions,
                            speedUnit,
                            onEvidence,
                          }}
                        />
                      </details>
                    </div>
                  )}
                </article>
              ))}
            </div>
            <aside className="debrief-aside">
              <PaceChart snapshot={snapshot} sessions={sessions} />
              <div className="debrief-first-focus">
                <span className="debrief-kicker">
                  TAKE ONE THING INTO THE NEXT SESSION
                </span>
                <h3>
                  {humanize(plan[0]?.title ?? "Build a repeatable baseline")}
                </h3>
                <p>
                  {humanize(
                    plan[0]?.instruction ??
                      "Record several comparable, clean laps and note traffic and conditions.",
                  )}
                </p>
                <button onClick={() => setTab("plan")}>
                  Open your practice plan <ArrowRight size={14} />
                </button>
              </div>
              <p className="debrief-trust">
                Patterns are evidence-linked interpretations. Missing brake or
                pedal inputs remain hypotheses; measured differences are not
                promised gains.
              </p>
            </aside>
          </div>
        )}
        {tab === "progress" && (
          <div className="debrief-progress-view">
            <div>
              <h3>How your selected laps developed</h3>
              <p>
                Recording order, with flagged laps kept separate. A quicker
                final lap alone does not establish a steady learning trend.
              </p>
            </div>
            <PaceChart snapshot={snapshot} sessions={sessions} large />
            <div className="engineer-table">
              <table>
                <thead>
                  <tr>
                    <th>Recording</th>
                    <th>Lap</th>
                    <th>Lap time</th>
                    <th>Timing status</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.laps.map((l) => (
                    <tr key={l.id}>
                      <td>{l.sessionOrder + 1}</td>
                      <th scope="row">{l.number}</th>
                      <td>{lapTime(l.durationMs)}</td>
                      <td>
                        {l.cleanTiming ? (
                          <span className="debrief-clean">
                            <Check size={12} />
                            Clean timing
                          </span>
                        ) : (
                          <span className="debrief-flagged">
                            <Flag size={12} />
                            {l.issues.join("; ") ||
                              "Not eligible for this comparison"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="debrief-trust">
              The chart uses clean selected laps from the review recording.
              Other recordings and flagged laps remain visible in the table.
              These exclusions do not affect the optimal lap.
            </p>
          </div>
        )}
        {tab === "plan" && (
          <div className="debrief-plan">
            <div>
              <span className="debrief-kicker">NEXT SESSION</span>
              <h3>A small plan you can actually test</h3>
              <p>
                Work on one focus at a time. Use the success check to decide
                whether the idea helped.
              </p>
              <p className="debrief-trust">
                Repeatability does not identify the cause. Traffic can slow one
                section or an entire lap.
              </p>
            </div>
            {!plan.length && (
              <p>
                No supported practice step was returned. Ask the engineer what
                additional data would help.
              </p>
            )}
            {plan.map((p, i) => (
              <article key={i} className="debrief-plan-step">
                <span className="debrief-plan-number">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h4>{humanize(p.title)}</h4>
                  <p>{humanize(p.instruction)}</p>
                  <div className="debrief-success-check">
                    <Check size={17} />
                    <div>
                      <strong>How to check it</strong>
                      <p>{humanize(p.successCheck)}</p>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
