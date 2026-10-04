import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRIVE_SCOPE,
  DriveAuthExpired,
  listDriveProjects,
  openDriveProject,
  saveDriveProject,
} from "./googleDrive";
afterEach(() => vi.unstubAllGlobals());
describe("Google Drive portable storage", () => {
  it("lists only app session archives with pagination", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          files: [{ id: "first", name: "one.apex.zip" }],
          nextPageToken: "next",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ files: [{ id: "second", name: "two.apex.zip" }] }),
      );
    vi.stubGlobal("fetch", fetch);
    expect((await listDriveProjects("test-token")).map((f) => f.id)).toEqual([
      "first",
      "second",
    ]);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("q")).toContain("apexProject");
    expect(url.searchParams.get("q")).toContain("trashed = false");
    expect(new URL(fetch.mock.calls[1][0]).searchParams.get("pageToken")).toBe(
      "next",
    );
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });
  it("uploads a video-free archive as a new file and confirms every resumable chunk", async () => {
    const location =
      "https://www.googleapis.com/upload/drive/v3/files?upload_id=fixture";
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { headers: { Location: location } }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 308,
          headers: { Range: "bytes=0-8388607" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ id: "saved", name: "Track day.apex.zip" }),
      );
    vi.stubGlobal("fetch", fetch);
    const progress: number[] = [];
    const blob = new Blob([new Uint8Array(9 * 1024 * 1024)]);
    expect(
      (
        await saveDriveProject("test-token", blob, "Track day", (p) =>
          progress.push(p),
        )
      ).id,
    ).toBe("saved");
    const metadata = JSON.parse(fetch.mock.calls[0][1].body);
    expect(metadata).toEqual({
      name: "Track day.apex.zip",
      mimeType: "application/zip",
      appProperties: { apexProject: "1" },
    });
    expect(fetch.mock.calls[1][1].headers["Content-Range"]).toBe(
      "bytes 0-8388607/9437184",
    );
    expect(fetch.mock.calls[2][1].body.size).toBe(1024 * 1024);
    expect(progress.at(-1)).toBe(1);
    expect(
      fetch.mock.calls.every((c) => ["POST", "PUT"].includes(c[1].method)),
    ).toBe(true);
  });
  it("never sends a token to an unexpected upload host", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(null, {
          headers: { Location: "https://example.com/upload" },
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveDriveProject("test-token", new Blob(["zip"]), "Track"),
    ).rejects.toThrow(/valid upload address/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("returns a local file for the normal project review path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("original archive")),
    );
    const file = await openDriveProject("test-token", {
      id: "file-id",
      name: "saved.apex.zip",
    });
    expect(file.name).toBe("saved.apex.zip");
    expect(await file.text()).toBe("original archive");
  });
  it("handles expired authorization and rejects malformed IDs or oversized archives", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(listDriveProjects("test-token")).rejects.toBeInstanceOf(
      DriveAuthExpired,
    );
    await expect(
      openDriveProject("test-token", { id: "../other", name: "a" }),
    ).rejects.toThrow(/Invalid Drive/);
    await expect(
      openDriveProject("test-token", {
        id: "valid",
        name: "a",
        size: String(513 * 1024 * 1024),
      }),
    ).rejects.toThrow(/too large/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
