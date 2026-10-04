import type { DriveAccount, DriveFile, DriveFolder } from "./googleDrive";
export type DrivePreferences = {
  name: string;
  folder?: DriveFolder;
  target?: DriveFile;
  files: DriveFile[];
  autoSave: boolean;
  lastSavedAt?: number;
  lastSavedDigest?: string;
};
export type DriveSession = {
  token: string;
  expires: number;
  account: DriveAccount;
};
const profileKey = "apex.drive.profile.v1";
const sessionKey = "apex.drive.session.v1";
const validId = (id: unknown) =>
  typeof id === "string" && /^[\w-]{1,256}$/.test(id);
export function emptyDrivePreferences(): DrivePreferences {
  return {
    name: "Track day " + new Date().toISOString().slice(0, 10),
    files: [],
    autoSave: false,
  };
}
function cleanFile(f: any): DriveFile | undefined {
  if (!validId(f?.id) || typeof f.name !== "string") return;
  return {
    id: f.id,
    name: f.name.slice(0, 200),
    ...(typeof f.version === "string" && /^\d+$/.test(f.version)
      ? { version: f.version }
      : {}),
    ...(typeof f.size === "string" ? { size: f.size } : {}),
    ...(typeof f.modifiedTime === "string"
      ? { modifiedTime: f.modifiedTime }
      : {}),
    ...(Array.isArray(f.parents) ? { parents: f.parents.filter(validId) } : {}),
  };
}
export function readDriveProfile(
  clientId: string,
  accountId?: string,
): { account?: DriveAccount; preferences: DrivePreferences } {
  try {
    const all = JSON.parse(localStorage.getItem(profileKey) || "{}");
    const profile = all[clientId];
    const entry = profile?.accounts?.[accountId || profile.lastAccount];
    if (!validId(entry?.account?.id))
      return { preferences: emptyDrivePreferences() };
    const p = entry.preferences;
    return {
      account: {
        id: entry.account.id,
        name: String(entry.account.name || "Google account").slice(0, 120),
      },
      preferences: {
        ...emptyDrivePreferences(),
        name:
          typeof p?.name === "string"
            ? p.name.slice(0, 180)
            : emptyDrivePreferences().name,
        ...(validId(p?.folder?.id) && typeof p.folder.name === "string"
          ? { folder: { id: p.folder.id, name: p.folder.name.slice(0, 180) } }
          : {}),
        target: cleanFile(p?.target),
        files: Array.isArray(p?.files)
          ? p.files.map(cleanFile).filter(Boolean).slice(0, 1000)
          : [],
        autoSave: p?.autoSave === true,
        ...(Number.isFinite(p?.lastSavedAt)
          ? { lastSavedAt: p.lastSavedAt }
          : {}),
        ...(/^[a-f0-9]{64}$/.test(p?.lastSavedDigest)
          ? { lastSavedDigest: p.lastSavedDigest }
          : {}),
      },
    };
  } catch {
    return { preferences: emptyDrivePreferences() };
  }
}
export function writeDriveProfile(
  clientId: string,
  account: DriveAccount,
  preferences: DrivePreferences,
) {
  try {
    const all = JSON.parse(localStorage.getItem(profileKey) || "{}");
    const previous = all[clientId];
    all[clientId] = {
      lastAccount: account.id,
      accounts: {
        ...previous?.accounts,
        [account.id]: { account, preferences },
      },
    };
    localStorage.setItem(profileKey, JSON.stringify(all));
  } catch {
    /* Storage may be disabled. Drive itself still works. */
  }
}
export function readDriveSession(clientId: string): DriveSession | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    if (
      saved?.clientId === clientId &&
      typeof saved.token === "string" &&
      validId(saved.account?.id) &&
      saved.expires > Date.now() &&
      saved.expires <= Date.now() + 86400_000
    ) {
      return {
        token: saved.token,
        expires: saved.expires,
        account: saved.account,
      };
    }
    sessionStorage.removeItem(sessionKey);
  } catch {
    /* Token persistence is optional. */
  }
}
export function writeDriveSession(clientId: string, session?: DriveSession) {
  try {
    if (session)
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify({ clientId, ...session }),
      );
    else sessionStorage.removeItem(sessionKey);
  } catch {
    /* Continue with the in-memory token. */
  }
}
export async function driveRevisionDigest(revision: string) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(revision),
  );
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
