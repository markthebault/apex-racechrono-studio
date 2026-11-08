import { useEffect, useRef, type ButtonHTMLAttributes } from "react";
let handledTouchAt = 0;
let listening = false;
function installTouchDeduplication() {
  if (listening) return;
  listening = true;
  // A new deliberate pointer gesture must always be allowed. The compatibility
  // click from the previous pointer-up may target a newly opened sheet instead
  // of the original button, so deduplicate at the document capture boundary.
  document.addEventListener(
    "pointerdown",
    () => {
      handledTouchAt = 0;
    },
    true,
  );
  // Compatibility mousedown can focus a control exposed by a closing sheet,
  // even when the later click is suppressed. Block both events from that touch.
  for (const type of ["mousedown", "click"] as const)
    document.addEventListener(
      type,
      (e) => {
        const pointer = e as PointerEvent;
        const keyboard =
          type === "click" && e.detail === 0 && !pointer.pointerType;
        if (!keyboard && handledTouchAt && Date.now() - handledTouchAt < 700) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
}
// Some mobile browsers suppress compatibility clicks after a captured drag.
// Activate on touch pointer-up; retain normal mouse, keyboard and assistive clicks.
export function TouchButton({
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onClick?: () => void;
}) {
  const down = useRef<{ x: number; y: number } | null>(null);
  useEffect(installTouchDeduplication, []);
  return (
    <button
      {...props}
      onPointerDown={(e) => {
        if (e.pointerType === "touch")
          down.current = { x: e.clientX, y: e.clientY };
        props.onPointerDown?.(e);
      }}
      onPointerCancel={(e) => {
        down.current = null;
        props.onPointerCancel?.(e);
      }}
      onPointerUp={(e) => {
        const start = down.current;
        down.current = null;
        if (e.pointerType === "touch" && start) {
          handledTouchAt = Date.now();
          if (
            Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8 &&
            !props.disabled
          )
            onClick?.();
        }
        props.onPointerUp?.(e);
      }}
      onClick={() => onClick?.()}
    />
  );
}
