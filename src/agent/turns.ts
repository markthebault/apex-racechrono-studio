import { useSyncExternalStore } from "react";
import type { Session, Trace } from "../model";
import type { Snapshot } from "../raceEngineer/contracts";
import type { DetectedTurn } from "../turns";
import { turnLimitations } from "../turns";
import { align, interpolate, trace } from "../analysis";
let catalogue: { reference?: Trace; turns: DetectedTurn[] } = { turns: [] };
const listeners = new Set<() => void>();
export function setTurnCatalogue(
  reference: Trace | undefined,
  turns: DetectedTurn[],
) {
  catalogue = { reference, turns };
  listeners.forEach((f) => f());
}
export function useTurnCatalogue() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => catalogue,
  );
}
export function turnContext() {
  return {
    referenceId: catalogue.reference?.id,
    turns: catalogue.turns,
    limitations: turnLimitations,
  };
}
export function engineerTurnLinks(snapshot: Snapshot, sessions: Session[]) {
  const ref = catalogue.reference;
  if (!ref)
    return {
      referenceId: undefined,
      turns: [],
      sections: [],
      limitations: turnLimitations,
    };
  const session = sessions.find((s) =>
    s.laps.some((l) => l.id === snapshot.referenceId),
  );
  const lap = session?.laps.find((l) => l.id === snapshot.referenceId);
  if (!session || !lap) return { ...turnContext(), sections: [] };
  const native = trace(session, lap),
    aligned = align(native, ref);
  if (aligned.issues.some((i) => /Incompatible|Ambiguous/.test(i)))
    return { ...turnContext(), sections: [] };
  return {
    ...turnContext(),
    sections: snapshot.corners.map((c) => {
      const start = interpolate(native.distance, aligned.distance, c.start),
        end = interpolate(native.distance, aligned.distance, c.end);
      return {
        cornerId: c.id,
        turnIds:
          snapshot.reviewMode === "turns" && ref.id === snapshot.referenceId
            ? [c.id]
            : catalogue.turns
                .filter((t) => t.end >= start && t.start <= end)
                .map((t) => t.id),
      };
    }),
  };
}
