import { expect, test } from "vitest";
import {
  readViewState,
  writeViewState,
  workspaceTab,
  turnSelection,
  viewId,
  viewBoolean,
} from "./viewState";
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
}
test("remembers valid views and keeps reference/mode selections separate", () => {
  const store = memory();
  writeViewState("workspace-tab", "Race Engineer", store);
  expect(readViewState("workspace-tab", "Analyze", workspaceTab, store)).toBe(
    "Race Engineer",
  );
  writeViewState("region:lap-a:turns", "T2", store);
  writeViewState("region:lap-a:sections", "corner-3", store);
  expect(readViewState("region:lap-a:turns", "", viewId, store)).toBe("T2");
  expect(readViewState("region:lap-a:sections", "", viewId, store)).toBe(
    "corner-3",
  );
  expect(readViewState("region:lap-b:turns", "", viewId, store)).toBe("");
});
test("rejects malformed, oversized and invalid selections instead of breaking startup", () => {
  const store = memory();
  for (const raw of [
    "{",
    '"Unknown menu"',
    '{"tab":"Analyze"}',
    '"' + "a".repeat(12000) + '"',
  ]) {
    store.setItem("apex-view-v1:tab", raw);
    expect(readViewState("tab", "Analyze", workspaceTab, store)).toBe(
      "Analyze",
    );
  }
  writeViewState("turn", "T2", store);
  expect(readViewState("turn", null, turnSelection, store)).toBe("T2");
  writeViewState("turn", "not-a-turn", store);
  expect(readViewState("turn", null, turnSelection, store)).toBeNull();
  writeViewState("flag", "true", store);
  expect(readViewState("flag", false, viewBoolean, store)).toBe(false);
});
test("does not persist a loading scope and tolerates blocked or full storage", () => {
  const blocked = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("quota");
    },
  };
  expect(readViewState("tab", "Analyze", workspaceTab, blocked)).toBe(
    "Analyze",
  );
  expect(() => writeViewState("tab", "Race Engineer", blocked)).not.toThrow();
  const store = memory();
  writeViewState(null, "T2", store);
  expect(readViewState(null, null, turnSelection, store)).toBeNull();
  expect(store.getItem("apex-view-v1:null")).toBeNull();
});
