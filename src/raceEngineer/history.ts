import { validateReport, type Report, type Snapshot } from "./contracts";
import type { Message } from "./provider";

export type Entry = {
  question: string;
  text?: string;
  report?: Report;
  scope?: string;
};
export type EngineerHistory = {
  version: 1;
  snapshotId: string;
  sessionIds: string[];
  report?: Report;
  replies: { question: string; text: string; scope: string }[];
  view: "corners" | "session";
  cornerId?: string;
};
export const historyKey = (snapshotId: string) =>
  "engineer-history:" + snapshotId;

// Save only the displayed answers. Credentials, sharing grants, tool messages
// and raw telemetry never enter this history. The analysis cache is disposable;
// paid answers have a separate lifetime and are not evicted with that cache.
export function captureHistory(
  snapshot: Snapshot,
  entries: Entry[],
  report: Report | undefined,
  view: EngineerHistory["view"],
  cornerId?: string,
): EngineerHistory {
  return {
    version: 1,
    snapshotId: snapshot.id,
    sessionIds: [...snapshot.sessionIds],
    ...(report ? { report: validateReport(report, snapshot) } : {}),
    replies: entries.flatMap((e) =>
      e.text
        ? [{ question: e.question, text: e.text, scope: e.scope ?? "session" }]
        : [],
    ),
    view,
    ...(cornerId ? { cornerId } : {}),
  };
}

export function restoreHistory(
  value: unknown,
  snapshot: Snapshot,
):
  | { entries: Entry[]; view: EngineerHistory["view"]; cornerId?: string }
  | undefined {
  if (value === undefined) return;
  const h = value as EngineerHistory;
  const validScope = (scope: unknown) =>
    scope === "session" || snapshot.corners.some((c) => c.id === scope);
  if (
    !h ||
    h.version !== 1 ||
    h.snapshotId !== snapshot.id ||
    !Array.isArray(h.sessionIds) ||
    JSON.stringify([...h.sessionIds].sort()) !==
      JSON.stringify([...snapshot.sessionIds].sort()) ||
    !["corners", "session"].includes(h.view) ||
    (h.cornerId !== undefined &&
      !snapshot.corners.some((c) => c.id === h.cornerId)) ||
    !Array.isArray(h.replies) ||
    h.replies.some(
      (r) =>
        !r ||
        typeof r.question !== "string" ||
        r.question.length > 4000 ||
        typeof r.text !== "string" ||
        r.text.length > 512 * 1024 ||
        !validScope(r.scope),
    )
  )
    throw Error("Saved answers do not match this analysis.");
  return {
    entries: [
      ...(h.report
        ? [
            {
              question: "Saved review",
              report: validateReport(h.report, snapshot),
            },
          ]
        : []),
      ...h.replies.map((r) => ({
        question: r.question,
        text: r.text,
        scope: r.scope,
      })),
    ],
    view: h.view,
    cornerId: h.cornerId,
  };
}

// Rebuild a short, corner-specific conversation after reload, alongside freshly
// supplied evidence. Never replay stored tool calls or an obsolete consent.
export function replyMessages(entries: Entry[], scope: string): Message[] {
  return entries
    .filter((e) => e.text && e.scope === scope)
    .slice(-6)
    .flatMap((e) => [
      { role: "user" as const, content: e.question },
      { role: "assistant" as const, content: e.text! },
    ]);
}
