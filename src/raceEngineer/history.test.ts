import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import {
  captureHistory,
  historyKey,
  restoreHistory,
  replyMessages,
  type Entry,
} from "./history";
import { readState, saveState, writeEngineerCache } from "../storage";
import { type Report, type Snapshot } from "./contracts";
import {
  loadReviewScope,
  saveReviewScope,
  selectedReviewLaps,
} from "./reviewScope";
import { cornerPrompt } from "./provider";
import { reviewPrompt } from "./service";
import { plainEnglishPrompt } from "./coachingStyle";

const snapshot: Snapshot = {
  version: 1,
  algorithm: "test",
  id: "history-analysis",
  referenceId: "lap-a",
  sessionIds: ["history-session"],
  contexts: {},
  capabilities: {},
  laps: [],
  evidence: [],
  corners: [
    { id: "corner-a", name: "Turn 1", start: 0, end: 100, direction: "left" },
  ],
  priorities: [],
  envelope: {
    status: "unavailable",
    bins: [],
    method: "none",
    limitations: [],
  },
  modeled: { status: "unavailable", reasons: [] },
  warnings: [],
};
const report: Report = {
  format: "apex-engineer-report",
  version: 1,
  snapshotId: snapshot.id,
  summary: "Keep one familiar approach.",
  priorities: [],
};
const entries: Entry[] = [
  { question: "Review this corner", report },
  { question: "Why?", text: "The cause is still unknown.", scope: "corner-a" },
  {
    question: "What changed overall?",
    text: "We need more comparable laps.",
    scope: "session",
  },
];
const captured = () =>
  captureHistory(snapshot, entries, report, "corners", "corner-a");

describe("automatic engineer history", () => {
  it("restores the combined report, replies and selected view from durable browser storage", async () => {
    await saveState(historyKey(snapshot.id), captured());
    const stored = await readState(historyKey(snapshot.id));
    const reopened = restoreHistory(stored, snapshot)!;
    expect(reopened).toMatchObject({ view: "corners", cornerId: "corner-a" });
    expect(reopened.entries[0].report).toEqual(report);
    expect(reopened.entries.slice(1)).toEqual(entries.slice(1));
    expect(
      restoreHistory(await readState(historyKey("different-analysis")), {
        ...snapshot,
        id: "different-analysis",
      }),
    ).toBeUndefined();
    expect(() =>
      restoreHistory(stored, { ...snapshot, id: "different-analysis" }),
    ).toThrow();
  });

  it("rejects stale sources, malformed records and replies from unavailable corners", () => {
    expect(() =>
      restoreHistory(
        { ...captured(), sessionIds: ["other-session"] },
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      restoreHistory(
        { ...captured(), report: { ...report, snapshotId: "old" } },
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      restoreHistory(
        {
          ...captured(),
          replies: [
            { question: "Why?", text: "Old answer", scope: "deleted-corner" },
          ],
        },
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      restoreHistory({ ...captured(), replies: [null] }, snapshot),
    ).toThrow();
    expect(() =>
      restoreHistory(
        {
          ...captured(),
          report: {
            ...report,
            priorities: [
              {
                category: "telemetry-comparison",
                evidenceIds: ["missing-source"],
                observation: "Claim",
                explanation: "Possible",
                experiment: "Compare",
                limitations: "Unknown",
              },
            ],
          },
        },
        snapshot,
      ),
    ).toThrow("evidence");
  });

  it("keeps paid answers when disposable analysis entries are evicted", async () => {
    await saveState(historyKey(snapshot.id), captured());
    for (let i = 0; i < 14; i++)
      await writeEngineerCache("history-test-" + i, {}, []);
    expect(
      restoreHistory(await readState(historyKey(snapshot.id)), snapshot)!
        .entries,
    ).toHaveLength(3);
  });

  it("keeps the last durable answer when a later save runs out of space", async () => {
    await saveState(historyKey(snapshot.id), captured());
    const original = IDBObjectStore.prototype.put;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (key === historyKey(snapshot.id))
          throw new DOMException("Synthetic quota", "QuotaExceededError");
        return original.call(this, value, key);
      });
    try {
      await expect(
        saveState(historyKey(snapshot.id), { ...captured(), replies: [] }),
      ).rejects.toThrow("quota");
    } finally {
      spy.mockRestore();
    }
    expect(
      restoreHistory(await readState(historyKey(snapshot.id)), snapshot)!
        .entries,
    ).toHaveLength(3);
  });

  it("stores only displayed content and rebuilds follow-ups for the matching corner", () => {
    const value = captureHistory(
      snapshot,
      [
        {
          ...entries[1],
          apiKey: "should-not-be-stored",
          tool_calls: ["raw"],
        } as Entry,
      ],
      report,
      "session",
    );
    expect(JSON.stringify(value)).not.toContain("should-not-be-stored");
    expect(value).not.toHaveProperty("tool_calls");
    const restored = restoreHistory(value, snapshot)!;
    expect(replyMessages(restored.entries, "corner-a")).toEqual([
      { role: "user", content: "Why?" },
      { role: "assistant", content: "The cause is still unknown." },
    ]);
    expect(replyMessages(restored.entries, "session")).toEqual([]);
  });

  it("persists replies as text, including literal HTML, without converting it to markup", () => {
    const text = '<img src="https://example.invalid/tracker">';
    const value = captureHistory(
      snapshot,
      [{ question: "Explain", text, scope: "session" }],
      undefined,
      "session",
    );
    expect(restoreHistory(value, snapshot)!.entries[0].text).toBe(text);
  });
});

describe("remembered review scope", () => {
  it("retains deselected laps and the review reference, while including newly added laps", () => {
    let value = "";
    const storage = {
      getItem: () => value,
      setItem: (_: string, v: string) => {
        value = v;
      },
    };
    saveReviewScope(storage, {
      anchorId: "lap-a",
      referenceId: "lap-b",
      selected: { "lap-c": false },
    });
    const scope = loadReviewScope(storage, "lap-a");
    expect(scope.referenceId).toBe("lap-b");
    expect(
      selectedReviewLaps(
        ["lap-a", "lap-b", "lap-c", "new-lap"],
        scope.referenceId,
        scope.selected,
        [],
      ),
    ).toEqual(["lap-a", "lap-b", "new-lap"]);
    expect(loadReviewScope(storage, "other-anchor").selected).toEqual({});
    expect(
      selectedReviewLaps(["lap-a", "lap-b"], "lap-a", { "lap-a": false }, [
        "lap-b",
      ]),
    ).toEqual(["lap-a"]);
  });
  it("handles unavailable or malformed scope preferences", () => {
    expect(
      loadReviewScope(
        {
          getItem: () => {
            throw Error("blocked");
          },
        },
        "lap-a",
      ).referenceId,
    ).toBe("lap-a");
    expect(
      loadReviewScope(
        {
          getItem: () =>
            '{"anchorId":"lap-a","referenceId":"lap-a","selected":{"lap-a":"yes"}}',
        },
        "lap-a",
      ).selected,
    ).toEqual({});
  });
});

it("asks for the same simple English in corner and whole-session reviews", () => {
  expect(cornerPrompt).toContain(plainEnglishPrompt);
  expect(reviewPrompt).toContain(plainEnglishPrompt);
  expect(plainEnglishPrompt).toContain("short sentences");
  expect(plainEnglishPrompt).toContain("preserve uncertainty");
});
