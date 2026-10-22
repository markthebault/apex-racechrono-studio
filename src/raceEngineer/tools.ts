// One query contract for in-app API tool calling and browser WebMCP clients.
export function analysisTools() {
  const descriptions: Record<string, string> = {
    summary:
      "Read approved selected lap summaries and ranked evidence references. Begin here.",
    debrief:
      "Read whole-session chronological laps, clean timing progression, recurring speed-pattern screening candidates, contrary evidence and a compact section/lap evidence matrix. eN/lN aliases are scoped to this snapshot and accepted in report reference fields. Check coverage and limitations.",
    capabilities:
      "Read verified channel semantics, quality and tool limits in the approved scope.",
    corner_review:
      "Read the three quickest distinct valid passes through one corner, the review pass, signed longitudinal/lateral G and speed traces, source provenance and limitations. Use all top-three passes for corner advice.",
    corners: "Read evidence for one corner, optionally one approved lap.",
    comparison:
      "Compare two approved laps across shared corner windows. Use cornerId to bound large reviews.",
    envelope:
      "Read demonstrated performance bins and confidence; not ultimate grip.",
    modeled:
      "Read modeled-reference readiness and limitations. Restricted geometry is never returned.",
    telemetry:
      "Read a bounded normalized telemetry window (meters of reference progress). Max 1000 points.",
  };
  return Object.entries(descriptions).map(([kind, description]) => {
    const properties: Record<string, object> = {
      snapshotId: {
        type: "string",
        description:
          "Exact current approved snapshot ID shown by the review UI.",
      },
    };
    const required = ["snapshotId"];
    if (kind === "corners" || kind === "corner_review") {
      properties.cornerId = { type: "string" };
      if (kind === "corners") properties.lapId = { type: "string" };
      required.push("cornerId");
    }
    if (kind === "comparison") {
      properties.lapId = { type: "string" };
      properties.comparisonLapId = { type: "string" };
      properties.cornerId = { type: "string" };
      required.push("lapId", "comparisonLapId");
    }
    if (kind === "telemetry") {
      Object.assign(properties, {
        lapId: { type: "string" },
        channel: {
          type: "string",
          description: "Canonical semantic channel from capabilities.",
        },
        start: { type: "number", minimum: 0 },
        end: { type: "number", minimum: 0 },
        points: { type: "integer", minimum: 2, maximum: 1000 },
      });
      required.push("lapId", "channel", "start", "end", "points");
    }
    return {
      name: `apex_${kind}`,
      description,
      inputSchema: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    };
  });
}
