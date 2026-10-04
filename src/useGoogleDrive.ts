import { useEffect, useRef, useState } from "react";
import {
  DRIVE_SCOPE,
  DriveAuthExpired,
  createDriveFolder,
  driveAccount,
  getDriveProject,
  listDriveProjects,
  loadGoogleIdentity,
  openDriveProject,
  saveDriveProject,
} from "./googleDrive";
import type { DriveFile, DriveAccount, GoogleIdentity } from "./googleDrive";
import {
  driveRevisionDigest,
  readDriveProfile,
  readDriveSession,
  writeDriveProfile,
  writeDriveSession,
} from "./drivePreferences";
import type { DrivePreferences, DriveSession } from "./drivePreferences";
import { loadGooglePicker, pickDriveFolder } from "./googlePicker";
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
const pickerKey = import.meta.env.VITE_GOOGLE_PICKER_API_KEY?.trim() ?? "";
export const DRIVE_AUTOSAVE_DELAY = 30_000;
export function useGoogleDrive({
  open,
  ready: workspaceReady,
  revision,
  onCreate,
  onOpen,
}: {
  open: boolean;
  ready: boolean;
  revision: string;
  onCreate: () => Promise<Blob>;
  onOpen: (file: File) => Promise<boolean>;
}) {
  const initial = useRef(readDriveSession(clientId));
  const profile = useRef(
    readDriveProfile(clientId, initial.current?.account.id),
  );
  const [account, setAccount] = useState<DriveAccount | undefined>(
    initial.current?.account || profile.current.account,
  );
  const [preferences, setPreferences] = useState<DrivePreferences>(
    profile.current.preferences,
  );
  const [session, setSession] = useState<DriveSession | undefined>(
    initial.current,
  );
  const [identityReady, setIdentityReady] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [digest, setDigest] = useState("");
  const client =
    useRef<ReturnType<GoogleIdentity["accounts"]["oauth2"]["initTokenClient"]>>(
      undefined,
    );
  const operation = useRef<AbortController>(undefined);
  const locked = useRef(false);
  const latest = useRef({
    session,
    account,
    preferences,
    revision,
    onCreate,
    onOpen,
    workspaceReady,
  });
  latest.current = {
    session,
    account,
    preferences,
    revision,
    onCreate,
    onOpen,
    workspaceReady,
  };
  function clearSession() {
    setSession(undefined);
    latest.current.session = undefined;
    writeDriveSession(clientId);
  }
  function accessToken() {
    const value = latest.current.session;
    if (!value || value.expires <= Date.now()) {
      clearSession();
      throw new DriveAuthExpired();
    }
    return value.token;
  }
  function report(e: unknown) {
    if (e instanceof DriveAuthExpired) clearSession();
    setError(
      e instanceof Error
        ? e.name === "AbortError"
          ? "Operation cancelled."
          : e.message
        : "Google Drive operation failed.",
    );
  }
  function patch(p: Partial<DrivePreferences>) {
    // Keep handlers in the same event in sync before React renders.
    const next = { ...latest.current.preferences, ...p };
    latest.current.preferences = next;
    setPreferences(next);
  }
  useEffect(() => {
    if (account) writeDriveProfile(clientId, account, preferences);
  }, [account, preferences]);
  useEffect(() => {
    let active = true;
    if (!workspaceReady) return;
    void driveRevisionDigest(revision)
      .then((d) => {
        if (active) setDigest(d);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [revision, workspaceReady]);
  useEffect(() => {
    if (!session) return;
    const t = setTimeout(
      clearSession,
      Math.max(0, session.expires - Date.now()),
    );
    return () => clearTimeout(t);
  }, [session]);
  async function run<T>(
    task: (signal: AbortSignal) => Promise<T>,
    clearError = true,
  ): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    if (clearError) setError("");
    const controller = new AbortController();
    operation.current = controller;
    try {
      return await task(controller.signal);
    } catch (e) {
      report(e);
      setStatus("");
    } finally {
      operation.current = undefined;
      locked.current = false;
      setBusy(false);
    }
  }
  async function refresh(clearError = true) {
    await run(async (signal) => {
      const files = await listDriveProjects(accessToken(), signal);
      patch({ files });
    }, clearError);
  }
  useEffect(() => {
    if (!(open || session) || !clientId) return;
    let active = true;
    void loadGoogleIdentity()
      .then((identity) => {
        if (!active) return;
        client.current = identity.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          include_granted_scopes: false,
          callback: (response) => {
            const expires = Number(response.expires_in);
            if (
              response.error ||
              !response.access_token ||
              !identity.accounts.oauth2.hasGrantedAllScopes(
                response,
                DRIVE_SCOPE,
              ) ||
              !Number.isFinite(expires) ||
              expires <= 30 ||
              expires > 86400
            ) {
              locked.current = false;
              setBusy(false);
              clearSession();
              setError(
                "Google Drive connection was not completed. Please allow access to the files this app creates.",
              );
              return;
            }
            const value = response.access_token;
            const controller = new AbortController();
            operation.current = controller;
            void (async () => {
              try {
                const who = await driveAccount(value, controller.signal);
                const restored = readDriveProfile(clientId, who.id);
                const connected = {
                  token: value,
                  expires: Date.now() + (expires - 30) * 1000,
                  account: who,
                };
                latest.current.session = connected;
                latest.current.account = who;
                latest.current.preferences = restored.preferences;
                setAccount(who);
                setPreferences(restored.preferences);
                setSession(connected);
                writeDriveSession(clientId, connected);
                writeDriveProfile(clientId, who, restored.preferences);
                setStatus(`Connected as ${who.name}.`);
                const files = await listDriveProjects(value, controller.signal);
                patch({ files });
              } catch (e) {
                report(e);
              } finally {
                operation.current = undefined;
                locked.current = false;
                setBusy(false);
              }
            })();
          },
          error_callback: () => {
            locked.current = false;
            setBusy(false);
            setError(
              "Google sign-in was closed or blocked. Try connecting again.",
            );
          },
        });
        setIdentityReady(true);
        if (open && latest.current.session && !locked.current)
          void refresh(false);
      })
      .catch(report);
    if (open && pickerKey) void loadGooglePicker().catch(() => {});
    return () => {
      active = false;
    };
  }, [open, Boolean(session)]);
  function connect(switchAccount = false) {
    if (!client.current || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    client.current.requestAccessToken({
      prompt: switchAccount || !latest.current.account ? "select_account" : "",
    });
  }
  async function save(newCopy = false) {
    let succeeded = false;
    await run(async (signal) => {
      if (!latest.current.workspaceReady)
        throw Error("Wait for your local sessions to finish loading.");
      const snapshot = latest.current;
      const token = accessToken();
      setStatus("Preparing telemetry and saved video timing…");
      const archive = await snapshot.onCreate();
      const savedDigest = await driveRevisionDigest(snapshot.revision);
      const target = newCopy ? undefined : snapshot.preferences.target;
      const result = await saveDriveProject(
        token,
        archive,
        snapshot.preferences.name,
        (p) => setStatus(`Saving to Drive · ${Math.round(p * 100)}%`),
        signal,
        { folderId: snapshot.preferences.folder?.id, target },
      );
      // The upload response normally contains version. Fetch it if unavailable.
      const saved = result.version
        ? result
        : await getDriveProject(token, result.id, signal);
      patch({
        target: saved,
        lastSavedAt: Date.now(),
        lastSavedDigest: savedDigest,
        files: [
          saved,
          ...latest.current.preferences.files.filter((f) => f.id !== saved.id),
        ],
      });
      setStatus(`Saved ${saved.name}. Video timing included.`);
      succeeded = true;
    });
    return succeeded;
  }
  useEffect(() => {
    if (
      !workspaceReady ||
      !session ||
      !preferences.autoSave ||
      !preferences.target ||
      busy ||
      !digest ||
      (digest === preferences.lastSavedDigest &&
        preferences.target.name ===
          preferences.name.trim().replace(/\.apex\.zip$/i, "") + ".apex.zip")
    )
      return;
    const timer = setTimeout(() => {
      void save().then((ok) => {
        if (!ok) patch({ autoSave: false });
      });
    }, DRIVE_AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [
    digest,
    workspaceReady,
    session,
    preferences.autoSave,
    preferences.target?.id,
    preferences.lastSavedDigest,
    preferences.name,
    busy,
  ]);
  async function restore(file: DriveFile) {
    let restored = false;
    await run(async (signal) => {
      const token = accessToken();
      setStatus(`Opening ${file.name}…`);
      const remote = await getDriveProject(token, file.id, signal);
      const local = await openDriveProject(token, remote, signal);
      // Pause autosave throughout review; cancellation must not change the save target.
      const wasAuto = latest.current.preferences.autoSave;
      patch({ autoSave: false });
      restored = await latest.current.onOpen(local);
      if (restored) {
        patch({
          target: remote,
          name: remote.name.replace(/\.apex\.zip$/i, ""),
          folder: remote.parents?.[0]
            ? {
                id: remote.parents[0],
                name:
                  latest.current.preferences.folder?.id === remote.parents[0]
                    ? latest.current.preferences.folder.name
                    : "Saved file's folder",
              }
            : undefined,
          lastSavedDigest: undefined,
          autoSave: false,
        });
        setStatus(
          "Session restored with saved video timing. Relink the original videos to play them.",
        );
      } else {
        patch({ autoSave: wasAuto });
        setStatus("Import cancelled. Your current Drive file is unchanged.");
      }
    });
    return restored;
  }
  async function chooseFolder() {
    await run(async () => {
      if (!pickerKey)
        throw Error(
          "Folder browsing is not configured. Create a new folder below instead.",
        );
      const folder = await pickDriveFolder(
        accessToken(),
        pickerKey,
        clientId.split("-")[0],
      );
      if (folder) {
        patch({
          folder,
          target: undefined,
          autoSave: false,
          lastSavedAt: undefined,
          lastSavedDigest: undefined,
        });
        setStatus(`Next save will create a session file in ${folder.name}.`);
      }
    });
  }
  async function newFolder(name: string) {
    await run(async (signal) => {
      const folder = await createDriveFolder(accessToken(), name, signal);
      patch({
        folder,
        target: undefined,
        autoSave: false,
        lastSavedAt: undefined,
        lastSavedDigest: undefined,
      });
      setStatus(`Created ${folder.name}. Next save will use this folder.`);
    });
  }
  function useMyDrive() {
    patch({
      folder: undefined,
      target: undefined,
      autoSave: false,
      lastSavedAt: undefined,
      lastSavedDigest: undefined,
    });
  }
  function disconnect() {
    operation.current?.abort();
    clearSession();
    patch({ autoSave: false });
    setStatus(
      "Disconnected. Your folder and saved-file list are remembered on this device.",
    );
  }
  return {
    configured: Boolean(clientId),
    pickerConfigured: Boolean(pickerKey),
    identityReady,
    connected: Boolean(session),
    busy,
    account,
    preferences,
    error,
    status,
    dirty: Boolean(
      digest &&
      (digest !== preferences.lastSavedDigest ||
        (preferences.target &&
          preferences.target.name !==
            preferences.name.trim().replace(/\.apex\.zip$/i, "") +
              ".apex.zip")),
    ),
    patch,
    refresh,
    connect,
    save,
    restore,
    chooseFolder,
    newFolder,
    useMyDrive,
    disconnect,
    cancel: () => operation.current?.abort(),
  };
}
export type GoogleDriveController = ReturnType<typeof useGoogleDrive>;
