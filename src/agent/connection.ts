import { useSyncExternalStore } from "react";
export type ConnectionPhase = "off" | "waiting" | "connected";
let phase: ConnectionPhase = "off";
const listeners = new Set<() => void>();
export function setAgentConnection(next: ConnectionPhase) {
  if (next !== phase) {
    phase = next;
    listeners.forEach((f) => f());
  }
}
export function useAgentConnection() {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    () => phase,
  );
}
export function openAgentConnection() {
  window.dispatchEvent(new Event("apex-open-agent"));
}
