import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyDrivePreferences,
  readDriveProfile,
  writeDriveProfile,
  readDriveSession,
  writeDriveSession,
  driveRevisionDigest,
} from "./drivePreferences";
function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => entries.set(k, v),
    removeItem: (k: string) => entries.delete(k),
    entries,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe("remembered Drive workspace", () => {
  it("remembers each account's folder, file, autosave and file list separately", () => {
    const local = storage();
    vi.stubGlobal("localStorage", local);
    const a = { id: "account-a", name: "A" },
      b = { id: "account-b", name: "B" };
    writeDriveProfile("client", a, {
      ...emptyDrivePreferences(),
      folder: { id: "folder-a", name: "Apex" },
      target: { id: "file-a", name: "Lap.apex.zip", version: "5" },
      autoSave: true,
      files: [{ id: "file-a", name: "Lap.apex.zip" }],
    });
    writeDriveProfile("client", b, {
      ...emptyDrivePreferences(),
      folder: { id: "folder-b", name: "Other" },
    });
    expect(readDriveProfile("client").account?.id).toBe(b.id);
    const restored = readDriveProfile("client", a.id).preferences;
    expect(restored.folder?.id).toBe("folder-a");
    expect(restored.target?.version).toBe("5");
    expect(restored.autoSave).toBe(true);
    expect(restored.files).toHaveLength(1);
    expect(readDriveProfile("other-client").account).toBeUndefined();
  });
  it("retains an unexpired token across refreshes only in tab session storage", () => {
    const tab = storage(),
      local = storage();
    vi.stubGlobal("sessionStorage", tab);
    vi.stubGlobal("localStorage", local);
    const session = {
      token: "short-lived-test-token",
      expires: Date.now() + 3600_000,
      account: { id: "a", name: "A" },
    };
    writeDriveSession("client", session);
    expect(readDriveSession("client")).toEqual(session);
    expect(local.entries.size).toBe(0);
    writeDriveSession("client");
    expect(readDriveSession("client")).toBeUndefined();
  });
  it("discards expired tokens and tokens issued for a different OAuth client", () => {
    const tab = storage();
    vi.stubGlobal("sessionStorage", tab);
    writeDriveSession("client", {
      token: "expired",
      expires: Date.now() - 1,
      account: { id: "a", name: "A" },
    });
    expect(readDriveSession("client")).toBeUndefined();
    expect(tab.entries.size).toBe(0);
    writeDriveSession("old-client", {
      token: "other",
      expires: Date.now() + 3600_000,
      account: { id: "a", name: "A" },
    });
    expect(readDriveSession("client")).toBeUndefined();
  });
  it("tracks changes in video synchronization anchors", async () => {
    const before = JSON.stringify({
      sync: {
        bindings: [{ anchors: [{ videoSeconds: 0, sessionTimestamp: 1000 }] }],
      },
    });
    const after = JSON.stringify({
      sync: {
        bindings: [{ anchors: [{ videoSeconds: 2, sessionTimestamp: 1000 }] }],
      },
    });
    expect(await driveRevisionDigest(before)).not.toBe(
      await driveRevisionDigest(after),
    );
  });
  it("ignores damaged cached data and strips unknown fields", () => {
    const local = storage();
    vi.stubGlobal("localStorage", local);
    local.setItem("apex.drive.profile.v1", "broken");
    expect(readDriveProfile("client").preferences.autoSave).toBe(false);
    local.setItem(
      "apex.drive.profile.v1",
      JSON.stringify({
        client: {
          lastAccount: "a",
          accounts: {
            a: {
              account: { id: "a", name: "A" },
              preferences: {
                files: [{ id: "f", name: "Lap", access_token: "never-retain" }],
                target: { id: "../other", name: "bad" },
              },
            },
          },
        },
      }),
    );
    const restored = readDriveProfile("client");
    expect(restored.preferences.target).toBeUndefined();
    expect(JSON.stringify(restored)).not.toContain("never-retain");
  });
});
