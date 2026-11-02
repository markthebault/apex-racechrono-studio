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
  };
  bindings: Binding[];
  files: Record<string, string>;
  navigate: (args: Record<string, unknown>) => void;
  importSession: (files: File[]) => Promise<unknown>;
};
export function AgentPanel({ host }: { host: AgentHost }) {
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
    const match = location.hash.match(/^#apex-agent=(\d{1,5}):([a-f0-9]{64})$/);
    if (match) {
      setPort(match[1]);
      setToken(match[2]);
      setOpen(true);
      history.replaceState(null, "", location.pathname + location.search);
    }
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
        if (name === "apex_state") result = state();
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
                  "tab",
                  "lapId",
                  "comparisonLapId",
                  "range",
                  "cursor",
                ].includes(k),
            )
          )
            throw Error("invalid_arguments");
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
          if (!service.current) throw Error("analysis_not_prepared");
          result = await service.current.query(
            name.replace(/^apex_/, ""),
            args,
          );
        }
        if (
          !active ||
          !permissions.current.connected ||
          (name !== "apex_import_session" &&
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
  return (
    <div className="agent-connection">
      <button onClick={() => setOpen(!open)}>Local agent · {status}</button>
      {open && (
        <section
          aria-label="Local agent connection"
          style={{
            position: "fixed",
            right: 16,
            top: 70,
            zIndex: 1000,
            maxWidth: 430,
            padding: 20,
            background: "var(--panel, #18202c)",
            border: "1px solid #667",
            borderRadius: 12,
          }}
        >
          <h3>Local MCP agent</h3>
          <p>
            Connecting shares recording names, selected views and queried
            telemetry with your agent and its model provider. Video frames
            require separate permission. Disconnect stops access.
          </p>
          <label>
            Port{" "}
            <input
              aria-label="Agent port"
              value={port}
              disabled={connected}
              onChange={(e) => setPort(e.target.value)}
            />
          </label>
          <label>
            Pairing token{" "}
            <input
              aria-label="Agent pairing token"
              type="password"
              value={token}
              disabled={connected}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={control}
              onChange={(e) => setControl(e.target.checked)}
            />{" "}
            Allow navigation and session import
          </label>
          <br />
          <label>
            <input
              type="checkbox"
              checked={video}
              onChange={(e) => setVideo(e.target.checked)}
            />{" "}
            Share linked video frames
          </label>
          <br />
          <button onClick={() => setConnected(!connected)}>
            {connected ? "Disconnect agent" : "Connect agent"}
          </button>
          <button onClick={() => setOpen(false)}>Close</button>
        </section>
      )}
    </div>
  );
}
