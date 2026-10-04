import { useEffect, useRef, useState } from "react";
import { FolderOpen, Film } from "lucide-react";
import type { Binding } from "./model";
import type { LoadedProject } from "./storage";
import "./projectImport.css";
export type ImportDecision = { files: File[]; openVideos: boolean };
export function ProjectImportDialog({
  project,
  name,
  onDecision,
}: {
  project: LoadedProject;
  name: string;
  onDecision: (decision: ImportDecision | null) => void;
}) {
  const videoInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const clips = [
    ...new Map<string, { name: string; camera?: string; hash: string }>(
      project.manifest.sync.bindings.flatMap((b: any) =>
        b.clips.map((c: any) => [
          c.sha256,
          { name: c.name, camera: c.motion?.camera, hash: c.sha256 },
        ]),
      ),
    ).values(),
  ];
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="project-import"
      aria-labelledby="project-import-title"
      onCancel={(e) => {
        e.preventDefault();
        onDecision(null);
      }}
    >
      <div className="eyebrow">PORTABLE SESSION FILE</div>
      <h2 id="project-import-title">Review your session data</h2>
      <p className="muted">{name}</p>
      <p>
        This file contains original telemetry, saved analysis settings and video
        timing. Videos stay on your device.
      </p>
      <div className="project-import-sessions">
        {project.records.map(({ session: s }) => (
          <article key={s.id}>
            <h3>{s.track}</h3>
            <p>
              {s.filename} · {(s.format ?? "rcz").toUpperCase()} ·{" "}
              {new Date(s.start).toLocaleString()}
            </p>
            <div className="project-import-metrics">
              <span>
                <b>{s.times.length.toLocaleString()}</b> GPS samples
              </span>
              <span>
                <b>{s.channels.length}</b>{" "}
                {s.channels.length === 1 ? "channel" : "channels"}
              </span>
              <span>
                <b>{s.laps.length}</b> {s.laps.length === 1 ? "lap" : "laps"}
              </span>
            </div>
            <details>
              <summary>Included channels</summary>
              <p>
                {s.channels
                  .map((c) => c.name + (c.unit ? ` (${c.unit})` : ""))
                  .join(" · ") || "GPS positions and time"}
              </p>
            </details>
          </article>
        ))}
      </div>
      <h3>
        {clips.length
          ? "Link your original videos"
          : "Add a video after import"}
      </h3>
      {clips.length ? (
        <>
          <p>
            The saved timing will be restored. Choose the original files here or
            link them later from Video sync.
          </p>
          <ul>
            {clips.map((c) => (
              <li key={c.hash}>
                {c.name}
                {c.camera && c.camera !== "none" ? ` · ${c.camera}` : ""}
              </li>
            ))}
          </ul>
          <div className="project-video-picker">
            <input
              ref={videoInput}
              type="file"
              hidden
              multiple
              aria-label="Choose local videos"
              accept="video/*,.mp4,.mov,.insv,.osv"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <button
              type="button"
              className="project-video-button"
              onClick={() => videoInput.current?.click()}
            >
              <FolderOpen size={18} aria-hidden="true" />
              {files.length ? "Change videos" : "Choose videos"}
            </button>
            <div
              className="project-video-selection"
              role="status"
              aria-live="polite"
            >
              {files.length ? (
                <>
                  <strong>
                    <Film size={15} aria-hidden="true" />
                    {files.length}{" "}
                    {files.length === 1 ? "video selected" : "videos selected"}
                  </strong>
                  <span>{files.map((f) => f.name).join(", ")}</span>
                </>
              ) : (
                <>
                  <strong>No videos selected</strong>
                  <span>
                    You can link them later. Saved timing stays intact.
                  </span>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <p>
          Open Video sync after importing to choose a recording and align it
          with this telemetry.
        </p>
      )}
      <p className="muted">
        Existing sessions stay in this browser. The saved analysis settings from
        this file will be restored.
      </p>
      <div className="project-import-actions">
        <button onClick={() => onDecision(null)}>Cancel</button>
        <button onClick={() => onDecision({ files, openVideos: false })}>
          Import data
        </button>
        <button
          className="primary"
          onClick={() => onDecision({ files, openVideos: true })}
        >
          {clips.length &&
          project.manifest.sync.bindings.some((b: Binding) => b.anchors.length)
            ? files.length
              ? "Import and play video"
              : "Import with saved timing"
            : "Import and open video sync"}
        </button>
      </div>
    </dialog>
  );
}
