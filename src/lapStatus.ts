import { blocksOptimal } from "./analysis";
export type LapStatus =
  | "counts"
  | "included"
  | "excluded"
  | "review"
  | "unusable"
  | "other-track"
  | "not-selected";
// Why a lap does or does not feed the optimal lap, for the Sessions tab.
export function lapStatus(x: {
  issues: string[];
  sameTrack: boolean;
  selected: boolean;
  excluded: boolean;
  included: boolean;
}): LapStatus {
  if (!x.sameTrack) return "other-track";
  if (!canInclude(x.issues)) return "unusable";
  if (x.excluded) return "excluded";
  if (blocksOptimal(x.issues) && x.included)
    return x.selected ? "included" : "not-selected";
  if (!x.selected) return "not-selected";
  return blocksOptimal(x.issues) ? "review" : "counts";
}
export const STATUS_LABEL: Record<LapStatus, string> = {
  counts: "Counts",
  included: "Marked valid",
  excluded: "Excluded",
  review: "Needs review",
  unusable: "Can't be used",
  "other-track": "Other track",
  "not-selected": "Not in analyzer",
};
// A lap that does not line up with the reference cannot be forced in: its sector times
// would be measured against the wrong stretch of track.
export const canInclude = (issues: string[]) =>
  !issues.some((i) => i.includes("Incompatible") || i.includes("Ambiguous"));
// Plain-language meaning of each flag the app can raise.
export function explainIssue(issue: string): string {
  if (issue.startsWith("Marked invalid"))
    return "RaceChrono flagged this lap as invalid, for example because the timing line was missed or the track was cut. Its times may not be repeatable.";
  if (issue.startsWith("Incomplete GPS"))
    return "The GPS recording does not cover the whole lap from start line to finish line, so some sectors cannot be measured.";
  if (issue.startsWith("GPS gap"))
    return "The GPS dropped out for more than 2 seconds. Sectors that overlap the gap are skipped and every other sector still counts, so no action is needed.";
  if (issue.startsWith("Interrupted"))
    return "This lap lasted far longer than your others, for example a red flag, a stop or a pit visit. It still counts: the sector where the car stood still is too slow to be the fastest.";
  if (issue.startsWith("Incompatible"))
    return "The start or finish of this lap is more than 150 m from the reference lap of the track being analyzed. It is a different track or a different layout, so its sectors cannot be compared.";
  if (issue.startsWith("Ambiguous"))
    return "The GPS line could not be matched reliably to the reference lap: more than 1% of its points are over 60 m off the line, or it covers under 98% of the distance. Its sector times would be unreliable.";
  return issue;
}
