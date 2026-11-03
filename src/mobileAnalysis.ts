import { useEffect, useRef, useState, type RefObject } from "react";
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

/** Keep the distance under the fingers anchored while translating and pinching. */
export function pinchTimeline(
  range: [number, number],
  from: { x: number; gap: number },
  to: { x: number; gap: number },
  width: number,
  length: number,
): [number, number] {
  const initialSpan = range[1] - range[0];
  const span = Math.min(
    length,
    Math.max(
      Math.min(50, length),
      (initialSpan * Math.max(1, from.gap)) / Math.max(1, to.gap),
    ),
  );
  const anchor = range[0] + (from.x / Math.max(1, width)) * initialSpan;
  const start = Math.max(
    0,
    Math.min(length - span, anchor - (to.x / Math.max(1, width)) * span),
  );
  return [start, start + span];
}

/** Native, non-passive listeners let one finger scroll vertically but reserve
 * two fingers for the timeline, including when fingers land on different rows.
 * A completed pinch stays latched until every finger lifts: the remaining
 * finger must never turn into a scrub or move the linked cars/video. */
export function useTimelineTouch(
  ref: RefObject<HTMLDivElement | null>,
  view: {
    range: [number, number];
    length: number;
    onCursor: (distance: number) => void;
    onRange: (range: [number, number]) => void;
  },
) {
  const latest = useRef(view);
  latest.current = view;
  useEffect(() => {
    const stack = ref.current;
    if (!stack) return;
    let single: { x: number; y: number; axis: string } | null = null;
    let multi = false;
    let plot: { left: number; width: number } | null = null;
    let pinch: {
      ids: number[];
      range: [number, number];
      x: number;
      gap: number;
    } | null = null;
    const reset = () => {
      single = null;
      multi = false;
      plot = null;
      pinch = null;
    };
    const distance = (x: number) => {
      const { range } = latest.current;
      return (
        range[0] +
        Math.max(0, Math.min(1, (x - plot!.left) / plot!.width)) *
          (range[1] - range[0])
      );
    };
    const pair = (touches: Touch[]) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2 - plot!.left,
      gap: Math.hypot(
        touches[0].clientX - touches[1].clientX,
        touches[0].clientY - touches[1].clientY,
      ),
    });
    const start = (e: TouchEvent) => {
      if (!plot) {
        const c =
          e.target instanceof Element ? e.target.closest("canvas") : null;
        if (!c || !stack.contains(c)) return;
        const box = c.getBoundingClientRect();
        plot = { left: box.left + 48, width: Math.max(1, box.width - 63) };
        const t = e.touches[0];
        single = { x: t.clientX, y: t.clientY, axis: "pending" };
      }
      const touches = Array.from(e.touches);
      if (touches.length >= 2) {
        multi = true;
        pinch = null;
        if (
          !touches.every(
            (t) => t.target instanceof Node && stack.contains(t.target),
          )
        )
          return;
        e.preventDefault();
        if (touches.length === 2)
          pinch = {
            ids: touches.map((t) => t.identifier),
            range: [...latest.current.range],
            ...pair(touches),
          };
      }
    };
    const move = (e: TouchEvent) => {
      if (!plot) return;
      if (multi) {
        if (e.cancelable) e.preventDefault();
        if (!pinch || e.touches.length !== 2) return;
        const touches = pinch.ids.map((id) =>
          Array.from(e.touches).find((t) => t.identifier === id),
        );
        if (touches.some((t) => !t)) return;
        const next = pinchTimeline(
          pinch.range,
          pinch,
          pair(touches as Touch[]),
          plot.width,
          latest.current.length,
        );
        latest.current.onRange(next);
        return;
      }
      if (!single || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (single.axis === "pending")
        single.axis = gestureAxis(t.clientX - single.x, t.clientY - single.y);
      if (single.axis !== "horizontal") return;
      e.preventDefault();
      latest.current.onCursor(distance(t.clientX));
    };
    const end = (e: TouchEvent) => {
      if (!plot) return;
      if (multi) {
        if (e.cancelable) e.preventDefault();
        pinch = null;
      } else if (
        single &&
        single.axis !== "scroll" &&
        e.changedTouches.length
      ) {
        e.preventDefault();
        latest.current.onCursor(distance(e.changedTouches[0].clientX));
      }
      if (!e.touches.length) reset();
    };
    stack.addEventListener("touchstart", start, { passive: false });
    stack.addEventListener("touchmove", move, { passive: false });
    stack.addEventListener("touchend", end, { passive: false });
    stack.addEventListener("touchcancel", reset);
    return () => {
      stack.removeEventListener("touchstart", start);
      stack.removeEventListener("touchmove", move);
      stack.removeEventListener("touchend", end);
      stack.removeEventListener("touchcancel", reset);
    };
  }, [ref]);
}
