import { useEffect, useRef } from "react";
import { lapTime } from "./model";
import {
  STATUS_LABEL,
  canInclude,
  explainIssue,
  type LapStatus,
} from "./lapStatus";

export type ReviewEffect = { without: number; with: number; wins: number };
const gain = (ms: number) =>
  (ms >= 0 ? "-" : "+") + (Math.abs(ms) / 1000).toFixed(3) + " s";

// Nothing changes until one of the buttons is pressed.
export function LapReview({
  title,
  where,
  issues,
  status,
  trackName,
  currentTrack,
  effect,
  onValid,
  onExclude,
  onAutomatic,
  onOpenTrack,
  onClose,
}: {
  title: string;
  where: string;
  issues: string[];
  status: LapStatus;
  trackName: string;
  currentTrack: string;
  effect?: ReviewEffect;
  onValid: () => void;
  onExclude: () => void;
  onAutomatic: () => void;
  onOpenTrack: () => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const forced = status === "included" || status === "excluded";
  const otherTrack = status === "other-track";
  const changed =
    effect && Number.isFinite(effect.without) && Number.isFinite(effect.with);
  const win = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="summary-card review-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={close}
          className="summary-close"
          aria-label="Close review"
          onClick={onClose}
        >
          ×
        </button>
        <div className="summary-track">{where}</div>
        <h2 className="review-title">{title}</h2>
        <p className={`review-status ${status}`}>{STATUS_LABEL[status]}</p>

        {otherTrack ? (
          <>
            <p>
              This lap was recorded at <b>{trackName}</b>, but the analysis is
              set to <b>{currentTrack}</b>. The analyzer compares laps of one
              track at a time, so this lap is not part of the current analysis.
              There is nothing wrong with the lap.
            </p>
            <div className="review-actions">
              <button className="primary" onClick={win(onOpenTrack)}>
                Analyze {trackName}
              </button>
              <button onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <h3>What was found</h3>
            {issues.length ? (
              <ul className="review-issues">
                {issues.map((i) => (
                  <li key={i}>
                    <b>{i}</b>
                    <span>{explainIssue(i)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Nothing. The lap lines up with the reference and has no flags.
              </p>
            )}

            {changed && (
              <>
                <h3>Effect on the theoretical lap</h3>
                <div className="review-effect">
                  <div>
                    <span>Without this lap</span>
                    <strong>{lapTime(effect!.without)}</strong>
                  </div>
                  <div>
                    <span>With this lap</span>
                    <strong>{lapTime(effect!.with)}</strong>
                  </div>
                  <div>
                    <span>Difference</span>
                    <strong>{gain(effect!.without - effect!.with)}</strong>
                  </div>
                  <div>
                    <span>Sectors it wins</span>
                    <strong>{effect!.wins}</strong>
                  </div>
                </div>
              </>
            )}

            <h3>Your decision</h3>
            <p className="muted">
              Saved on this device with your other settings and included in
              Export project. Nothing changes until you choose.
            </p>
            <div className="review-actions">
              {canInclude(issues) ? (
                <button
                  className={status === "included" ? "chosen" : "primary"}
                  onClick={win(onValid)}
                >
                  {status === "included" ? "✓ Marked valid" : "Mark as valid"}
                </button>
              ) : (
                <p className="review-locked">
                  This lap cannot be forced in: its sectors would be measured
                  against the wrong stretch of track.
                </p>
              )}
              {canInclude(issues) && (
                <button
                  className={status === "excluded" ? "chosen" : ""}
                  onClick={win(onExclude)}
                >
                  {status === "excluded"
                    ? "✓ Excluded"
                    : "Exclude from optimal"}
                </button>
              )}
              {forced && (
                <button onClick={win(onAutomatic)}>Back to automatic</button>
              )}
              <button onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
