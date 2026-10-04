import "fake-indexeddb/auto";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import type { Session, Settings, SyncFile } from "./model";
import {
  commitProject,
  getHandle,
  load,
  removeSession,
  saveHandle,
} from "./storage";

const session = (id: string): Session => ({
  id,
  filename: `${id}.rcz`,
  size: 3,
  track: "Test circuit",
  trackId: 1,
  start: 1000,
  end: 3000,
  importedOptimal: NaN,
  times: Float64Array.from([1000, 2000, 3000]),
  lat: Float64Array.from([50, 50.001, 50]),
  lon: Float64Array.from([6, 6.001, 6]),
  channels: [],
  laps: [{ id: `${id}:1`, number: 1, start: 1000, end: 3000, issues: [] }],
  unknown: [],
});
const settings: Settings = {
  speedUnit: "mph",
  colors: ["#63e5d2", "#f8a36b"],
  videoHeight: 280,
  a: "remove:1",
  b: "remove:1",
  charts: [{ id: "speed", channels: ["speed"], height: 135 }],
  excluded: ["remove:1", "keep:1"],
  included: ["remove:9", "keep:2"],
  layouts: ["remove:1", "remove:9", "keep:1"].map((referenceId) => ({
    id: referenceId,
    name: "Custom sectors",
    referenceId,
    gates: [0, 50, 100],
    generated: false,
  })),
  mode: "distance",
  mapHeight: 340,
  collection: ["remove", "keep"],
  extras: [
    { id: "remove:1", color: "#c792ea" },
    { id: "keep:1", color: "#f2d15b" },
    { id: "optimal", color: "#7fb2ff" },
  ],
};
const sync: SyncFile = {
  format: "apex-sync",
  version: 1,
  bindings: ["remove", "keep"].map((id) => ({
    session: { sha256: id, name: `${id}.rcz`, size: 3 },
    clips: [id, "shared"].map((sha256) => ({
      sha256,
      name: `${sha256}.mp4`,
      size: 1,
      duration: 2,
      start: sha256 === "shared" ? 2 : 0,
    })),
    anchors: [{ videoSeconds: 0, sessionTimestamp: 1000 }],
  })),
};

beforeEach(async () => {
  const d = await openDB("apex-studio", 1);
  const tx = d.transaction(["sessions", "state", "handles"], "readwrite");
  for (const store of tx.objectStoreNames) await tx.objectStore(store).clear();
  await tx.done;
  d.close();
});

describe("session removal", () => {
  async function seed() {
    const removed = session("remove"),
      kept = session("keep");
    await commitProject(
      [removed, kept].map((s) => ({ session: s, file: new Blob([s.id]) })),
      settings,
      sync,
    );
    await saveHandle("remove", { name: "removed video" });
    await saveHandle("shared", { name: "shared video" });
    await saveHandle("keep", { name: "kept video" });
    return { removed, kept };
  }

  it("deletes the stored recording and its references while preserving other sessions and shared videos", async () => {
    const { removed, kept } = await seed();
    const next = await removeSession(removed, settings, sync);
    const saved = await load();
    expect(saved.records.map((r) => r.session.id)).toEqual([kept.id]);
    expect(await saved.records[0].file.text()).toBe("keep");
    expect(saved.settings).toEqual(next.settings);
    expect(saved.settings).toMatchObject({
      a: "",
      b: "",
      collection: ["keep"],
      excluded: ["keep:1"],
      included: ["keep:2"],
      layouts: [settings.layouts[2]],
      extras: settings.extras!.slice(1),
      charts: settings.charts,
      speedUnit: "mph",
    });
    expect(saved.sync).toEqual({ ...sync, bindings: [sync.bindings[1]] });
    expect(next.removedVideos).toEqual(["remove"]);
    expect(await getHandle("remove")).toBeUndefined();
    expect(await getHandle("shared")).toEqual({ name: "shared video" });
    expect(await getHandle("keep")).toEqual({ name: "kept video" });
    // Project exports use this same stored collection, so deleted bytes are gone too.
    expect(saved.records.some((r) => r.session.id === removed.id)).toBe(false);
  });

  it("keeps remaining selected laps and the optimal comparison when removing an unselected session", async () => {
    const { removed } = await seed();
    const selected = {
      ...settings,
      a: "keep:1",
      b: "optimal",
      collection: ["keep"],
    };
    const next = await removeSession(removed, selected, sync);
    expect(next.settings).toMatchObject({
      a: "keep:1",
      b: "optimal",
      collection: ["keep"],
    });
    expect(next.settings.extras!.map((lap) => lap.id)).toEqual([
      "keep:1",
      "optimal",
    ]);
  });

  it("allows removing the last selected session and the last stored session", async () => {
    const { removed, kept } = await seed();
    const next = await removeSession(
      removed,
      { ...settings, collection: ["remove"] },
      sync,
    );
    expect(next.settings.collection).toEqual([]);
    const empty = await removeSession(
      kept,
      { ...next.settings, a: "keep:1" },
      next.sync,
    );
    const saved = await load();
    expect(saved.records).toEqual([]);
    expect(saved.settings?.a).toBe("");
    expect(saved.settings?.extras).toEqual([
      { id: "optimal", color: "#7fb2ff" },
    ]);
    expect(saved.sync?.bindings).toEqual([]);
    expect(empty.removedVideos).toEqual(["keep", "shared"]);
    expect(await getHandle("shared")).toBeUndefined();
  });

  it("rolls back deletion if saving the cleaned settings fails", async () => {
    const { removed } = await seed();
    const invalidSettings = { ...settings, uncloneable: () => {} };
    await expect(
      removeSession(removed, invalidSettings, sync),
    ).rejects.toThrow();
    const saved = await load();
    expect(saved.records.map((r) => r.session.id)).toEqual(["keep", "remove"]);
    expect(saved.settings).toEqual(settings);
    expect(saved.sync).toEqual(sync);
    expect(await getHandle("remove")).toEqual({ name: "removed video" });
  });
});
