import { useEffect, useRef, useState } from "react";
import { Cloud, FolderOpen, RefreshCw } from "lucide-react";
import {
  DRIVE_SCOPE,
  DriveAuthExpired,
  listDriveProjects,
  loadGoogleIdentity,
  openDriveProject,
  saveDriveProject,
} from "./googleDrive";
import type { DriveFile, GoogleIdentity } from "./googleDrive";
import "./googleDrive.css";
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
export function GoogleDriveDialog({
  open,
  onClose,
  onCreate,
  onOpen,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: () => Promise<Blob>;
  onOpen: (file: File) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const client =
    useRef<ReturnType<GoogleIdentity["accounts"]["oauth2"]["initTokenClient"]>>(
      undefined,
    );
  const token = useRef<{ value: string; expires: number }>(undefined);
  const operation = useRef<AbortController>(undefined);
  const [ready, setReady] = useState(false),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false),
    [files, setFiles] = useState<DriveFile[]>([]),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [name, setName] = useState(
    "Track day " + new Date().toISOString().slice(0, 10),
  );
  function accessToken() {
    if (!token.current || token.current.expires <= Date.now()) {
      token.current = undefined;
      setConnected(false);
      throw new DriveAuthExpired();
    }
    return token.current.value;
  }
  function report(e: unknown) {
    if (e instanceof DriveAuthExpired) {
      token.current = undefined;
      setConnected(false);
    }
    setError(
      e instanceof Error && e.name === "AbortError"
        ? "Operation cancelled."
        : e instanceof Error
          ? e.message
          : "Google Drive operation failed.",
    );
  }
  async function refresh() {
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      setFiles(await listDriveProjects(accessToken(), controller.signal));
    } catch (e) {
      report(e);
    } finally {
      if (operation.current === controller) operation.current = undefined;
      setBusy(false);
    }
  }
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
  useEffect(() => {
    if (!open || !clientId) return;
    let active = true;
    loadGoogleIdentity()
      .then((identity) => {
        if (!active) return;
        client.current = identity.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          include_granted_scopes: false,
          callback: (response) => {
            if (
              response.error ||
              !response.access_token ||
              !identity.accounts.oauth2.hasGrantedAllScopes(
                response,
                DRIVE_SCOPE,
              )
            ) {
              setBusy(false);
              setError(
                "Google Drive connection was not completed. Please allow access to the files this app creates.",
              );
              return;
            }
            const expires = Number(response.expires_in);
            if (!Number.isFinite(expires) || expires <= 30 || expires > 86400) {
              setBusy(false);
              report(new DriveAuthExpired());
              return;
            }
            token.current = {
              value: response.access_token,
              expires: Date.now() + (expires - 30) * 1000,
            };
            setConnected(true);
            setError("");
            setStatus("Connected to Google Drive.");
            void refresh();
          },
          error_callback: () => {
            setBusy(false);
            setError(
              "Google sign-in was closed or blocked. Try connecting again.",
            );
          },
        });
        setReady(true);
        if (token.current) void refresh();
      })
      .catch((e) => {
        if (active) report(e);
      });
    return () => {
      active = false;
    };
  }, [open]);
  async function save() {
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setStatus("Preparing your portable session file…");
    try {
      const value = accessToken(),
        archive = await onCreate();
      const result = await saveDriveProject(
        value,
        archive,
        name,
        (progress) =>
          setStatus(`Saving to Google Drive · ${Math.round(progress * 100)}%`),
        controller.signal,
      );
      setStatus(`Saved ${result.name} to your Google Drive.`);
      setFiles(await listDriveProjects(accessToken(), controller.signal));
    } catch (e) {
      report(e);
      setStatus("");
    } finally {
      if (operation.current === controller) operation.current = undefined;
      setBusy(false);
    }
  }
  async function restore(file: DriveFile) {
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setStatus(`Opening ${file.name}…`);
    try {
      const local = await openDriveProject(
        accessToken(),
        file,
        controller.signal,
      );
      onClose();
      onOpen(local);
      setStatus("");
    } catch (e) {
      report(e);
    } finally {
      if (operation.current === controller) operation.current = undefined;
      setBusy(false);
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
        Save your GPS, telemetry and video timing as a portable session file.
        Open it on another device and choose your local videos.
      </p>
      <p className="muted">
        The app requests access to files it creates or you open with it. Videos
        stay on your device. Your browser keeps the Google connection only for
        this visit.{" "}
        <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
          How your data is used
        </a>
      </p>
      {!clientId ? (
        <p className="notice">
          Google Drive has not been configured for this deployment. You can use
          Download session file for local storage.
        </p>
      ) : (
        <div className="drive-connect">
          <span className={connected ? "cyan" : "muted"}>
            {connected
              ? "Google Drive connected"
              : "Choose a Google account to connect"}
          </span>
          <button
            disabled={!ready || busy}
            className="primary"
            onClick={() => {
              setError("");
              setBusy(true);
              client.current?.requestAccessToken({ prompt: "select_account" });
            }}
          >
            Connect Google Drive
          </button>
          {connected && (
            <button
              disabled={busy}
              onClick={() => {
                token.current = undefined;
                setConnected(false);
                setFiles([]);
                setStatus("Disconnected from Google Drive.");
              }}
            >
              Disconnect this browser
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <section className="drive-save">
        <h3>Save this workspace</h3>
        <label>
          File name
          <input
            aria-label="Drive session file name"
            value={name}
            maxLength={180}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button disabled={!connected || busy || !name.trim()} onClick={save}>
          Save a new copy to Drive
        </button>
        <small>
          Each save creates a new copy with all sessions stored in this browser.
        </small>
      </section>
      <div className="drive-list-heading">
        <h3>Saved session files</h3>
        <button
          aria-label="Refresh Drive files"
          disabled={!connected || busy}
          onClick={refresh}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <div className="drive-files">
        {files.map((file) => (
          <article key={file.id}>
            <div>
              <b>{file.name}</b>
              <small>
                {file.modifiedTime &&
                  new Date(file.modifiedTime).toLocaleString()}
                {file.size && ` · ${(Number(file.size) / 1024).toFixed(0)} KB`}
              </small>
            </div>
            <button disabled={!connected || busy} onClick={() => restore(file)}>
              <FolderOpen size={14} /> Open
            </button>
          </article>
        ))}
        {!files.length && (
          <p className="muted">
            {connected
              ? "No session files saved by this app yet."
              : "Connect to see your saved session files."}
          </p>
        )}
      </div>
      <div className="drive-actions">
        {busy && operation.current && (
          <button onClick={() => operation.current?.abort()}>
            Cancel operation
          </button>
        )}
        <button disabled={busy} onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}
