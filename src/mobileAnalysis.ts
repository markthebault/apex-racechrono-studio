import { useEffect, useState } from "react";
export type ChartInteraction = "scrub" | "pan" | "range";
export function useCompactAnalysis() {
  const query = "(max-width: 1100px), (pointer: coarse)";
  const [compact, setCompact] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return compact;
}
export function gestureAxis(dx: number, dy: number) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return "pending";
  return Math.abs(dy) > Math.abs(dx) ? "scroll" : "horizontal";
}
export function panTimeline(
  range: [number, number],
  dx: number,
  width: number,
  length: number,
): [number, number] {
  const span = range[1] - range[0];
  const start = Math.max(
    0,
    Math.min(length - span, range[0] - (dx / Math.max(1, width)) * span),
  );
  return [start, start + span];
}
