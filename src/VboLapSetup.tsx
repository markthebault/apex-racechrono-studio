import { useMemo, useState } from "react";
import { Flag } from "lucide-react";
import type { Session } from "./model";
import { summarizeTracks } from "./tracks";
import { TracksMap } from "./TracksMap";

export function VboLapSetup({
  sessions,
  preview,
  onSetLine,
  onOpenSessions,
}: {
  sessions: Session[];
  preview: boolean;
  onSetLine: (id: string) => void;
  onOpenSessions: () => void;
}) {
  const [selected, setSelected] = useState("");
  const session = sessions.find((s) => s.id === selected) ?? sessions[0];
  const track = useMemo(
    () => (session && preview ? summarizeTracks([session])[0] : undefined),
    [session, preview],
  );
  if (!session) return null;
  return (
    <section
      className="vbo-lap-setup"
      aria-label="Find laps in your VBO recording"
    >
      <div className="vbo-setup-heading">
        <Flag size={22} aria-hidden="true" />
        <div>
          <h2>Place the start/finish line to calculate laps.</h2>
          <p>
            GPS and telemetry were imported, but this VBO has no timed laps yet.
            Place the start/finish line on your recorded path to find complete
            laps and open the charts, comparison and playback controls.
          </p>
        </div>
      </div>
      {sessions.length > 1 && (
        <label className="vbo-setup-picker">
          Recording to set up
          <select
            value={session.id}
            onChange={(e) => setSelected(e.target.value)}
          >
            {sessions.map((s) => (
              <option value={s.id} key={s.id}>
                {s.track} · {s.filename}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="vbo-setup-recording">
        <strong>{session.track}</strong>
        <span>{session.filename}</span>
        <small>
          {session.times.length.toLocaleString()} GPS samples ·{" "}
          {session.channels.length} telemetry channels
        </small>
      </div>
      {track && (
        <div className="vbo-setup-map" aria-label="Recorded GPS path">
          <TracksMap track={track} height={260} />
        </div>
      )}
      <div className="vbo-setup-actions">
        <button className="primary" onClick={() => onSetLine(session.id)}>
          <Flag size={16} aria-hidden="true" /> Set start/finish line
        </button>
        <button onClick={onOpenSessions}>View sessions</button>
      </div>
      <p className="vbo-setup-note">
        You can also import an RCZ recording from this circuit to reuse its
        known timing line. Preview the detected laps before saving your line.
      </p>
    </section>
  );
}
