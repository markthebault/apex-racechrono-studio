type ReviewScope = {
  anchorId: string;
  referenceId: string;
  selected: Record<string, boolean>;
};
const slot = "apex-engineer-scope-v1";
export function loadReviewScope(
  storage: Pick<Storage, "getItem">,
  anchorId: string,
): ReviewScope {
  try {
    const v = JSON.parse(storage.getItem(slot) ?? "null");
    if (
      v?.anchorId === anchorId &&
      typeof v.referenceId === "string" &&
      v.selected &&
      typeof v.selected === "object" &&
      !Array.isArray(v.selected) &&
      Object.entries(v.selected).every(
        ([id, chosen]) => id.length <= 500 && typeof chosen === "boolean",
      )
    )
      return { anchorId, referenceId: v.referenceId, selected: v.selected };
  } catch {
    /* A blocked preference store must not prevent local analysis. */
  }
  return { anchorId, referenceId: anchorId, selected: {} };
}
export function saveReviewScope(
  storage: Pick<Storage, "setItem">,
  scope: ReviewScope,
) {
  storage.setItem(slot, JSON.stringify(scope));
}
export function selectedReviewLaps(
  lapIds: string[],
  referenceId: string | undefined,
  selected: Record<string, boolean>,
  excluded: string[],
) {
  // Explicit choices survive reload; newly added laps still enter the analysis.
  return lapIds.filter(
    (id) =>
      id === referenceId ||
      (Object.hasOwn(selected, id) ? selected[id] : !excluded.includes(id)),
  );
}
