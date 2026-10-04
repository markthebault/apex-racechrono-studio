export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const api = "https://www.googleapis.com/drive/v3";
const uploadApi = "https://www.googleapis.com/upload/drive/v3/files";
const fields = "id,name,modifiedTime,size,version,parents";
export type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
  version?: string;
  parents?: string[];
};
export type DriveFolder = { id: string; name: string };
export type DriveAccount = { id: string; name: string };
export class DriveConflict extends Error {
  constructor() {
    super(
      "This Drive file changed elsewhere. Open the latest copy or save a new copy to keep both versions.",
    );
  }
}
export class DriveAuthExpired extends Error {
  constructor() {
    super("Your Google Drive connection expired. Connect again to continue.");
  }
}
function fileId(id: string) {
  if (!/^[\w-]{1,256}$/.test(id)) throw Error("Invalid Drive file ID.");
  return id;
}
async function check(response: Response) {
  if (response.status === 409 || response.status === 412)
    throw new DriveConflict();
  if (response.status === 401) throw new DriveAuthExpired();
  if (response.status === 403)
    throw Error(
      "Google Drive access was denied. Check the connection and try again.",
    );
  if (response.status === 404)
    throw Error("This Google Drive file is no longer available.");
  if (!response.ok)
    throw Error(`Google Drive returned ${response.status}. Try again.`);
  return response;
}
export async function listDriveProjects(
  token: string,
  signal?: AbortSignal,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken = "";
  for (let page = 0; page < 100; page++) {
    const q = new URLSearchParams({
      q: "trashed = false and appProperties has { key='apexProject' and value='1' }",
      fields: `nextPageToken,files(${fields})`,
      pageSize: "100",
      orderBy: "modifiedTime desc",
      ...(pageToken ? { pageToken } : {}),
    });
    const response = await check(
      await fetch(`${api}/files?${q}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      }),
    );
    const data = await response.json();
    if (!Array.isArray(data.files))
      throw Error("Invalid Google Drive file list.");
    for (const file of data.files)
      if (typeof file.id === "string" && typeof file.name === "string")
        files.push(file);
    if (!data.nextPageToken) return files;
    pageToken = data.nextPageToken;
  }
  throw Error("Too many saved Drive files. Open a smaller collection.");
}
export async function driveAccount(
  token: string,
  signal?: AbortSignal,
): Promise<DriveAccount> {
  const response = await check(
    await fetch(`${api}/about?fields=user(permissionId,displayName)`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    }),
  );
  const { user } = await response.json();
  if (!user?.permissionId)
    throw Error("Google Drive did not identify the connected account.");
  return { id: user.permissionId, name: user.displayName || "Google account" };
}
export async function getDriveProject(
  token: string,
  id: string,
  signal?: AbortSignal,
): Promise<DriveFile> {
  const response = await check(
    await fetch(
      `${api}/files/${fileId(id)}?fields=${fields},appProperties,trashed`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      },
    ),
  );
  const file = await response.json();
  if (file.trashed || file.appProperties?.apexProject !== "1" || !file.version)
    throw Error("This is not an available Apex Studio session file.");
  return file;
}
export async function createDriveFolder(
  token: string,
  name: string,
  signal?: AbortSignal,
): Promise<DriveFolder> {
  if (!name.trim()) throw Error("Enter a folder name.");
  const response = await check(
    await fetch(`${api}/files?fields=id,name`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: name.trim().slice(0, 180),
        mimeType: "application/vnd.google-apps.folder",
      }),
      signal,
    }),
  );
  const folder = await response.json();
  if (!folder?.id || !folder?.name)
    throw Error("Google Drive did not create the folder.");
  return folder;
}
export async function saveDriveProject(
  token: string,
  blob: Blob,
  name: string,
  onProgress?: (n: number) => void,
  signal?: AbortSignal,
  options: { folderId?: string; target?: DriveFile } = {},
): Promise<DriveFile> {
  if (!name.trim()) throw Error("Enter a file name.");
  const target = options.target;
  if (target) {
    if (!target.version) throw new DriveConflict();
    const current = await getDriveProject(token, target.id, signal);
    if (current.version !== target.version) throw new DriveConflict();
  }
  if (!blob.size || blob.size > 512 * 1024 * 1024)
    throw Error("The session archive is empty or too large.");
  const response = await check(
    await fetch(
      `${uploadApi}${target ? "/" + fileId(target.id) : ""}?uploadType=resumable&fields=${fields}`,
      {
        method: target ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "application/zip",
          "X-Upload-Content-Length": String(blob.size),
        },
        body: JSON.stringify({
          name: name.trim().replace(/\.apex\.zip$/i, "") + ".apex.zip",
          ...(!target
            ? {
                mimeType: "application/zip",
                appProperties: { apexProject: "1" },
                ...(options.folderId
                  ? { parents: [fileId(options.folderId)] }
                  : {}),
              }
            : {}),
        }),
        signal,
      },
    ),
  );
  const location = response.headers.get("Location");
  if (
    !location ||
    !/^https:\/\/www\.googleapis\.com\/(?:upload|resumable\/upload)\/drive\/v3\/files(?:\?|\/)/.test(
      location,
    )
  )
    throw Error("Google Drive did not provide a valid upload address.");
  const chunkSize = 8 * 1024 * 1024;
  for (let start = 0; start < blob.size; start += chunkSize) {
    const end = Math.min(start + chunkSize, blob.size);
    const chunk = await fetch(location, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/zip",
        "Content-Range": `bytes ${start}-${end - 1}/${blob.size}`,
      },
      body: blob.slice(start, end),
      signal,
    });
    if (chunk.status === 308 && end < blob.size) {
      const range = chunk.headers.get("Range");
      if (range !== `bytes=0-${end - 1}`)
        throw Error(
          "Google Drive did not confirm the upload chunk. Save again to retry.",
        );
    } else {
      await check(chunk);
      if (end !== blob.size)
        throw Error("Google Drive ended the upload early.");
      const result = await chunk.json();
      if (!result?.id || !result?.name)
        throw Error("Invalid Google Drive save response.");
      onProgress?.(1);
      return result;
    }
    onProgress?.(end / blob.size);
  }
  throw Error("Google Drive upload did not finish.");
}
export async function openDriveProject(
  token: string,
  file: DriveFile,
  signal?: AbortSignal,
): Promise<File> {
  if (Number(file.size) > 512 * 1024 * 1024)
    throw Error("This saved session archive is too large.");
  const response = await check(
    await fetch(`${api}/files/${fileId(file.id)}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    }),
  );
  const blob = await response.blob();
  if (blob.size > 512 * 1024 * 1024)
    throw Error("This saved session archive is too large.");
  return new File(
    [blob],
    file.name.endsWith(".zip") ? file.name : file.name + ".apex.zip",
    { type: "application/zip" },
  );
}
export type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  scope?: string;
};
export type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        include_granted_scopes: boolean;
        callback: (r: GoogleTokenResponse) => void;
        error_callback: () => void;
      }) => { requestAccessToken: (options: { prompt: string }) => void };
      hasGrantedAllScopes: (r: GoogleTokenResponse, scope: string) => boolean;
    };
  };
};
let identityPromise: Promise<GoogleIdentity> | undefined;
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  const existing = (window as unknown as { google?: GoogleIdentity }).google;
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);
  if (identityPromise) return identityPromise;
  identityPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const fail = () => {
      script.remove();
      identityPromise = undefined;
      reject(
        Error(
          "Google sign-in could not load. Check your connection and try again.",
        ),
      );
    };
    const timer = setTimeout(fail, 15_000);
    script.onerror = () => {
      clearTimeout(timer);
      fail();
    };
    script.onload = () => {
      clearTimeout(timer);
      const identity = (window as unknown as { google?: GoogleIdentity })
        .google;
      if (identity?.accounts?.oauth2) resolve(identity);
      else fail();
    };
    document.head.append(script);
  });
  return identityPromise;
}
