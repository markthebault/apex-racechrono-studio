import type { Snapshot } from "./contracts";

export function hasDrivingNumbers(
  text: string,
  snapshot: Snapshot,
  cornerId: string,
) {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const corner = snapshot.corners.find((c) => c.id === cornerId);
  if (corner) {
    text = text.replace(new RegExp(escape(corner.name), "gi"), "");
    const number = corner.name.match(
      /^(?:Review window|Section|Turn|Corner)\s+(\d+)\b/i,
    )?.[1];
    if (number)
      text = text.replace(
        new RegExp(
          `\\b(?:Review window|Section|Turn|Corner)\\s+${number}\\b`,
          "gi",
        ),
        "",
      );
  }
  for (const lap of snapshot.laps)
    text = text.replace(new RegExp(`\\bLap\\s+${lap.number}\\b`, "gi"), "");
  // Small repetition counts are instructions for collecting comparable data,
  // not invented speed, braking-point, time or G targets. Do not match decimals.
  text = text.replace(
    /(?<![\d.,])\b(?:[1-9]|10)\s+(?:(?:clean|comparable|consistent|comfortable|controlled|steady)\s+)*(?:passes|laps|repetitions|times)\b/gi,
    "",
  );
  return /\d/.test(text);
}
