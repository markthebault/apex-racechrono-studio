import type { DriveFolder } from "./googleDrive";
type View = {
  setIncludeFolders(v: boolean): View;
  setSelectFolderEnabled(v: boolean): View;
  setMimeTypes(v: string): View;
};
type Picker = { setVisible(v: boolean): void; dispose(): void };
type Builder = {
  addView(v: View): Builder;
  setOAuthToken(t: string): Builder;
  setDeveloperKey(k: string): Builder;
  setAppId(id: string): Builder;
  setOrigin(origin: string): Builder;
  setTitle(title: string): Builder;
  setCallback(
    fn: (data: {
      action: string;
      docs?: { id: string; name: string; mimeType?: string }[];
    }) => void,
  ): Builder;
  build(): Picker;
};
type PickerApi = {
  DocsView: new () => View;
  PickerBuilder: new () => Builder;
  Action: { PICKED: string; CANCEL: string };
};
type PickerWindow = Window & {
  google?: { picker?: PickerApi };
  gapi?: {
    load: (
      name: string,
      options: {
        callback: () => void;
        onerror: () => void;
        timeout: number;
        ontimeout: () => void;
      },
    ) => void;
  };
};
let loading: Promise<PickerApi> | undefined;
export function loadGooglePicker(): Promise<PickerApi> {
  const w = window as PickerWindow;
  if (w.google?.picker) return Promise.resolve(w.google.picker);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = undefined;
      reject(
        Error(
          "Google folder picker could not load. Try again or create a new folder.",
        ),
      );
    };
    const timer = setTimeout(fail, 20_000);
    script.onerror = fail;
    script.onload = () => {
      if (!w.gapi) return fail();
      w.gapi.load("picker", {
        callback: () => {
          clearTimeout(timer);
          if (w.google?.picker) resolve(w.google.picker);
          else fail();
        },
        onerror: fail,
        timeout: 15_000,
        ontimeout: fail,
      });
    };
    document.head.append(script);
  });
  return loading;
}
export async function pickDriveFolder(
  token: string,
  apiKey: string,
  appId: string,
): Promise<DriveFolder | undefined> {
  const api = await loadGooglePicker();
  return new Promise((resolve, reject) => {
    const view = new api.DocsView()
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes("application/vnd.google-apps.folder");
    const picker = new api.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setOrigin(window.location.origin)
      .setTitle("Choose where Apex Studio saves sessions")
      .setCallback((data) => {
        if (data.action === api.Action.CANCEL) {
          picker.dispose();
          resolve(undefined);
        }
        if (data.action === api.Action.PICKED) {
          const folder = data.docs?.[0];
          picker.dispose();
          if (
            !folder ||
            !/^[\w-]{1,256}$/.test(folder.id) ||
            typeof folder.name !== "string" ||
            (folder.mimeType &&
              folder.mimeType !== "application/vnd.google-apps.folder")
          ) {
            reject(Error("Choose a Google Drive folder."));
            return;
          }
          resolve({ id: folder.id, name: folder.name });
        }
      })
      .build();
    picker.setVisible(true);
  });
}
