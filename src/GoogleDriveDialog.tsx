import { useEffect, useRef, useState } from "react";
import { Cloud, FolderOpen, RefreshCw } from "lucide-react";
import type { GoogleDriveController } from "./useGoogleDrive";
import "./googleDrive.css";
export function GoogleDriveDialog({
  open,
  onClose,
  drive,
}: {
  open: boolean;
  onClose: () => void;
  drive: GoogleDriveController;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [folderName, setFolderName] = useState("Apex Studio");
  const { preferences: p, connected, busy } = drive;
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  async function pickFolder() {
    // Google's picker is attached to document.body. Hide the native top-layer
    // dialog while it is open so the picker remains visible and interactive.
    const element = dialog.current!;
    element.close();
    try {
      await drive.chooseFolder();
    } finally {
      if (element.isConnected) element.showModal();
    }
  }
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className="drive-dialog"
      aria-labelledby="drive-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="eyebrow">WORKSPACE STORAGE</div>
      <h2 id="drive-title">
        <Cloud size={24} /> Google Drive
      </h2>
      <p>
        Your session file includes all local RCZ/VBO recordings, analysis
        settings and saved video timing. Relinking an original video restores
        its alignment; videos stay on your device.
      </p>
      <p className="muted">
        The connection survives refreshes in this tab until Google’s token
        expires. Your account, chosen folder and saved-file list are remembered
        on this device.{" "}
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
          How your data is used
        </a>
      </p>
      {!drive.configured ? (
        <p className="notice">
          Google Drive is not configured. Use Download session file for local
          storage.
        </p>
      ) : (
        <div className="drive-connect">
          <span className={connected ? "cyan" : "muted"}>
            {connected
              ? `Google Drive connected · ${drive.account?.name}`
              : drive.account
                ? `Reconnect ${drive.account.name}`
                : "Choose a Google account to connect"}
          </span>
          {!connected && (
            <button
              className="primary"
              disabled={!drive.identityReady || busy}
              onClick={() => drive.connect()}
            >
              {drive.account
                ? "Reconnect Google Drive"
                : "Connect Google Drive"}
            </button>
          )}
          {connected && (
            <>
              <button disabled={busy} onClick={() => drive.connect(true)}>
                Switch account
              </button>
              <button disabled={busy} onClick={drive.disconnect}>
                Disconnect this browser
              </button>
            </>
          )}
        </div>
      )}
      {drive.error && (
        <p className="error" role="alert">
          {drive.error}
        </p>
      )}
      {drive.status && <p role="status">{drive.status}</p>}
      <section className="drive-folder">
        <h3>Save location</h3>
        <div className="drive-folder-current">
          <FolderOpen size={18} />
          <b>{p.folder?.name || "My Drive"}</b>
          {p.folder && (
            <a
              href={`https://drive.google.com/drive/folders/${p.folder.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View folder
            </a>
          )}
        </div>
        <div className="drive-row">
          <button
            disabled={!connected || busy || !drive.pickerConfigured}
            onClick={pickFolder}
          >
            Choose Drive folder
          </button>
          {p.folder && (
            <button disabled={busy} onClick={drive.useMyDrive}>
              Use My Drive
            </button>
          )}
        </div>
        <div className="drive-row">
          <input
            aria-label="New Drive folder name"
            value={folderName}
            maxLength={180}
            onChange={(e) => setFolderName(e.target.value)}
          />
          <button
            disabled={!connected || busy || !folderName.trim()}
            onClick={() => drive.newFolder(folderName)}
          >
            Create folder
          </button>
        </div>
        <small>
          Changing the folder starts a new saved file there. Existing files stay
          where they are.
        </small>
      </section>
      <section className="drive-save">
        <h3>{p.target ? "Current Drive file" : "Save this workspace"}</h3>
        {p.target && (
          <p className="drive-target">
            <b>{p.target.name}</b>
            <span>
              {drive.dirty ? "Changes ready to save" : "Up to date"}
              {p.lastSavedAt &&
                ` · Saved ${new Date(p.lastSavedAt).toLocaleTimeString()}`}
            </span>
          </p>
        )}
        <label>
          File name
          <input
            aria-label="Drive session file name"
            value={p.name}
            maxLength={180}
            onChange={(e) => drive.patch({ name: e.target.value })}
          />
        </label>
        <div className="drive-row">
          <button
            className="primary"
            disabled={!connected || busy || !p.name.trim()}
            onClick={() => drive.save()}
          >
            Save to Drive
          </button>
          {p.target && (
            <button
              disabled={!connected || busy || !p.name.trim()}
              onClick={() => drive.save(true)}
            >
              Save a new copy
            </button>
          )}
        </div>
        <label className="drive-autosave">
          <input
            type="checkbox"
            checked={p.autoSave}
            disabled={!connected || busy || !p.target}
            onChange={(e) => drive.patch({ autoSave: e.target.checked })}
          />{" "}
          Automatically save changes to this file
        </label>
        <small>
          {p.target
            ? "Autosave runs after 30 seconds without changes, while this tab is open and connected. Video synchronization changes are included."
            : "Save once to create your Drive file, then enable autosave. Future saves update that file."}
        </small>
      </section>
      <div className="drive-list-heading">
        <h3>Saved session files</h3>
        <button
          aria-label="Refresh Drive files"
          disabled={!connected || busy}
          onClick={() => drive.refresh()}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {!connected && p.files.length > 0 && (
        <p className="muted">
          Remembered files · reconnect to open them or refresh this list.
        </p>
      )}
      <div className="drive-files">
        {p.files.map((file) => (
          <article key={file.id}>
            <div>
              <b>
                {file.name}
                {file.id === p.target?.id && (
                  <span className="drive-current">Current</span>
                )}
              </b>
              <small>
                {file.modifiedTime &&
                  new Date(file.modifiedTime).toLocaleString()}
                {file.size && ` · ${(Number(file.size) / 1024).toFixed(0)} KB`}
              </small>
            </div>
            <button
              disabled={!connected || busy}
              onClick={() => drive.restore(file)}
            >
              <FolderOpen size={14} /> Open
            </button>
          </article>
        ))}
        {!p.files.length && (
          <p className="muted">
            {connected
              ? "No session files saved by this app yet."
              : "Connect to see your saved session files."}
          </p>
        )}
      </div>
      <div className="drive-actions">
        {busy && <button onClick={drive.cancel}>Cancel operation</button>}
        <button disabled={busy} onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
