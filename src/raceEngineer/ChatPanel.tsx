import { CornerCoach } from "./CornerCoach";
import { mergeReviews, cornerPasses } from "./cornerReview";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { Session } from "../model";
import { lapTime } from "../model";
import type { EngineerSettings, Evidence, Report, Snapshot } from "./contracts";
import { AnalysisService } from "./service";
import {
  completionUrl,
  engineerTurn,
  initialMessages,
  loadProvider,
  parseReview,
  providers,
  openRouterModel,
  reasoningEfforts,
  type ReasoningEffort,
  saveProvider,
  type Message,
  type ProviderConfig,
  type Usage,
} from "./provider";
import { DebriefPreview, DebriefView } from "./DebriefView";
import { validateReport } from "./contracts";
import { readState, saveState } from "../storage";
import {
  captureHistory,
  historyKey,
  restoreHistory,
  replyMessages,
  type Entry,
} from "./history";

function AnswerText({ text }: { text: string }) {
  const inline = (value: string) =>
    value
      .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.startsWith("*") && part.endsWith("*") ? (
          <em key={i}>{part.slice(1, -1)}</em>
        ) : (
          part
        ),
      );
  return text.split(/\n\s*\n/).map((paragraph, i) =>
    paragraph.trim().startsWith("|") && /^\|[\s:|\-]+\|$/m.test(paragraph) ? (
      <div className="engineer-table" key={i}>
        <table>
          <thead>
            <tr>
              {paragraph
                .split("\n")[0]
                .split("|")
                .slice(1, -1)
                .map((cell, j) => (
                  <th key={j}>{inline(cell.trim())}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {paragraph
              .split("\n")
              .slice(2)
              .filter((line) => line.trim().startsWith("|"))
              .map((line, j) => (
                <tr key={j}>
                  {line
                    .split("|")
                    .slice(1, -1)
                    .map((cell, k) => (
                      <td key={k}>{inline(cell.trim())}</td>
                    ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="engineer-answer" key={i}>
        {inline(paragraph)}
      </p>
    ),
  );
}
function storedConfig() {
  try {
    return loadProvider(localStorage);
  } catch {
    return;
  }
}
export function ChatPanel({
  snapshot,
  sessions,
  settings,
  onEvidence,
  speedUnit,
  onSaveReport,
}: {
  onSaveReport: (report: Report) => void | Promise<void>;
  snapshot?: Snapshot;
  sessions: Session[];
  settings: EngineerSettings;
  onEvidence: (a: Evidence, b?: Evidence) => void;
  speedUnit: "km/h" | "mph";
}) {
  const [view, setView] = useState<"corners" | "session">("corners");
  const [chosenCorner, setChosenCorner] = useState("");
  const activeCorner =
    snapshot?.corners.find((c) => c.id === chosenCorner) ??
    snapshot?.corners.find((c) =>
      snapshot.priorities[0]?.evidenceIds.some((id) =>
        snapshot.evidence.some((e) => e.id === id && e.cornerId === c.id),
      ),
    ) ??
    snapshot?.corners[0];
  const activePassCount =
    snapshot && activeCorner
      ? cornerPasses(snapshot, activeCorner.id).length
      : 0;
  const [initial] = useState(storedConfig);
  const [config, setConfig] = useState<ProviderConfig>(
    initial
      ? { ...initial, reasoningEffort: initial.reasoningEffort ?? "low" }
      : {
          baseUrl: providers.openrouter.baseUrl,
          model: openRouterModel,
          apiKey: "",
          reasoningEffort: "low",
        },
  );
  const [remember, setRemember] = useState(!!initial);
  const [connectionOpen, setConnectionOpen] = useState(
    !initial?.apiKey || !initial?.model,
  );
  const [provider, setProvider] = useState<keyof typeof providers>(() =>
    initial
      ? ((Object.entries(providers).find(
          ([, p]) => p.baseUrl === initial.baseUrl,
        )?.[0] as keyof typeof providers) ?? "custom")
      : "openrouter",
  );
  const [entries, setEntries] = useState<Entry[]>([]),
    [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [historyReady, setHistoryReady] = useState("");
  const [localSave, setLocalSave] = useState<
    "loading" | "empty" | "saving" | "saved" | "error"
  >("loading");
  const [retrySave, setRetrySave] = useState(0);
  const [usage, setUsage] = useState<Usage>({
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
  });
  const historyScope = useRef("");
  const history = useRef<Message[]>([]),
    active = useRef<AbortController | null>(null),
    run = useRef(0);
  // Separate consent from the external WebMCP service. Starting API chat does not
  // grant any external browser agent access, and revoking one never grants the other.
  const [service, setService] = useState<AnalysisService>();
  useEffect(() => {
    let live = true;
    setHistoryReady("");
    setLocalSave("loading");
    setEntries([]);
    history.current = [];
    setBusy(false);
    setStatus("");
    setError("");
    if (!snapshot) {
      setService(undefined);
      return;
    }
    const next = new AnalysisService(snapshot, sessions, settings);
    setService(next);
    readState(historyKey(snapshot.id))
      .then((value) => {
        if (!live) return;
        const restored = restoreHistory(value, snapshot);
        setEntries(restored?.entries ?? []);
        if (restored) {
          setView(restored.view);
          setChosenCorner(restored.cornerId ?? "");
          if (restored.entries.length) setConnectionOpen(false);
        }
        setLocalSave(restored ? "saved" : "empty");
      })
      .catch(() => {
        if (live) {
          setLocalSave("error");
          setError(
            "Saved answers could not be loaded. You can still run a new review.",
          );
        }
      })
      .finally(() => {
        if (live) setHistoryReady(snapshot.id);
      });
    return () => {
      live = false;
      run.current++;
      active.current?.abort();
      next.dispose();
    };
  }, [
    snapshot,
    sessions,
    settings.contexts,
    settings.mappings,
    settings.corners,
    settings.crossDay,
  ]);
  useEffect(() => {
    try {
      if (remember && config.apiKey && config.model) {
        completionUrl(config.baseUrl);
        saveProvider(localStorage, config);
      } else saveProvider(localStorage);
    } catch {
      setError(
        "Browser storage is unavailable. Your key is still usable for this open panel.",
      );
    }
  }, [config, remember]);

  const clear = () => {
    run.current++;
    active.current?.abort();
    service?.revoke();
    setBusy(false);
    setStatus("");
    setError("");
    history.current = [];
  };
  const forget = () => {
    clear();
    setConnectionOpen(true);
    setConfig((c) => ({ ...c, apiKey: "" }));
    setRemember(false);
    try {
      saveProvider(localStorage);
    } catch {
      setError(
        "Could not remove the saved key. Clear this site's browser storage.",
      );
    }
  };
  const edit = (next: Partial<ProviderConfig>, changeEndpoint = false) => {
    clear();
    setError("");
    if (changeEndpoint) {
      // Never automatically send an existing provider's key to a different URL.
      setRemember(false);
      try {
        saveProvider(localStorage);
      } catch {
        setError(
          "Could not clear saved credentials. Clear this site's browser storage.",
        );
      }
    }
    setConfig((c) => ({
      ...c,
      ...next,
      ...(changeEndpoint ? { apiKey: "" } : {}),
    }));
  };
  const humanize = (text: string) => {
    if (!snapshot) return text;
    const replacements: [string, string][] = [
      [snapshot.id, "current analysis"],
      ...snapshot.laps.map((lap): [string, string] => [
        lap.id,
        `Lap ${lap.number} (${lapTime(lap.durationMs)})`,
      ]),
      ...snapshot.evidence.map((e): [string, string] => [
        e.id,
        snapshot.corners.find((c) => c.id === e.cornerId)?.name ??
          "corner measurement",
      ]),
      ...snapshot.sessionIds.map((id): [string, string] => [
        id,
        sessions.find((s) => s.id === id)?.track ?? "selected session",
      ]),
      ...snapshot.corners.map((c): [string, string] => [c.id, c.name]),
    ];
    // Longest first prevents a session ID replacing part of a lap/evidence ID.
    for (const [id, label] of replacements.sort(
      (a, b) => b[0].length - a[0].length,
    ))
      text = text.split(id).join(label);
    return text;
  };
  const ask = async (prompt: string, fresh = false, cornerId?: string) => {
    if (
      busy ||
      !prompt.trim() ||
      !service ||
      !snapshot ||
      historyReady !== snapshot.id
    )
      return;
    const generation = ++run.current,
      control = new AbortController();
    active.current = control;
    const timeout = setTimeout(
      () => control.abort(),
      config.reasoningEffort === "high"
        ? 300_000
        : config.reasoningEffort === "medium"
          ? 240_000
          : 180_000,
    );
    setBusy(true);
    setError("");
    setStatus(
      cornerId
        ? "Comparing the top passes, speed and G-force traces…"
        : "Reading the whole session…",
    );
    try {
      completionUrl(config.baseUrl);
      if (!config.apiKey.trim() || !config.model.trim())
        throw Error("Enter your API key and model name first.");
      setConnectionOpen(false);
      service.grant();
      const targetCorner =
        cornerId ?? (view === "corners" ? activeCorner?.id : undefined);
      const scope = targetCorner ?? "session";
      const previous =
        !fresh && history.current.length && historyScope.current === scope
          ? [...history.current]
          : [
              ...(await initialMessages(
                service,
                snapshot,
                speedUnit,
                targetCorner,
              )),
              ...(!fresh && latestReport
                ? [
                    {
                      role: "assistant" as const,
                      content: JSON.stringify(latestReport),
                    },
                  ]
                : []),
              ...(!fresh ? replyMessages(entries, scope) : []),
            ];
      if (!cornerId && targetCorner)
        previous.push({
          role: "system",
          content:
            "This is a follow-up question about the currently selected corner, not a request to generate a new cornerReviews report. Answer in concise plain text using this corner's supplied three-pass/G evidence and the saved report if applicable. Be explicit about uncertain causes.",
        });
      const result = await engineerTurn({
        config,
        messages: [...previous, { role: "user", content: prompt }],
        service,
        snapshotId: snapshot.id,
        ...(fresh
          ? {
              review: {
                snapshot,
                ...(targetCorner ? { cornerId: targetCorner } : {}),
              },
            }
          : {}),
        signal: control.signal,
        onTool: () => setStatus("Investigating patterns and comparison laps…"),
        onVerify: () =>
          setStatus("Checking the answer against source measurements…"),
        onUsage: (next) =>
          setUsage((total) => ({
            requests: total.requests + next.requests,
            promptTokens: total.promptTokens + next.promptTokens,
            completionTokens: total.completionTokens + next.completionTokens,
            costUsd:
              total.costUsd !== null && next.costUsd !== null
                ? total.costUsd + next.costUsd
                : null,
          })),
      });
      if (run.current !== generation) return;
      const parsed = parseReview(result.text, service);
      if (
        cornerId &&
        !parsed?.cornerReviews?.some((c) => c.cornerId === cornerId)
      )
        throw Error(
          "The provider did not return advice for this corner. Try again with this corner selected.",
        );
      const report = parsed ? mergeReviews(latestReport, parsed) : undefined;
      history.current = result.messages;
      historyScope.current = scope;
      setEntries((e) => [
        ...e,
        {
          question: prompt,
          scope,
          ...(report ? { report } : { text: result.text }),
        },
      ]);
      setQuestion("");
      setStatus(report ? "Debrief ready" : "Reply ready");
      if (report) {
        try {
          await onSaveReport(report);
        } catch {
          if (run.current === generation)
            setError(
              "Your answer is shown below, but could not be added to the project backup.",
            );
        }
      }
    } catch (e) {
      if (run.current === generation) {
        setError(
          control.signal.aborted
            ? "Review stopped or timed out. You can try again."
            : (e as Error).message,
        );
        setStatus("");
      }
    } finally {
      clearTimeout(timeout);
      if (run.current === generation) {
        service.revoke();
        setBusy(false);
        active.current = null;
      }
    }
  };
  const savedReport = useMemo(() => {
    if (!snapshot) return;
    const saved = settings.reports
      .filter((r) => r.snapshotId === snapshot.id)
      .at(-1);
    if (!saved) return;
    try {
      return validateReport(saved, snapshot);
    } catch {
      return;
    }
  }, [settings.reports, snapshot]);
  const latestReport =
    entries.filter((e) => e.report).at(-1)?.report ?? savedReport;
  useEffect(() => {
    if (
      !snapshot ||
      historyReady !== snapshot.id ||
      (!latestReport && !entries.length)
    )
      return;
    let live = true;
    setLocalSave("saving");
    // Writes use the captured snapshot key, so an old in-flight write cannot
    // overwrite answers for a changed selection. IDB serializes these writes.
    Promise.resolve()
      .then(() =>
        captureHistory(snapshot, entries, latestReport, view, activeCorner?.id),
      )
      .then((value) => saveState(historyKey(snapshot.id), value))
      .then(() => {
        if (live) setLocalSave("saved");
      })
      .catch(() => {
        if (live) setLocalSave("error");
      });
    return () => {
      live = false;
    };
  }, [
    snapshot,
    historyReady,
    entries,
    latestReport,
    view,
    activeCorner?.id,
    retrySave,
  ]);
  const startDebrief = () =>
    ask(
      "Review my whole session in simple English. What did I do well? What possible mistakes repeat across laps or sections? Did I improve as the session went on? Check examples that disagree with each idea. Explain what the data shows and what is still unknown. Give me a short practice plan and explain how to check whether it helps. Return the session-debrief JSON report.",
      true,
    );
  const analyzeCorner = () =>
    activeCorner &&
    activePassCount > 0 &&
    ask(
      `Review ${activeCorner.name} (${activeCorner.id}) in simple English. Compare ALL available top-three passes and the review lap. Use speed, forward/backward G and sideways G. Explain where the passes differ and how reliable those measurements are. What possible mistake repeats, and which examples disagree? Give me one clear thing to practise and explain how to check whether it helps. Keep facts separate from possible causes. Return the cornerReviews report.`,
      true,
      activeCorner.id,
    );
  const prepareQuestion = (text: string) => {
    setQuestion(text);
    document.getElementById("engineer-question")?.focus();
  };
  const conversations = entries.filter((e) => e.text);
  return (
    <section
      className="engineer-chat debrief-paper"
      aria-label="AI race engineer"
    >
      <div className="debrief-header">
        <div>
          <span className="debrief-kicker">RACE ENGINEER</span>
          <h1>
            Race engineer<span>.</span>
          </h1>
          <p>Your best passes, corner by corner. A clearer next step.</p>
        </div>
        <div className="debrief-header-actions">
          <button
            aria-expanded={connectionOpen}
            aria-controls="engineer-ai-settings"
            onClick={() => setConnectionOpen((open) => !open)}
          >
            <Settings2 size={15} />
            Connection
            <span
              className={`debrief-connection-dot ${config.apiKey ? "ready" : ""}`}
            />
          </button>
          {localSave === "saved" && (
            <span className="engineer-local-save" role="status">
              <Check size={15} /> Saved on this device
            </span>
          )}
          {localSave === "saving" && (
            <span className="engineer-local-save" role="status">
              <LoaderCircle size={15} className="engineer-spinner" /> Saving
              answers…
            </span>
          )}
        </div>
      </div>
      <div
        className="debrief-connect"
        id="engineer-ai-settings"
        hidden={!connectionOpen}
      >
        <div className="debrief-connect-copy">
          <strong>
            {config.apiKey
              ? "Your AI connection"
              : "Connect once. Then explore your session."}
          </strong>
          <p>
            Selected analysis goes to your provider. The track pictures are
            drawn locally.
          </p>
          <span>
            {provider === "openrouter"
              ? "OpenRouter"
              : providers[provider].label}{" "}
            · {config.model || "Choose a model"}
          </span>
        </div>
        <div className="debrief-connect-form">
          <label>
            API key
            <input
              type="password"
              value={config.apiKey}
              disabled={busy}
              onChange={(e) => edit({ apiKey: e.target.value })}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your provider API key"
            />
          </label>
          <div className="debrief-key-options">
            <label>
              <input
                type="checkbox"
                checked={remember}
                disabled={busy}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember on this browser
            </label>
            {config.apiKey && (
              <button disabled={busy} onClick={forget}>
                Forget key
              </button>
            )}
          </div>
          <details className="debrief-provider-options">
            <summary>Provider &amp; model</summary>
            <div className="engineer-fields">
              <label>
                Provider
                <select
                  value={provider}
                  disabled={busy}
                  onChange={(e) => {
                    const p = e.target.value as keyof typeof providers;
                    setProvider(p);
                    edit(
                      {
                        baseUrl: providers[p].baseUrl,
                        model: p === "openrouter" ? openRouterModel : "",
                      },
                      true,
                    );
                  }}
                >
                  {Object.entries(providers).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Model name
                <input
                  value={config.model}
                  disabled={busy}
                  onChange={(e) => edit({ model: e.target.value })}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              {provider === "custom" && (
                <label>
                  API base URL
                  <input
                    type="url"
                    value={config.baseUrl}
                    disabled={busy}
                    onChange={(e) => edit({ baseUrl: e.target.value }, true)}
                  />
                </label>
              )}
            </div>
          </details>
          <p className="debrief-key-note">
            {remember
              ? "Key saved in plaintext browser storage, readable by scripts on this site."
              : "Key stays in memory until you leave this screen."}
          </p>
        </div>
      </div>
      <div className="engineer-view-picker" aria-label="Engineer workspace">
        <button
          aria-pressed={view === "corners"}
          onClick={() => setView("corners")}
        >
          Corners
        </button>
        <button
          aria-pressed={view === "session"}
          onClick={() => setView("session")}
        >
          Session debrief
        </button>
      </div>
      <div className="debrief-run-bar">
        <label className="debrief-reasoning">
          Reasoning effort
          <select
            aria-label="Reasoning effort"
            value={config.reasoningEffort ?? "low"}
            disabled={busy}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                reasoningEffort: e.target.value as ReasoningEffort,
              }))
            }
          >
            {reasoningEfforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort[0].toUpperCase() + effort.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <span className="debrief-effort-note">
          {config.reasoningEffort === "low"
            ? "Faster, lighter review"
            : "More thinking · more time and cost"}
        </span>
        <button
          className="primary debrief-run"
          disabled={
            busy ||
            !service ||
            !snapshot ||
            historyReady !== snapshot.id ||
            !config.apiKey.trim() ||
            !config.model.trim() ||
            !config.baseUrl.trim() ||
            (view === "corners" && (!activeCorner || !activePassCount))
          }
          onClick={() =>
            void (view === "corners" ? analyzeCorner() : startDebrief())
          }
        >
          {busy ? (
            <LoaderCircle size={16} className="engineer-spinner" />
          ) : (
            <Sparkles size={16} />
          )}
          {busy
            ? "Analyzing your session…"
            : view === "corners"
              ? "Analyze this corner"
              : latestReport?.debrief
                ? "Update debrief"
                : "Analyze my session"}
        </button>
        {busy && (
          <button
            onClick={() => {
              active.current?.abort();
              service?.revoke();
            }}
          >
            Stop
          </button>
        )}
      </div>
      <p className="engineer-history-note">
        Answers save automatically on this device. Changing sessions, laps or
        analysis settings starts a new review.
      </p>
      {localSave === "error" && (
        <p className="notice" role="alert">
          Browser history is unavailable. Keep this page open to retain your
          replies.{" "}
          <button onClick={() => setRetrySave((n) => n + 1)}>
            Retry saving
          </button>
        </p>
      )}
      {(busy || status || usage.requests > 0) && (
        <div className="debrief-status">
          <span role="status" aria-live="polite">
            {busy && <LoaderCircle size={13} className="engineer-spinner" />}
            {status}
          </span>
          {usage.requests > 0 && (
            <span>
              {usage.costUsd === null
                ? "Cost unavailable"
                : `$${usage.costUsd.toFixed(4)}`}{" "}
              · {usage.requests} requests
            </span>
          )}
        </div>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {snapshot ? (
        view === "corners" ? (
          activeCorner ? (
            <CornerCoach
              key={activeCorner.id}
              snapshot={snapshot}
              sessions={sessions}
              settings={settings}
              cornerId={activeCorner.id}
              onCornerChange={setChosenCorner}
              report={latestReport}
              speedUnit={speedUnit}
              onEvidence={onEvidence}
              onAnalyze={() => void analyzeCorner()}
              busy={busy || historyReady !== snapshot.id}
              canAnalyze={!!config.apiKey.trim() && !!config.model.trim()}
              humanize={humanize}
            />
          ) : (
            <div className="debrief-empty">
              No corner sections yet. Verify your section boundaries in Laps
              &amp; context, or open Session debrief for the whole-lap view.
            </div>
          )
        ) : latestReport &&
          (latestReport.debrief || latestReport.priorities.length > 0) ? (
          <DebriefView
            key={snapshot.id}
            report={latestReport}
            snapshot={snapshot}
            sessions={sessions}
            speedUnit={speedUnit}
            onEvidence={onEvidence}
            humanize={humanize}
            onQuestion={prepareQuestion}
          />
        ) : (
          <DebriefPreview snapshot={snapshot} sessions={sessions} />
        )
      ) : (
        <div className="debrief-empty">Preparing session evidence…</div>
      )}
      {(latestReport || conversations.length > 0) && (
        <div className="debrief-followup">
          <div>
            <span className="debrief-kicker">TALK IT THROUGH</span>
            <h3>Your engineer, one question away.</h3>
            <p>
              Explore a finding, compare explanations or refine your practice
              plan.
            </p>
          </div>
          <div className="debrief-quick-questions">
            {[
              "Which pattern should I work on first, and why?",
              "What improved across my laps, and what contradicts that?",
            ].map((q) => (
              <button
                key={q}
                disabled={busy}
                onClick={() => prepareQuestion(q)}
              >
                {q}
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
          {conversations.map((entry, i) => (
            <details
              className="engineer-conversation"
              key={i}
              open={i === conversations.length - 1}
            >
              <summary>{entry.question}</summary>
              <AnswerText text={humanize(entry.text!)} />
            </details>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <label className="engineer-followup">
              <span className="sr-only">Ask about your driving</span>
              <textarea
                id="engineer-question"
                value={question}
                maxLength={4000}
                disabled={busy}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What would you like to understand?"
                rows={2}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !question.trim() || !config.apiKey}
            >
              Ask engineer <ArrowUpRight size={15} />
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
