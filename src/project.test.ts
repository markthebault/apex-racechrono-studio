import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createProject, readProject } from "./storage";
import { matchProjectVideos } from "./projectVideos";
import type { Session, Settings, SyncFile } from "./model";
const id = "a".repeat(64),
  video = "b".repeat(64);
const session: Session = {
  id,
  filename: "recording.vbo",
  size: 4,
  format: "vbo",
  track: "Circuit",
  trackId: 42,
  start: 1000,
  end: 2000,
  importedOptimal: NaN,
  times: new Float64Array([1000, 2000]),
  lat: new Float64Array([50, 50.01]),
  lon: new Float64Array([6, 6.01]),
  channels: [],
  laps: [],
  unknown: [],
};
const settings: Settings = {
  speedUnit: "km/h",
  colors: ["#ff0000", "#0000ff"],
  videoHeight: 280,
  a: "",
  b: "",
  charts: [],
  excluded: [],
  included: [],
  layouts: [],
  mode: "distance",
  mapHeight: 300,
  collection: [],
};
const sync: SyncFile = {
  format: "apex-sync",
  version: 1,
  bindings: [
    {
      session: { sha256: id, name: session.filename, size: 4 },
      clips: [
        {
          sha256: video,
          name: "original.insv",
          size: 50,
          duration: 10,
          start: 0,
          motion: { camera: "insta360", axis: 1, invert: true, baseline: 0.2 },
        },
      ],
      anchors: [{ videoSeconds: 0, sessionTimestamp: 1000 }],
    },
  ],
};
const bytes = new Uint8Array([0, 255, 0, 17]);
const pack = async () =>
  createProject(settings, sync, [{ session, file: new Blob([bytes]) }]);
describe("portable session archives", () => {
  it("preserves original bytes and camera sync while excluding all video bytes and handles", async () => {
    const archive = unzipSync(
      new Uint8Array(await (await pack()).arrayBuffer()),
    );
    expect(Object.keys(archive)).toEqual([
      "project.json",
      `sessions/${id}.vbo`,
    ]);
    expect(archive[`sessions/${id}.vbo`]).toEqual(bytes);
    const manifest = JSON.parse(strFromU8(archive["project.json"]));
    expect(manifest.sync).toEqual(sync);
    expect(manifest.sessions[0].track).toBe("Circuit");
    expect(JSON.stringify(manifest)).not.toContain("blob:");
  });
  it("reads without committing anything and preserves original recordings on the next export", async () => {
    const project = await readProject(
      new File([await pack()], "project.apex.zip"),
      async (f) => {
        expect(new Uint8Array(await f.arrayBuffer())).toEqual(bytes);
        return { ...session, track: "Unknown", trackId: 0 };
      },
    );
    expect(project.records[0].session.track).toBe("Circuit");
    const roundtrip = await createProject(
      project.manifest.settings,
      project.manifest.sync,
      project.records,
    );
    expect(
      unzipSync(new Uint8Array(await roundtrip.arrayBuffer()))[
        `sessions/${id}.vbo`
      ],
    ).toEqual(bytes);
  });
  it("rejects session hash mismatches and malformed manifests", async () => {
    await expect(
      readProject(new File([await pack()], "a.zip"), async () => ({
        ...session,
        id: video,
      })),
    ).rejects.toThrow(/hash mismatch/);
    const bad = zipSync({ "project.json": strToU8('{"format":"other"}') });
    await expect(
      readProject(new File([bad as BlobPart], "a.zip")),
    ).rejects.toThrow(/Unsupported/);
  });
  it("links originals by hash even when renamed and reports a different recording", async () => {
    const original = new File(["video"], "renamed.insv"),
      wrong = new File(["other"], "wrong.mp4");
    const result = await matchProjectVideos(
      [original, wrong],
      sync,
      async (f) => (f === original ? video : id),
    );
    expect(result.matched).toEqual({ [video]: original });
    expect(result.unmatched).toEqual(["wrong.mp4"]);
    expect(sync.bindings[0].anchors).toEqual([
      { videoSeconds: 0, sessionTimestamp: 1000 },
    ]);
  });
});
