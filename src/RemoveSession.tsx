import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Session } from "./model";

export function RemoveSession({
  session,
  busy,
  error,
  onRemove,
  onClose,
}: {
  session: Session;
  busy: boolean;
  error: string;
  onRemove: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="summary-card remove-session"
      aria-labelledby="remove-session-title"
      aria-describedby="remove-session-description"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <button
        className="summary-close"
        aria-label="Cancel session removal"
        disabled={busy}
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <h2 id="remove-session-title" className="review-title">
        Remove session?
      </h2>
      <p className="remove-session-filename">{session.filename}</p>
      <p id="remove-session-description">
        This removes the session, its laps and saved video sync from this
        browser. Your original recording and video files stay untouched. You can
        import the recording again later.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="review-actions">
        <button ref={cancel} disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button className="danger" disabled={busy} onClick={onRemove}>
          {busy ? "Removing…" : "Remove session"}
        </button>
      </div>
    </dialog>
  );
}
