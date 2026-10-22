import type { Snapshot } from "./contracts";

type Schema = Record<string, unknown>;
export type ReviewRequest = { snapshot: Snapshot; cornerId?: string };
const object = (properties: Record<string, Schema>): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const text = (description: string): Schema => ({ type: "string", description });
const refs = (values: string[]): Schema => {
  const unique = [...new Set(values)];
  // Native strict-schema providers impose limits on total enum entries and
  // string bytes. Large session scopes retain deterministic source validation
  // rather than generating an API-rejected schema. Corner vocabularies are small.
  const bounded = unique.length <= 100 && unique.join("").length <= 8000;
  return {
    type: "array",
    maxItems: unique.length ? 20 : 0,
    items:
      unique.length && bounded
        ? { type: "string", enum: unique }
        : {
            type: "string",
            description:
              "Use only exact source IDs or eN/lN aliases from the approved data. References are checked after generation.",
          },
  };
};

// Bind both the structure and source vocabulary before generation. Deterministic
// validation still checks coverage, eligibility, repeated patterns and prose.
export function reportFormat({ snapshot, cornerId }: ReviewRequest) {
  const evidence = snapshot.evidence.flatMap((e, i) =>
    !cornerId || (e.cornerId === cornerId && !e.quality.length)
      ? [e.id, `e${i + 1}`]
      : [],
  );
  const evidenceIds = refs(evidence);
  const common: Record<string, Schema> = {
    format: { type: "string", enum: ["apex-engineer-report"] },
    version: { type: "integer", enum: [1] },
    snapshotId: { type: "string", enum: [snapshot.id] },
    priorities: { type: "array", items: { type: "string" }, maxItems: 0 },
  };
  if (cornerId) {
    if (!snapshot.corners.some((c) => c.id === cornerId))
      throw Error("Unknown review corner.");
    common.cornerReviews = {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: object({
        cornerId: { type: "string", enum: [cornerId] },
        evidenceIds,
        observation: text(
          "Compare every supplied top pass using speed and available G evidence.",
        ),
        possibleMistakes: text(
          "A possible cause, with contrary examples. Do not invent pedal use.",
        ),
        advice: text(
          "One comfortable practice step; no invented numerical driving target.",
        ),
        successCheck: text(
          "Compare to the measured baseline; no invented tolerance.",
        ),
        limitations: text(
          "Unknown conditions, source limits and missing passes.",
        ),
      }),
    };
  } else {
    common.debrief = object({
      headline: text("A short, clear session takeaway."),
      assessment: text(
        "An overall assessment; keep unknown causes separate from facts.",
      ),
      findings: {
        type: "array",
        maxItems: 6,
        items: object({
          kind: {
            type: "string",
            enum: ["pattern", "progress", "strength", "inconsistency"],
          },
          title: text("A short finding title."),
          observation: text("What the cited measurements show."),
          interpretation: text(
            "A possible explanation, not an invented cause.",
          ),
          action: text("One useful practice or investigation step."),
          confidence: { type: "string", enum: ["low", "medium"] },
          evidenceIds,
          lapIds: refs(snapshot.laps.flatMap((l, i) => [l.id, `l${i + 1}`])),
        }),
      },
      practicePlan: {
        type: "array",
        maxItems: 3,
        items: object({
          title: text("One focus."),
          instruction: text("One clear practice step."),
          successCheck: text("How to check whether it helps."),
          evidenceIds,
        }),
      },
    });
  }
  return {
    type: "json_schema",
    json_schema: {
      name: cornerId ? "corner_review" : "session_debrief",
      strict: true,
      schema: object(common),
    },
  };
}
