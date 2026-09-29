import { useEffect, useState } from "react";
import { lapTime, parseLapTime } from "./model";

// The lap clock. Type a lap time such as 85:40 and press Enter to jump there, which is the
// only way to reach a moment inside a long stop, where every moment has the same position.
export function ClockInput({
  ms,
  max,
  onJump,
}: {
  ms: number;
  max: number;
  onJump: (ms: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => setText(null), [ms]);
  const commit = () => {
    const value = parseLapTime(text ?? "");
    setText(null);
    if (Number.isFinite(value)) onJump(Math.max(0, Math.min(max, value)));
  };
  return (
    <input
      className="clock-input mono"
      aria-label="Lap time. Type a time such as 85:40 and press Enter to jump there"
      title="Type a lap time such as 85:40 and press Enter"
      value={text ?? lapTime(ms)}
      onFocus={(e) => {
        setText(lapTime(ms));
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => setText(null)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    />
  );
}
