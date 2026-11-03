import { sha256 } from "hash-wasm";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { Session } from "../model";
import { lapTime } from "../model";
import {
  work,
  download,
  readEngineerCache,
  writeEngineerCache,
} from "../storage";
import { snapshotKey } from "./pipeline";
import {
  emptySettings,
  unknownContext,
  validateSettings,
  validateCorners,
  validateReport,
  type EngineerSettings,
  type Evidence,
  type Snapshot,
  type Report,
} from "./contracts";
import { AnalysisService } from "./service";
import { ModelPanel } from "./ModelPanel";
import { McpEngineer } from "./McpEngineer";
import {
  loadReviewScope,
  saveReviewScope,
  selectedReviewLaps,
} from "./reviewScope";
import "./engineer.css";
export function RaceEngineer({
  sessions,
  referenceId,
  turnReferenceId,
  settings,
  onChange,
  onSaveSettings,
  onEvidence,
  speedUnit,
  excluded,
}: {
  sessions: Session[];
  referenceId: string;
  turnReferenceId?: string;
  settings?: EngineerSettings;
  onChange: (s: EngineerSettings) => void;
  onSaveSettings: (s: EngineerSettings) => Promise<void>;
  onEvidence: (a: Evidence, b?: Evidence) => void;
  speedUnit: "km/h" | "mph";
  excluded: string[];
}) {
  const config = useMemo(
    () =>
      ({
        ...(settings ?? emptySettings()),
        reviewMode: settings?.reviewMode ?? "turns",
      }) as EngineerSettings,
    [settings],
  );
  const analysisConfig = useMemo(
    () => ({ ...config, reports: [] }),
    [
      config.contexts,
      config.mappings,
      config.corners,
      config.crossDay,
      config.reviewMode,
    ],
  );
  const [analysis, setAnalysis] = useState<Snapshot>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reportText, setReportText] = useState(""),
    [draft, setDraft] = useState<Report>(),
    [cornerText, setCornerText] = useState("");
  const [initialScope] = useState(() => {
    try {
      return loadReviewScope(localStorage, referenceId);
    } catch {
      return { anchorId: referenceId, referenceId, selected: {} };
    }
  });
  const [selected, setSelected] = useState<Record<string, boolean>>(
      initialScope.selected,
    ),
    [modelState, setModelState] = useState<Snapshot["modeled"]>({
      status: "unavailable",
      reasons: ["No validated boundary asset selected."],
    });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [reviewReferenceId, setReviewReferenceId] = useState(
    initialScope.referenceId,
  );
  const previousAnchor = useRef(referenceId);
  useEffect(() => {
    if (referenceId !== previousAnchor.current) {
      previousAnchor.current = referenceId;
      setReviewReferenceId(referenceId);
    }
  }, [referenceId]);
  useEffect(() => {
    try {
      saveReviewScope(localStorage, {
        anchorId: referenceId,
        referenceId: reviewReferenceId,
        selected,
      });
    } catch {
      /* Analysis still works without remembered scope preferences. */
    }
  }, [referenceId, reviewReferenceId, selected]);
  const onModel = useCallback(
    (state: Snapshot["modeled"]) => setModelState(state),
    [],
  );
  const effectiveReferenceId =
    config.reviewMode === "turns"
      ? (turnReferenceId ?? referenceId)
      : reviewReferenceId;
  const referenceSession =
      sessions.find((s) => s.laps.some((l) => l.id === effectiveReferenceId)) ??
      sessions.find((s) => s.laps.length),
    reference =
      referenceSession?.laps.find((l) => l.id === effectiveReferenceId) ??
      referenceSession?.laps[0];
  const scoped = useMemo(
    () =>
      referenceSession
        ? sessions.filter(
            (s) =>
              s.trackId === referenceSession.trackId &&
              (config.crossDay ||
                new Date(s.start).toISOString().slice(0, 10) ===
                  new Date(referenceSession.start).toISOString().slice(0, 10)),
          )
        : [],
    [sessions, referenceSession, config.crossDay],
  );
  const laps = scoped.flatMap((s) => s.laps);
  const ids = selectedReviewLaps(
    laps.map((l) => l.id),
    reference?.id,
    selected,
    excluded,
  );
  const reviewSessions = useMemo(
    () => scoped.filter((s) => s.laps.some((l) => ids.includes(l.id))),
    [scoped, ids.join("|")],
  );
  const input = useMemo(
    () => ({
      sessions: reviewSessions,
      referenceId: reference?.id ?? "",
      lapIds: ids,
      settings: analysisConfig,
    }),
    [reviewSessions, reference?.id, ids.join("|"), analysisConfig],
  );
  useEffect(() => {
    if (!input.referenceId) return;
    const control = new AbortController();
    let live = true;
    setBusy(true);
    setAnalysis(undefined);
    setDraft(undefined);
    setError("");
    (async () => {
      const key = await snapshotKey(input);
      let s = await readEngineerCache<Snapshot>(key);
      if (!s || s.id !== key) {
        s = await work<Snapshot>(
          "engineer",
          { input },
          undefined,
          control.signal,
        );
        const cached = await writeEngineerCache(
          key,
          s,
          scoped.map((s) => s.id),
        );
        if (!cached && live)
          setError(
            "Analysis is ready, but its disposable cache could not be saved.",
          );
      }
      if (live) {
        setAnalysis(s);
        setBusy(false);
      }
    })().catch((e) => {
      if (live) {
        setError(e.message);
        setBusy(false);
      }
    });
    return () => {
      live = false;
      control.abort();
    };
  }, [input]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => {
    let live = true;
    setSnapshot(undefined);
    setDraft(undefined);
    if (analysis)
      sha256(
        JSON.stringify({ analysis: analysis.id, modeled: modelState }),
      ).then((id) => {
        if (live)
          setSnapshot({
            ...analysis,
            id,
            modeled: modelState,
            evidence: analysis.evidence.map((e) => ({ ...e, snapshotId: id })),
          });
      });
    return () => {
      live = false;
    };
  }, [analysis, modelState]);
  const service = useMemo(
    () =>
      snapshot
        ? new AnalysisService(snapshot, reviewSessions, analysisConfig)
        : undefined,
    [snapshot, reviewSessions, analysisConfig],
  );
  useEffect(() => () => service?.dispose(), [service]);
  const change = (next: EngineerSettings) => {
    try {
      onChange(validateSettings(next));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const showMetric = (e: Evidence, key: string) => {
    const m = e.metrics[key];
    if (!m || m.value === null) return "Unavailable";
    const factor =
      m.unit === "m/s"
        ? speedUnit === "mph"
          ? 2.236936
          : 3.6
        : m.unit === "ms"
          ? 0.001
          : 1;
    const unit = m.unit === "m/s" ? speedUnit : m.unit === "ms" ? "s" : m.unit;
    return `${(m.value * factor).toFixed(2)} ${unit} · ${m.kind}`;
  };
  const acceptReport = () => {
    try {
      if (!snapshot) throw Error("Wait for the analysis snapshot.");
      if (new TextEncoder().encode(reportText).length > 65536)
        throw Error("Report exceeds 64 KiB.");
      setDraft(validateReport(JSON.parse(reportText), snapshot));
      setError("");
    } catch (e) {
      setDraft(undefined);
      setError((e as Error).message);
    }
  };
  return (
    <div className="engineer">
      {referenceSession && reference && (
        <div className="engineer-session-bar">
          <div>
            <strong>{referenceSession.track}</strong>
            <span>
              {new Date(referenceSession.start).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}{" "}
              · {ids.length} selected laps
            </span>
          </div>
          <button
            onClick={() => {
              setAdvancedOpen(true);
              document
                .getElementById("engineer-review-options")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Laps &amp; context
          </button>
        </div>
      )}
      {!reference && (
        <p className="notice">
          Import a session and select a timed lap. VBO recordings need a timing
          line first.
        </p>
      )}
      <div className="engineer-card engineer-mode">
        <div
          className="engineer-mode-switch"
          role="group"
          aria-label="Analysis mode"
        >
          {(["turns", "sections"] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={config.reviewMode === mode}
              className={config.reviewMode === mode ? "active" : ""}
              onClick={() => change({ ...config, reviewMode: mode })}
            >
              {mode === "turns" ? "Turn analysis" : "Section analysis"}
            </button>
          ))}
        </div>
        <p>
          {config.reviewMode === "turns"
            ? "Review T1, T2, … using the same detected turns and reference lap as Analyze."
            : "Review broader distance sections, which may combine bends. Custom section boundaries are available in advanced tools."}
        </p>
      </div>
      {busy && (
        <div className="engineer-preparing" role="status">
          Preparing session evidence…
        </div>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {reference && (
        <McpEngineer
          key={config.reviewMode}
          snapshot={
            snapshot?.reviewMode === config.reviewMode ? snapshot : undefined
          }
          sessions={reviewSessions}
          settings={config}
          onEvidence={onEvidence}
          speedUnit={speedUnit}
          onSaveReport={(report) =>
            onSaveSettings({
              ...config,
              reports: [
                ...config.reports.filter(
                  (r) => r.snapshotId !== report.snapshotId,
                ),
                report,
              ].slice(-100),
            })
          }
        />
      )}
      <details
        id="engineer-review-options"
        className="engineer-card engineer-advanced"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
      >
        <summary>Laps, context &amp; advanced tools</summary>
        {referenceSession && (
          <>
            <section className="engineer-card">
              <h3>Review scope</h3>
              <label>
                Review lap
                <select
                  aria-label="Review lap"
                  disabled={config.reviewMode === "turns"}
                  value={reference?.id}
                  onChange={(e) => setReviewReferenceId(e.target.value)}
                >
                  {scoped.flatMap((s) =>
                    s.laps.map((l) => (
                      <option key={l.id} value={l.id}>
                        Lap {l.number} · {lapTime(l.end - l.start)}
                        {scoped.length > 1
                          ? ` · ${new Date(s.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                          : ""}
                      </option>
                    )),
                  )}
                </select>
              </label>

              <p>
                Reference: {referenceSession.track}, lap {reference?.number}.
                {config.reviewMode === "turns"
                  ? "Turn analysis follows the Analyze reference lap to keep turn numbers consistent."
                  : "The review lap anchors section boundaries and map examples."}{" "}
                The debrief considers every selected lap. Only checked laps on
                this layout enter the review; the default comparison stays on
                the same UTC recording day.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={config.crossDay}
                  onChange={(e) =>
                    change({ ...config, crossDay: e.target.checked })
                  }
                />{" "}
                Explicitly allow selected sessions across recording days
              </label>
              <div className="engineer-laps">
                {laps.map((l) => (
                  <label key={l.id}>
                    <input
                      type="checkbox"
                      checked={ids.includes(l.id)}
                      disabled={l.id === reference?.id}
                      onChange={(e) =>
                        setSelected({ ...selected, [l.id]: e.target.checked })
                      }
                    />
                    Lap {l.number} · {lapTime(l.end - l.start)}{" "}
                    {l.issues.length ? `· ${l.issues.join(", ")}` : ""}
                  </label>
                ))}
              </div>
              <p>
                Interrupted, invalid or ambiguously aligned laps do not train
                coaching comparisons. Their valid sectors still feed the
                existing optimal-lap calculation.
              </p>
            </section>
            <details className="engineer-card">
              <summary>Vehicle, conditions and channel mappings</summary>
              <p>
                Record actual context. Unknown stays unknown. Different
                vehicles, setups, tires or conditions cannot be pooled silently.
              </p>
              {scoped.map((s) => {
                const c = config.contexts[s.id] ?? unknownContext();
                return (
                  <fieldset key={s.id}>
                    <legend>
                      {s.track} ·{" "}
                      {new Date(s.start)
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ")}{" "}
                      UTC
                    </legend>
                    <div className="engineer-fields">
                      {(["vehicle", "setup", "tires"] as const).map((key) => (
                        <label key={key}>
                          {key}
                          <input
                            value={c[key]}
                            onChange={(e) =>
                              change({
                                ...config,
                                contexts: {
                                  ...config.contexts,
                                  [s.id]: { ...c, [key]: e.target.value },
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        Conditions
                        <select
                          value={c.conditions}
                          onChange={(e) =>
                            change({
                              ...config,
                              contexts: {
                                ...config.contexts,
                                [s.id]: {
                                  ...c,
                                  conditions: e.target
                                    .value as typeof c.conditions,
                                },
                              },
                            })
                          }
                        >
                          <option>unknown</option>
                          <option>dry</option>
                          <option>wet</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Session notes
                      <input
                        value={c.notes}
                        onChange={(e) =>
                          change({
                            ...config,
                            contexts: {
                              ...config.contexts,
                              [s.id]: { ...c, notes: e.target.value },
                            },
                          })
                        }
                      />
                    </label>
                    <MappingEditor
                      session={s}
                      config={config}
                      onChange={change}
                    />
                  </fieldset>
                );
              })}
            </details>
            <ModelPanel
              envelope={analysis?.envelope}
              sessionIds={reviewSessions.map((s) => s.id)}
              contextKey={JSON.stringify(
                reviewSessions.map((s) => ({
                  id: s.id,
                  context: config.contexts[s.id],
                })),
              )}
              layoutId={String(referenceSession.trackId)}
              onStatus={onModel}
            />
          </>
        )}
        {snapshot && (
          <>
            <section className="engineer-card">
              <h3>Data readiness</h3>
              <p>
                {snapshot.laps.length} laps · {snapshot.corners.length} corner
                regions · demonstrated envelope: {snapshot.envelope.status} ·
                modeled reference: {snapshot.modeled.status}
              </p>
              {snapshot.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
              {Object.entries(snapshot.capabilities).map(([id, caps]) => (
                <details key={id}>
                  <summary>
                    Channels · session {snapshot.sessionIds.indexOf(id) + 1}
                  </summary>
                  <ul>
                    {caps.map((c) => (
                      <li key={c.semantic}>
                        {c.semantic}: {c.channel} ({c.unit}), {c.confidence};
                        interval {c.quality.intervalMs ?? "unknown"} ms;
                        coverage {(c.quality.coverage * 100).toFixed(0)}%.{" "}
                        {c.quality.reasons.join(". ")}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </section>
            <details className="engineer-card">
              <summary>Inspect corner evidence and edit regions</summary>
              <p>
                Minimum-speed position is not automatically the geometric apex.
                Speed-only deceleration is not recorded brake-pedal use.
              </p>
              <div className="engineer-table">
                <table>
                  <thead>
                    <tr>
                      <th>Corner / lap</th>
                      <th>Entry</th>
                      <th>Minimum</th>
                      <th>Exit</th>
                      <th>Elapsed</th>
                      <th>Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.evidence.map((e) => (
                      <tr key={e.id}>
                        <th>
                          <button onClick={() => onEvidence(e)}>
                            {
                              snapshot.corners.find((c) => c.id === e.cornerId)
                                ?.name
                            }{" "}
                            · lap{" "}
                            {
                              snapshot.laps.find((l) => l.id === e.lapId)
                                ?.number
                            }
                          </button>
                          <details>
                            <summary>Source metrics</summary>
                            <p>{e.uncertainty}</p>
                            <p>
                              Reference window:{" "}
                              {e.distance.map((x) => x.toFixed(1)).join("–")} m
                            </p>
                            <ul>
                              {Object.entries(e.metrics).map(([key, m]) => (
                                <li key={key}>
                                  {key}: {showMetric(e, key)} · {m.method} ·
                                  channel {m.channel}. {m.reasons.join("; ")}
                                </li>
                              ))}
                            </ul>
                            <code className="engineer-snapshot">{e.id}</code>
                          </details>
                        </th>
                        {[
                          "entrySpeed",
                          "minimumSpeed",
                          "exitSpeed",
                          "elapsed",
                        ].map((key) => (
                          <td key={key}>{showMetric(e, key)}</td>
                        ))}
                        <td>
                          {e.quality.join("; ") ||
                            "Valid window; GPS precision limits apply"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {config.reviewMode === "sections" && (
                <>
                  <button
                    onClick={() =>
                      setCornerText(JSON.stringify(snapshot.corners, null, 2))
                    }
                  >
                    Edit current corner JSON
                  </button>
                  <label>
                    Ordered corner regions (meters)
                    <textarea
                      value={cornerText}
                      onChange={(e) => setCornerText(e.target.value)}
                    />
                  </label>
                  <button
                    onClick={() => {
                      try {
                        const regions = validateCorners(JSON.parse(cornerText));
                        change({
                          ...config,
                          corners: {
                            ...config.corners,
                            [snapshot.referenceId]: regions,
                          },
                        });
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Apply region edits
                  </button>
                  <button
                    onClick={() => {
                      const next = { ...config.corners };
                      delete next[snapshot.referenceId];
                      change({ ...config, corners: next });
                    }}
                  >
                    Restore detected regions
                  </button>
                </>
              )}
            </details>
            <details className="engineer-card">
              <summary>Demonstrated performance envelope</summary>
              <p>
                {snapshot.envelope.method}.{" "}
                {snapshot.envelope.limitations.join(" ")}
              </p>
              <div className="engineer-table">
                <table>
                  <thead>
                    <tr>
                      <th>Speed m/s</th>
                      <th>Acceleration m/s²</th>
                      <th>Braking m/s²</th>
                      <th>Left / right m/s²</th>
                      <th>Support</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.envelope.bins.map((b) => (
                      <tr key={b.fromMps}>
                        <td>
                          {b.fromMps}–{b.toMps}
                        </td>
                        <td>{b.acceleration?.toFixed(2) ?? "Unavailable"}</td>
                        <td>{b.braking?.toFixed(2) ?? "Unavailable"}</td>
                        <td>
                          {b.lateralLeft?.toFixed(2) ?? "—"} /{" "}
                          {b.lateralRight?.toFixed(2) ?? "—"}
                        </td>
                        <td>
                          {b.events} one-second blocks / {b.laps} laps /{" "}
                          {b.confidence}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            <section className="engineer-card">
              <h3>Export analysis for your agent</h3>
              <p>
                The MCP connection above shares this review with your local
                agent. You can also download a portable analysis packet for an
                offline review.
              </p>
              <button
                onClick={() => {
                  try {
                    download(
                      "apex-review-packet.json",
                      JSON.stringify(service!.packet(), null, 2),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Download review packet
              </button>
            </section>
            <section className="engineer-card">
              <h3>Evidence-linked AI draft</h3>
              <p>
                Paste the agent’s report JSON. Validation checks version,
                category, scope and evidence references. AI prose remains
                unverified interpretation; check every explanation against the
                measurements.
              </p>
              <label>
                Report JSON
                <textarea
                  value={reportText}
                  onChange={(e) => setReportText(e.target.value)}
                />
              </label>
              <input
                type="file"
                accept=".json"
                aria-label="Import report JSON"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) {
                    if (f.size > 65536) {
                      setError("Report exceeds 64 KiB.");
                      return;
                    }
                    setReportText(await f.text());
                  }
                }}
              />
              <button onClick={acceptReport}>Validate draft</button>
              {draft && (
                <>
                  <p>
                    Structurally valid draft · AI interpretation, not verified
                    fact.
                  </p>
                  {draft.priorities.map((p, i) => (
                    <article className="engineer-priority" key={i}>
                      <h4>{p.observation}</h4>
                      <p>Possible explanation: {p.explanation}</p>
                      <p>Experiment: {p.experiment}</p>
                      <p>Limitations: {p.limitations}</p>
                      <button
                        onClick={() => {
                          const ev = p.evidenceIds.map((id) =>
                            snapshot.evidence.find((e) => e.id === id)!,
                          );
                          onEvidence(ev[0], ev[1]);
                        }}
                      >
                        Inspect source measurements
                      </button>
                    </article>
                  ))}
                  <button
                    onClick={() => {
                      change({
                        ...config,
                        reports: [
                          ...config.reports.filter(
                            (r) => r.snapshotId !== draft.snapshotId,
                          ),
                          draft,
                        ].slice(-100),
                      });
                      setDraft(undefined);
                    }}
                  >
                    Save reviewed report
                  </button>
                  <button
                    onClick={() =>
                      download(
                        "apex-engineer-report.json",
                        JSON.stringify(draft, null, 2),
                      )
                    }
                  >
                    Export draft
                  </button>
                </>
              )}
              {config.reports.length > 0 && (
                <details>
                  <summary>Saved reports ({config.reports.length})</summary>
                  {config.reports.map((r, i) => (
                    <div key={i}>
                      <p>
                        {r.snapshotId === snapshot.id
                          ? "Current snapshot"
                          : "Historical snapshot — source scope has changed"}{" "}
                        · {r.priorities.length} priorities
                      </p>
                      <button
                        onClick={() =>
                          download(
                            "apex-engineer-report.json",
                            JSON.stringify(r, null, 2),
                          )
                        }
                      >
                        Export saved report
                      </button>
                      {r.snapshotId === snapshot.id && (
                        <button
                          onClick={() => setDraft(validateReport(r, snapshot))}
                        >
                          Reopen draft
                        </button>
                      )}
                    </div>
                  ))}
                </details>
              )}
            </section>
          </>
        )}
      </details>
    </div>
  );
}
function MappingEditor({
  session,
  config,
  onChange,
}: {
  session: Session;
  config: EngineerSettings;
  onChange: (s: EngineerSettings) => void;
}) {
  const [text, setText] = useState(
      JSON.stringify(config.mappings[session.id] ?? [], null, 2),
    ),
    [error, setError] = useState("");
  return (
    <details>
      <summary>Custom channel calibration</summary>
      <p>
        Use only recorded, verified channels. Mappings preserve original data.
        Set scale, offset, physical unit, sign and confirmed=true after checking
        axis/mounting/bias. Throttle-body angle is distinct from accelerator
        pedal. Unconfirmed/unknown-unit mappings stay unavailable.
      </p>
      <p>
        Canonical semantics: speed, longitudinal, lateral, accelerator,
        throttle, brakePressure, brakePosition, brakeSwitch, rpm, wheelFL,
        wheelFR, wheelRL, wheelRR.
      </p>
      <p>
        Supported units: speed km/h, mph, m/s; acceleration g, m/s²; pressure
        bar, kPa, Pa, psi; position %; switch boolean; engine rpm.
      </p>
      <details>
        <summary>Original channels</summary>
        <ul>
          {session.channels.map((c) => (
            <li key={c.id}>
              {c.id} · {c.unit} · {c.source}
            </li>
          ))}
        </ul>
      </details>
      <label>
        Mapping JSON
        <textarea
          value={text}
          placeholder={
            '[{"channel":"verified-channel-id","semantic":"lateral","unit":"g","scale":1,"offset":0,"confirmed":true}]'
          }
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button
        onClick={() => {
          try {
            const maps = JSON.parse(text);
            const next = validateSettings({
              ...config,
              mappings: { ...config.mappings, [session.id]: maps },
            });
            onChange(next);
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Apply verified mappings
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
