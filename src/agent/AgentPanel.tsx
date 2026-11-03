import { agentSetupPrompt } from "./setupPrompt";
import type { DetectedTurn } from "../turns";
import { turnContext } from "./turns";
import { setAgentConnection } from "./connection";
import { engineerContext, queryEngineer, submitEngineer } from "./engineer";
import { Bot, Check, Copy, Plug, X } from "lucide-react";
import "./agent.css";
import { reviewSelection } from "./selection";
import { useEffect, useRef, useState } from "react";
import type { Binding, Session, Settings } from "../model";
import { hoverBus } from "../hover";
import { work } from "../storage";
import { emptySettings } from "../raceEngineer/contracts";
import type { Snapshot } from "../raceEngineer/contracts";
import { AnalysisService } from "../raceEngineer/service";
import { captureFrames } from "./video";
import { guide, startBridge } from "./bridge";
const helperPackage = "github:markthebault/apex-racechrono-studio";
const helperCommand = `npm exec --yes --package=${helperPackage} -- apex-mcp`;
const helperConfig = JSON.stringify(
  {
    mcpServers: {
      apex: {
        command: "npm",
        args: ["exec", "--yes", `--package=${helperPackage}`, "--", "apex-mcp"],
      },
    },
  },
  null,
  2,
);
export type AgentHost = {
  sessions: Session[];
  settings: Settings;
  view: {
    tab: string;
    lapId?: string;
    comparisonLapId?: string;
    range: number[];
    cursor: number;
    channels: unknown;
    playing: boolean;
    detectedTurns?: DetectedTurn[];
    selectedTurn?: string | null;
    turnReferenceId?: string;
  };
  bindings: Binding[];
  files: Record<string, string>;
  navigate: (args: Record<string, unknown>) => void;
  importSession: (files: File[]) => Promise<unknown>;
};
export function AgentPanel({ host }: { host: AgentHost }) {
  useEffect(() => {
    const show = () => {
      setSetupTab("simple");
      setOpen(true);
    };
    window.addEventListener("apex-open-agent", show);
    return () => window.removeEventListener("apex-open-agent", show);
  }, []);
  const [setupTab, setSetupTab] = useState<"simple" | "advanced">("simple");
  const setupPrompt = agentSetupPrompt(location.href);
  const [copyStatus, setCopyStatus] = useState("");
  const copySetup = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`${what} copied`);
    } catch {
      setCopyStatus("Clipboard unavailable. Select and copy the text below.");
    }
  };
  const latest = useRef(host);
  latest.current = host;
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState("Off");
  const [port, setPort] = useState("7318"),
    [token, setToken] = useState("");
  const [control, setControl] = useState(false),
    [video, setVideo] = useState(false),
    [connected, setConnected] = useState(false);
  const permissions = useRef({ control, video, connected });
  permissions.current = { control, video, connected };
  const generation = useRef(0),
    revision = useRef(0),
    previous = useRef("");
  const signature = JSON.stringify(host.view);
  if (signature !== previous.current) {
    previous.current = signature;
    revision.current++;
  }
  const service = useRef<AnalysisService | undefined>(undefined);
  useEffect(() => {
    const takePairing = () => {
      const match = location.hash.match(
        /^#apex-agent=(\d{1,5}):([a-f0-9]{64})$/,
      );
      if (!match) return;
      setConnected(false);
      setPort(match[1]);
      setToken(match[2]);
      setSetupTab("simple");
      setOpen(true);
      history.replaceState(null, "", location.pathname + location.search);
    };
    takePairing();
    window.addEventListener("hashchange", takePairing);
    return () => window.removeEventListener("hashchange", takePairing);
  }, []);
  useEffect(() => {
    generation.current++;
    service.current?.dispose();
    service.current = undefined;
  }, [host.sessions, host.settings.engineer]);
  useEffect(() => {
    generation.current++;
  }, [control, video]);
  useEffect(() => {
    if (!connected) return;
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535 || !token) {
      setStatus("Invalid port or token");
      return;
    }
    let active = true;
    const stop = startBridge(
      p,
      token,
      async (name, args) => {
        if (!active || !permissions.current.connected)
          throw Error("access_revoked");
        const h = latest.current,
          readGeneration = generation.current;
        const state = () => ({
          revision: revision.current + reviewSelection.revision(),
          selectedCorner: reviewSelection.get(),
          selectedSessions: h.settings.collection,
          chartMode: h.settings.mode,
          extraLaps: h.settings.extras,
          ...h.view,
          hover: hoverBus.get(),
          units: { speed: h.settings.speedUnit, distance: "m", lapTime: "ms" },
          recordings: h.sessions.map((s) => ({
            id: s.id,
            name: s.filename,
            track: s.track,
            laps: s.laps.map((l) => ({
              id: l.id,
              number: l.number,
              durationMs: l.end - l.start,
              issues: l.issues,
            })),
            videoLinked: h.bindings.some(
              (b) =>
                b.session.sha256 === s.id &&
                b.clips.some((c) => !!h.files[c.sha256]),
            ),
          })),
          permissions: {
            control: permissions.current.control,
            video: permissions.current.video,
          },
        });
        let result: unknown;
        if (name === "apex_turns")
          result = { ...turnContext(), selectedTurn: h.view.selectedTurn };
        else if (name === "apex_engineer_context") result = engineerContext();
        else if (name === "apex_engineer_report")
          result = await submitEngineer(args.requestId, args.report);
        else if (name === "apex_state") result = state();
        else if (name === "apex_guide") result = { guide };
        else if (name === "apex_import_session") {
          if (!permissions.current.control) throw Error("control_not_approved");
          if (
            typeof args.name !== "string" ||
            !/\.(rcz|vbo)$/i.test(args.name) ||
            typeof args.base64 !== "string" ||
            args.base64.length > 12 * 1024 * 1024
          )
            throw Error("invalid_import");
          const bytes = Uint8Array.from(atob(args.base64), (c) =>
            c.charCodeAt(0),
          );
          const imported = await h.importSession([
            new File([bytes], args.name),
          ]);
          if (!imported) throw Error("import_failed");
          result = { imported: true };
        } else if (name === "apex_view") {
          if (!permissions.current.control) throw Error("control_not_approved");
          if (
            args.revision !== undefined &&
            args.revision !== revision.current + reviewSelection.revision()
          )
            throw Error("stale_view");
          if (
            Object.keys(args).some(
              (k) =>
                ![
                  "revision",
                  "turnId",
                  "tab",
                  "lapId",
                  "comparisonLapId",
                  "range",
                  "cursor",
                ].includes(k),
            )
          )
            throw Error("invalid_arguments");
          if (args.turnId !== undefined) {
            if (
              typeof args.turnId !== "string" ||
              !h.view.detectedTurns?.some((t) => t.id === args.turnId)
            )
              throw Error("unknown_turn");
            if (
              ["lapId", "comparisonLapId", "range", "cursor", "tab"].some(
                (k) => args[k] !== undefined,
              )
            )
              throw Error("turn_navigation_must_be_separate");
          }
          if (
            args.tab !== undefined &&
            ![
              "Analyze",
              "Sessions",
              "Race Engineer",
              "Video sync",
              "Optimal lap",
            ].includes(String(args.tab))
          )
            throw Error("invalid_workspace");
          for (const key of ["lapId", "comparisonLapId"])
            if (
              args[key] !== undefined &&
              args[key] !== "" &&
              !h.sessions.some((s) => s.laps.some((l) => l.id === args[key]))
            )
              throw Error("unknown_lap");
          const chosen = h.sessions
            .flatMap((s) => s.laps)
            .find((l) => l.id === (args.lapId ?? h.view.lapId));
          if (
            args.range !== undefined &&
            (!Array.isArray(args.range) ||
              args.range.length !== 2 ||
              args.range.some(
                (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
              ) ||
              args.range[1] <= args.range[0])
          )
            throw Error("invalid_range");
          if (
            args.cursor !== undefined &&
            (typeof args.cursor !== "number" ||
              !Number.isFinite(args.cursor) ||
              args.cursor < 0)
          )
            throw Error("invalid_cursor");
          if (!chosen && (args.range || args.cursor !== undefined))
            throw Error("select_recorded_lap");
          h.navigate(args);
          result = { applied: true, readNext: "apex_state" };
        } else if (name === "apex_prepare_analysis") {
          const lapIds = args.lapIds;
          if (
            !Array.isArray(lapIds) ||
            !lapIds.length ||
            lapIds.length > 200 ||
            lapIds.some(
              (id) =>
                typeof id !== "string" ||
                !h.sessions.some((s) => s.laps.some((l) => l.id === id)),
            )
          )
            throw Error("invalid_lap_scope");
          if (
            typeof args.referenceId !== "string" ||
            !lapIds.includes(args.referenceId)
          )
            throw Error("invalid_reference");
          service.current?.dispose();
          service.current = undefined;
          const sessions = h.sessions.filter((s) =>
            s.laps.some((l) => lapIds.includes(l.id)),
          );
          const snapshot = await work<Snapshot>("engineer", {
            input: {
              sessions,
              lapIds,
              referenceId: args.referenceId,
              settings: h.settings.engineer,
            },
          });
          if (!active || generation.current !== readGeneration)
            throw Error("scope_changed");
          const next = new AnalysisService(
            snapshot,
            sessions,
            h.settings.engineer ?? emptySettings(),
          );
          next.grant();
          service.current = next;
          result = {
            snapshotId: snapshot.id,
            referenceId: snapshot.referenceId,
            lapCount: snapshot.laps.length,
            warnings: snapshot.warnings,
          };
        } else if (name === "apex_video_frames") {
          if (!permissions.current.video) throw Error("video_not_approved");
          const session = h.sessions.find((s) =>
            s.laps.some((l) => l.id === args.lapId),
          );
          if (!session) throw Error("unknown_lap");
          result = await captureFrames(
            session,
            String(args.lapId),
            args.times as number[],
            h.bindings.find((b) => b.session.sha256 === session.id),
            h.files,
          );
          if (!permissions.current.video) throw Error("video_access_revoked");
        } else {
          const engineerQuery = queryEngineer(name.replace(/^apex_/, ""), args);
          if (engineerQuery) result = await engineerQuery;
          else {
            if (!service.current) throw Error("analysis_not_prepared");
            result = await service.current.query(
              name.replace(/^apex_/, ""),
              args,
            );
          }
        }
        if (
          !active ||
          !permissions.current.connected ||
          (name !== "apex_import_session" &&
            name !== "apex_engineer_report" &&
            readGeneration !== generation.current)
        )
          throw Error("access_or_scope_changed");
        return result;
      },
      setStatus,
    );
    return () => {
      active = false;
      generation.current++;
      service.current?.dispose();
      service.current = undefined;
      stop();
    };
  }, [connected, port, token]);
  const isConnected = connected && status === "Connected";
  useEffect(() => {
    setAgentConnection(
      isConnected ? "connected" : connected ? "waiting" : "off",
    );
  }, [isConnected, connected]);
  useEffect(() => () => setAgentConnection("off"), []);
  const connectionLabel = isConnected
    ? "Agent connected"
    : connected
      ? "MCP enabled · Waiting"
      : "Connect AI agent";
  return (
    <div className="agent-connection">
      <button
        className={`agent-pill ${isConnected ? "is-connected" : connected ? "is-waiting" : "is-off"}`}
        onClick={() => {
          if (!open) setSetupTab("simple");
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-controls="agent-connection-panel"
        title={
          isConnected
            ? "Your AI agent is connected to this workspace"
            : connected
              ? status
              : "Connect a local AI agent via MCP"
        }
      >
        <span className="agent-status-dot" aria-hidden="true" />
        <Bot size={15} aria-hidden="true" />
        <span aria-live="polite">{connectionLabel}</span>
      </button>
      {open && (
        <section
          id="agent-connection-panel"
          className="agent-panel"
          role="dialog"
          aria-labelledby="agent-panel-title"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="agent-panel-heading">
            <span className="agent-icon">
              <Bot size={22} />
            </span>
            <div>
              <h3 id="agent-panel-title">Your AI, in the workspace</h3>
              <p>Connect your local agent with MCP.</p>
            </div>
            <button
              className="agent-close"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div
            className={`agent-connection-state ${isConnected ? "is-connected" : connected ? "is-waiting" : "is-off"}`}
            role="status"
          >
            {isConnected ? <Check size={17} /> : <Plug size={17} />}
            <div>
              <strong>
                {isConnected
                  ? "Agent connected"
                  : connected
                    ? "MCP is enabled"
                    : "Ready when you are"}
              </strong>
              <p>
                {isConnected
                  ? "Your agent can read this workspace and query your data."
                  : connected
                    ? "Waiting for your local agent. Keep its app running."
                    : "Copy the setup prompt to your agent, then open its pairing link."}
              </p>
              {connected && !isConnected && <small>{status}</small>}
            </div>
          </div>
          <div
            className="agent-setup-tabs"
            role="tablist"
            aria-label="Connection setup"
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? "simple"
                  : e.key === "End"
                    ? "advanced"
                    : setupTab === "simple"
                      ? "advanced"
                      : "simple";
              setSetupTab(next);
              document.getElementById(`agent-${next}-tab`)?.focus();
            }}
          >
            <button
              role="tab"
              id="agent-simple-tab"
              tabIndex={setupTab === "simple" ? 0 : -1}
              aria-selected={setupTab === "simple"}
              aria-controls="agent-simple-panel"
              onClick={() => setSetupTab("simple")}
            >
              Simple
            </button>
            <button
              role="tab"
              id="agent-advanced-tab"
              tabIndex={setupTab === "advanced" ? 0 : -1}
              aria-selected={setupTab === "advanced"}
              aria-controls="agent-advanced-panel"
              onClick={() => setSetupTab("advanced")}
            >
              Advanced
            </button>
          </div>
          {setupTab === "simple" ? (
            <div
              id="agent-simple-panel"
              role="tabpanel"
              aria-labelledby="agent-simple-tab"
              className="agent-simple-setup"
            >
              <h4>Let your agent connect</h4>
              <p>
                Copy this prompt into your local coding agent. It finds the
                helper, creates a pairing link and checks the connection. Open
                the link here, then press Connect agent.
              </p>
              <button
                className="primary"
                onClick={() => void copySetup(setupPrompt, "Setup prompt")}
              >
                <Copy size={14} /> Copy setup prompt
              </button>
              <textarea
                aria-label="Agent setup prompt"
                readOnly
                value={setupPrompt}
                rows={9}
              />
              <small>
                Your agent needs local tools or an existing Apex MCP connection.
                A chat-only client cannot start a server on your computer from a
                prompt. Use Advanced for manual setup and optional permissions.
              </small>
              <p role="status" className="agent-copy-status">
                {copyStatus}
              </p>
            </div>
          ) : (
            <div
              id="agent-advanced-panel"
              role="tabpanel"
              aria-labelledby="agent-advanced-tab"
            >
              <details className="agent-setup" open={!token || undefined}>
                <summary>How to connect · 3 simple steps</summary>
                <ol>
                  <li>
                    <strong>Connect directly from GitHub</strong>
                    <p>
                      Install Node.js 22+. The helper downloads from Apex’s
                      public repository—no checkout, <code>npm ci</code>, or
                      local script path needed.
                    </p>
                    <div className="agent-code-heading">
                      <span>Terminal command</span>
                      <button
                        onClick={() => void copySetup(helperCommand, "Command")}
                      >
                        <Copy size={12} /> Copy command
                      </button>
                    </div>
                    <pre className="agent-install-command">{helperCommand}</pre>
                    <p>
                      To connect your AI app, copy this into its MCP settings.
                      Your agent installs and starts the helper automatically.
                    </p>
                    <div className="agent-code-heading">
                      <span>MCP configuration</span>
                      <button
                        onClick={() =>
                          void copySetup(helperConfig, "Configuration")
                        }
                      >
                        <Copy size={12} /> Copy configuration
                      </button>
                    </div>
                    <pre>{helperConfig}</pre>
                    <p
                      className="agent-copy-status"
                      role="status"
                      aria-live="polite"
                    >
                      {copyStatus}
                    </p>
                  </li>
                  <li>
                    <strong>Ask your agent for a pairing link</strong>
                    <p>
                      Say: “Connect to Apex using apex_connection.” Open the
                      link it gives you in this browser.
                    </p>
                  </li>
                  <li>
                    <strong>Enable the connection</strong>
                    <p>
                      Press <b>Connect agent</b> below and allow device access
                      if your browser asks. The pill turns green when connected.
                    </p>
                  </li>
                </ol>
              </details>
              <div className="agent-pairing-fields">
                <label>
                  Port
                  <input
                    aria-label="Agent port"
                    inputMode="numeric"
                    value={port}
                    disabled={connected}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </label>
                <label>
                  Pairing token
                  <input
                    aria-label="Agent pairing token"
                    type="password"
                    placeholder="Filled by your pairing link"
                    value={token}
                    disabled={connected}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
              </div>
              <div className="agent-permissions">
                <span className="agent-section-label">
                  Let your agent do more
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={control}
                    onChange={(e) => setControl(e.target.checked)}
                  />
                  <span>
                    Allow navigation and session import
                    <small>Open comparisons and move around the data.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={video}
                    onChange={(e) => setVideo(e.target.checked)}
                  />
                  <span>
                    Share linked video frames
                    <small>
                      View stills from your synchronized onboard video.
                    </small>
                  </span>
                </label>
              </div>
            </div>
          )}
          <p className="agent-privacy">
            Connecting shares workspace details and requested data with your
            agent and its model provider. Disconnect at any time to stop access.
          </p>
          <div className="agent-panel-footer">
            <span>
              <i className="agent-legend-dot is-waiting" /> Enabled{" "}
              <i className="agent-legend-dot is-connected" /> Connected
            </span>
            <button
              className={connected ? "" : "primary"}
              disabled={
                !connected &&
                (!token ||
                  !Number.isInteger(Number(port)) ||
                  Number(port) < 1 ||
                  Number(port) > 65535)
              }
              onClick={() => setConnected(!connected)}
            >
              {connected ? "Disconnect agent" : "Connect agent"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
