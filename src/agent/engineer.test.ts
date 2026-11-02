import { expect, test } from "vitest";
import { emptySettings, type Snapshot } from "../raceEngineer/contracts";
import {
  engineerContext,
  installEngineer,
  queryEngineer,
  requestEngineer,
  submitEngineer,
} from "./engineer";
function snapshot(id = "review"): Snapshot {
  return {
    version: 1,
    algorithm: "test",
    id,
    referenceId: "lap",
    sessionIds: [],
    laps: [],
    evidence: [],
    corners: [],
    contexts: {},
    capabilities: {},
    priorities: [],
    warnings: [],
    envelope: {
      status: "unavailable",
      bins: [],
      method: "none",
      limitations: [],
    },
    modeled: { status: "unavailable", reasons: [] },
  } as Snapshot;
}
const report = (snapshotId = "review") => ({
  format: "apex-engineer-report",
  version: 1,
  snapshotId,
  priorities: [],
  debrief: {
    headline: "Review",
    assessment: "No findings supported.",
    findings: [],
    practicePlan: [],
  },
});
test("MCP reviews reject stale/replayed requests and reports and use the mounted snapshot", async () => {
  const saved: unknown[] = [];
  const dispose = installEngineer(
    snapshot(),
    [],
    emptySettings(),
    async (r) => {
      saved.push(r);
    },
  );
  try {
    const first = requestEngineer("Review my session");
    const next = requestEngineer("Review this selection");
    expect(engineerContext().request?.id).toBe(next.id);
    await expect(submitEngineer(first.id, report())).rejects.toThrow("stale");
    await expect(submitEngineer(next.id, report("wrong"))).rejects.toThrow(
      "Stale report",
    );
    expect(saved).toHaveLength(0);
    expect(
      await queryEngineer("summary", { snapshotId: "review" }),
    ).toMatchObject({ snapshotId: "review" });
    expect(queryEngineer("summary", { snapshotId: "other" })).toBeUndefined();
    await expect(submitEngineer(next.id, report())).resolves.toMatchObject({
      saved: true,
    });
    expect(saved).toHaveLength(1);
    expect(engineerContext().request).toBeNull();
    await expect(submitEngineer(next.id, report())).rejects.toThrow("stale");
  } finally {
    dispose();
  }
  expect(() => engineerContext()).toThrow("Open Race Engineer");
});
test("save failures retain a request for retry; replacing the mounted scope invalidates it", async () => {
  let fail = true;
  const dispose = installEngineer(snapshot(), [], emptySettings(), async () => {
    if (fail) throw Error("storage_failed");
  });
  const request = requestEngineer("Review");
  await expect(submitEngineer(request.id, report())).rejects.toThrow(
    "storage_failed",
  );
  expect(engineerContext().request?.id).toBe(request.id);
  fail = false;
  await expect(submitEngineer(request.id, report())).resolves.toMatchObject({
    saved: true,
  });
  const stale = requestEngineer("Old review");
  const disposeNext = installEngineer(
    snapshot("new"),
    [],
    emptySettings(),
    async () => {},
  );
  dispose();
  await expect(submitEngineer(stale.id, report())).rejects.toThrow("stale");
  expect(engineerContext().snapshotId).toBe("new");
  disposeNext();
});
