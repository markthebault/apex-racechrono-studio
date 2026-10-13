import { useEffect, useRef } from "react";
import {
  Activity,
  Flag,
  FolderOpen,
  Layers,
  MapPin,
  Plus,
  Video,
  X,
} from "lucide-react";
import type { Session } from "./model";
import { groupSessions, isSelected, toggleSessions } from "./groups";

export function WorkspaceNavigation({
  tab,
  count,
  onNavigate,
}: {
  tab: string;
  count: number;
  onNavigate: (tab: string) => void;
}) {
  return (
    <nav aria-label="Workspace views">
      {[
        ["Analyze", Activity],
        ["Sessions", FolderOpen],
        ["Optimal lap", Layers],
        ["Tracks", MapPin],
        ["Video sync", Video],
      ].map(([name, Icon]) => (
        <button
          key={String(name)}
          aria-label={String(name)}
          aria-current={tab === name ? "page" : undefined}
          className={tab === name ? "selected" : ""}
          onClick={() => onNavigate(String(name))}
        >
          {<Icon size={18} />}
          <span>{String(name)}</span>
          {name === "Sessions" && <small>{count}</small>}
        </button>
      ))}
    </nav>
  );
}

export function WorkspaceCollection({
  sessions,
  collection,
  activeTrack,
  onAnalyze,
  onChange,
}: {
  sessions: Session[];
  collection: string[];
  activeTrack?: number;
  onAnalyze: (sessions: Session[]) => void;
  onChange: (collection: string[]) => void;
}) {
  return (
    <>
      <div className="sidebar-divider" />
      <div className="workspace-label">TRACKS & SESSIONS</div>
      {!sessions.length && (
        <p className="workspace-empty">
          Import a recording to choose your tracks and sessions.
        </p>
      )}
      {groupSessions(sessions, "track").map((g) => (
        <div
          className={`track-group${g.sessions.some((s) => s.trackId === activeTrack) ? " active" : ""}`}
          key={g.key}
        >
          <button
            className="collection-name"
            aria-pressed={g.sessions.some((s) => s.trackId === activeTrack)}
            title={`Analyze ${g.label}`}
            onClick={() => onAnalyze(g.sessions)}
          >
            <Flag size={16} />
            <span>{g.label}</span>
            <small>{g.sessions.length}</small>
          </button>
          {g.sessions.map((s) => (
            <label className="session-check" key={s.id}>
              <input
                type="checkbox"
                aria-label={`Include ${s.track}: ${s.filename}`}
                checked={isSelected(collection, s.id)}
                onChange={(e) =>
                  onChange(
                    toggleSessions(
                      sessions.map((s) => s.id),
                      collection,
                      [s.id],
                      e.target.checked,
                    ),
                  )
                }
              />
              <span>
                {new Date(s.start).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
                <small>
                  {new Date(s.start).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {s.laps.length} laps
                </small>
              </span>
            </label>
          ))}
        </div>
      ))}
    </>
  );
}

export function MobileWorkspace({
  sessions,
  collection,
  activeTrack,
  tab,
  onNavigate,
  onAnalyze,
  onChange,
  onImport,
  onClose,
}: {
  sessions: Session[];
  collection: string[];
  activeTrack?: number;
  tab: string;
  onNavigate: (tab: string) => void;
  onAnalyze: (sessions: Session[]) => void;
  onChange: (collection: string[]) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    const wide = window.matchMedia("(min-width: 851px)");
    const resize = () => {
      if (wide.matches) onClose();
    };
    wide.addEventListener("change", resize);
    return () => {
      wide.removeEventListener("change", resize);
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);
  return (
    <dialog
      ref={dialog}
      className="mobile-workspace"
      aria-label="Tracks and sessions menu"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="mobile-workspace-heading">
        <strong>Your workspace</strong>
        <button aria-label="Close menu" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="mobile-workspace-content">
        <WorkspaceNavigation
          tab={tab}
          count={sessions.length}
          onNavigate={(name) => {
            onClose();
            onNavigate(name);
          }}
        />
        <WorkspaceCollection
          sessions={sessions}
          collection={collection}
          activeTrack={activeTrack}
          onChange={onChange}
          onAnalyze={(group) => {
            onClose();
            onAnalyze(group);
          }}
        />
        <p className="workspace-help">
          Tap a track to analyze it. Tick sessions to include them in your
          comparison.
        </p>
      </div>
      <div className="mobile-workspace-actions">
        <button
          className="primary"
          onClick={() => {
            onClose();
            onImport();
          }}
        >
          <Plus size={18} /> Import sessions
        </button>
        <button onClick={onClose}>Done</button>
      </div>
    </dialog>
  );
}
