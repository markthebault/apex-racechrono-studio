import { useEffect, useRef, useState } from "react";
import type { Session } from "./model";
import type { KnownTrack, TrackChoice } from "./tracks";

// Put a session on the right track: one already in use, or a new name.
export function TrackChooser({
  session,
  tracks,
  onApply,
  onClose,
}: {
  session: Session;
  tracks: KnownTrack[];
  onApply: (choice: TrackChoice) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<number | "new">(session.trackId);
  const [name, setName] = useState("");
  const typed = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const unchanged = picked === session.trackId;
  const ready = picked === "new" ? name.trim().length > 0 : !unchanged;
  const save = () =>
    ready &&
    onApply(picked === "new" ? { name } : { trackId: picked as number });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="summary-card track-chooser"
        role="dialog"
        aria-modal="true"
        aria-label="Change the track of this session"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="summary-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="summary-track">{session.filename}</div>
        <h2 className="review-title">Which track was this?</h2>
        <p className="muted">
          It is on <b>{session.track}</b> now.{" "}
          {session.format === "vbo"
            ? "Its laps are cut again at the finish line of the track you choose. If that track has no finish line yet, you will be asked to place one."
            : "Its laps keep coming from the file."}{" "}
          Your choice is kept if you import the file again.
        </p>
        <div className="track-options" role="radiogroup" aria-label="Tracks">
          {tracks.map((t) => (
            <label key={t.trackId} className={picked === t.trackId ? "on" : ""}>
              <input
                type="radio"
                name="track"
                checked={picked === t.trackId}
                onChange={() => setPicked(t.trackId)}
              />
              <span>
                {t.name}
                {t.trackId === session.trackId && <em> current</em>}
              </span>
              <small>
                {t.sessions} {t.sessions === 1 ? "session" : "sessions"}
              </small>
            </label>
          ))}
          <label className={picked === "new" ? "on" : ""}>
            <input
              type="radio"
              name="track"
              checked={picked === "new"}
              onChange={() => {
                setPicked("new");
                typed.current?.focus();
              }}
            />
            <input
              ref={typed}
              className="new-track"
              placeholder="A track that is not in the list"
              aria-label="Name of a new track"
              value={name}
              onFocus={() => setPicked("new")}
              onChange={(e) => {
                setName(e.target.value);
                setPicked("new");
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") save();
                if (e.key === "Escape") onClose();
              }}
            />
          </label>
        </div>
        <div className="review-actions">
          <button className="sync-button" disabled={!ready} onClick={save}>
            Use this track
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
