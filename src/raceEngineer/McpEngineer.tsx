import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import type { Session } from "../model";
import {
  validateReport,
  type EngineerSettings,
  type Evidence,
  type Report,
  type Snapshot,
} from "./contracts";
import { CornerCoach } from "./CornerCoach";
import { DebriefPreview, DebriefView } from "./DebriefView";
import { installEngineer, requestEngineer } from "../agent/engineer";
import { openAgentConnection, useAgentConnection } from "../agent/connection";
import { cornerPasses } from "./cornerReview";

export function McpEngineer({
  snapshot,
  sessions,
  settings,
  onEvidence,
  speedUnit,
  onSaveReport,
}: {
  snapshot?: Snapshot;
  sessions: Session[];
  settings: EngineerSettings;
  onEvidence: (a: Evidence, b?: Evidence) => void;
  speedUnit: "km/h" | "mph";
  onSaveReport: (report: Report) => void | Promise<void>;
}) {
  const [view, setView] = useState<"corners" | "session">("corners");
  const [chosenCorner, setChosenCorner] = useState(""),
    [question, setQuestion] = useState(""),
    [prompt, setPrompt] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const connection = useAgentConnection();
  const save = useRef(onSaveReport);
  save.current = onSaveReport;
  const activeCorner =
    snapshot?.corners.find((c) => c.id === chosenCorner) ??
    snapshot?.corners[0];
  const report = useMemo(() => {
    const r = settings.reports
      .filter((r) => r.snapshotId === snapshot?.id)
      .at(-1);
    if (!r || !snapshot) return;
    try {
      return validateReport(r, snapshot);
    } catch {
      return;
    }
  }, [settings.reports, snapshot]);
  useEffect(() => {
    setPrompt("");
    setStatus("");
    setError("");
    if (!snapshot) return;
    // Report updates must not replace the current request or reset the snapshot.
    return installEngineer(snapshot, sessions, settings, async (r) => {
      await save.current(r);
      setStatus("Advice saved on this device");
      setPrompt("");
    });
  }, [snapshot, sessions]);
  useEffect(() => {
    try {
      localStorage.removeItem("apex-engineer-provider-v1");
    } catch {
      /* Stored provider credentials are no longer used. */
    }
  }, []);
  const humanize = (text: string) =>
    text.replace(/\be([1-9]\d*)\b/g, (match, n) => {
      const e = snapshot?.evidence[Number(n) - 1];
      const c = snapshot?.corners.find((c) => c.id === e?.cornerId);
      const l = snapshot?.laps.find((l) => l.id === e?.lapId);
      return e && c && l ? `${c.name}, lap ${l.number}` : match;
    });
  const ask = async (text: string, cornerId?: string) => {
    setError("");
    try {
      if (connection !== "connected")
        throw Error("Connect your MCP agent first.");
      const request = requestEngineer(text, cornerId);
      const copy = `Read apex_engineer_context for request ${request.id}. ${text} Use its exact snapshot ID, inspect the evidence, and send your report back to Apex with apex_engineer_report. Keep observations separate from hypotheses.`;
      setPrompt(copy);
      setStatus("Request ready. Send it in your agent’s chat.");
      try {
        await navigator.clipboard.writeText(copy);
        setStatus("Request copied. Paste it into your agent’s chat.");
      } catch {
        setStatus("Copy the request below and send it to your agent.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const startSession = () =>
    void ask(
      "Review my selected session: strengths, recurring patterns, contrary evidence and one practical next-session experiment. Return a session debrief report.",
    );
  return (
    <section
      className="engineer-chat debrief-paper"
      aria-label="AI race engineer"
    >
      <div className="debrief-header">
        <div>
          <span className="debrief-kicker">RACE ENGINEER · MCP</span>
          <h1>
            Race engineer<span>.</span>
          </h1>
          <p>Your data in Apex. Your AI agent does the coaching.</p>
        </div>
        <button
          className={`agent-pill ${connection === "connected" ? "is-connected" : connection === "waiting" ? "is-waiting" : "is-off"}`}
          onClick={openAgentConnection}
        >
          <Bot size={15} />
          {connection === "connected"
            ? "Agent connected"
            : connection === "waiting"
              ? "MCP enabled · Waiting"
              : "Connect AI agent"}
        </button>
      </div>
      <div className="engineer-mcp-intro">
        <strong>No API key needed</strong>
        <p>
          Connect your local MCP agent, choose a corner or the whole session,
          then copy a review request into the agent’s chat. It can read the
          evidence and send advice back here.
        </p>
        <button onClick={openAgentConnection}>Connection &amp; setup</button>
      </div>
      <div className="engineer-actions" role="group" aria-label="Review type">
        <button
          className={view === "corners" ? "active" : ""}
          onClick={() => setView("corners")}
        >
          {settings.reviewMode === "turns" ? "Turns" : "Sections"}
        </button>
        <button
          className={view === "session" ? "active" : ""}
          onClick={() => setView("session")}
        >
          Session debrief
        </button>
        {view === "session" && (
          <button
            disabled={!snapshot || connection !== "connected"}
            onClick={startSession}
          >
            <Copy size={14} /> Copy session review request
          </button>
        )}
        {report && (
          <span role="status">
            <Check size={14} /> Saved advice · AI interpretation
          </span>
        )}
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {prompt && (
        <label className="engineer-mcp-request">
          Request for your agent
          <textarea
            aria-label="Request for your agent"
            readOnly
            value={prompt}
            rows={4}
          />
          <small>
            Sending this in your agent’s chat starts the review. MCP does not
            start a conversation automatically.
          </small>
        </label>
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
              report={report}
              speedUnit={speedUnit}
              onEvidence={onEvidence}
              onAnalyze={() =>
                void ask(
                  `Review ${activeCorner.name} (${activeCorner.id}). Compare every available top-three pass and the review lap using speed and G traces. Explain one useful practice step, contrary evidence and limitations. Return a corner review report.`,
                  activeCorner.id,
                )
              }
              busy={false}
              canAnalyze={
                connection === "connected" &&
                cornerPasses(snapshot, activeCorner.id).length > 0
              }
              humanize={humanize}
            />
          ) : (
            <p>
              No {settings.reviewMode === "turns" ? "turns" : "sections"}{" "}
              available. Use Session debrief or check Laps &amp; context.
            </p>
          )
        ) : report && (report.debrief || report.priorities.length) ? (
          <DebriefView
            report={report}
            snapshot={snapshot}
            sessions={sessions}
            speedUnit={speedUnit}
            onEvidence={onEvidence}
            humanize={humanize}
            onQuestion={setQuestion}
          />
        ) : (
          <DebriefPreview snapshot={snapshot} sessions={sessions} />
        )
      ) : (
        <div className="debrief-empty">Preparing session evidence…</div>
      )}
      <div className="engineer-mcp-followup">
        <label>
          Ask your agent about this review
          <textarea
            aria-label="Question for your MCP agent"
            value={question}
            maxLength={4000}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should I focus on next session?"
          />
        </label>
        <button
          disabled={!snapshot || connection !== "connected" || !question.trim()}
          onClick={() =>
            void ask(
              question,
              view === "corners" ? activeCorner?.id : undefined,
            )
          }
        >
          <Copy size={14} /> Copy request for agent
        </button>
      </div>
    </section>
  );
}
