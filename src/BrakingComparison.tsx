import type { BrakePair } from "./telemetry";
import type { Trace } from "./model";
import { brakeSignal } from "./analysis";
export function BrakingComparison({
  a,
  b,
  pairs,
  open,
  onOpen,
  onFocus,
}: {
  a: Trace;
  b: Trace;
  pairs: BrakePair[];
  open: boolean;
  onOpen: (open: boolean) => void;
  onFocus: (pair: BrakePair) => void;
}) {
  const source = (trace: Trace) =>
    brakeSignal(trace).recorded ? "recorded brake" : "estimated from GPS speed";
  const unreliable = [a, b].some((t) =>
    t.issues.some((issue) => /Ambiguous|Incompatible/.test(issue)),
  );
  return (
    <details
      className="braking-comparison"
      open={open}
      onToggle={(e) => onOpen(e.currentTarget.open)}
    >
      <summary>
        Braking points <span>A vs B</span>
      </summary>
      <p>
        A: {source(a)} · B: {source(b)}. Points are paired within 100 m. GPS
        estimates can include lifting off.
      </p>
      {pairs.length ? (
        <div className="braking-table" aria-label="Braking point comparisons">
          {pairs.map((pair, i) => {
            const delta = pair.a && pair.b ? pair.a.start - pair.b.start : NaN;
            return (
              <button
                key={i}
                onClick={() => onFocus(pair)}
                title="Inspect this braking point"
              >
                <b>{i + 1}</b>
                <span>A {pair.a ? `${Math.round(pair.a.start)} m` : "—"}</span>
                <span>B {pair.b ? `${Math.round(pair.b.start)} m` : "—"}</span>
                <strong>
                  {Number.isFinite(delta)
                    ? Math.abs(delta) < 1
                      ? "Same point"
                      : `A ${Math.round(Math.abs(delta))} m ${delta > 0 ? "later" : "earlier"}`
                    : "No match"}
                </strong>
              </button>
            );
          })}
        </div>
      ) : (
        <p>
          {unreliable
            ? "GPS alignment is unreliable for these laps, so their braking points cannot be compared."
            : "No braking onsets could be compared in these laps."}
        </p>
      )}
    </details>
  );
}
