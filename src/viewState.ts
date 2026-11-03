import { useCallback, useRef, useState, type SetStateAction } from "react";

const prefix = "apex-view-v1:";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export function readViewState<T>(
  key: string | null,
  fallback: T,
  valid: (value: unknown) => value is T,
  storage?: PreferenceStorage,
): T {
  if (!key) return fallback;
  try {
    const text = (storage ?? localStorage).getItem(prefix + key);
    if (!text || text.length > 10000) return fallback;
    const value: unknown = JSON.parse(text);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
export function writeViewState(
  key: string | null,
  value: unknown,
  storage?: PreferenceStorage,
) {
  if (!key) return;
  try {
    (storage ?? localStorage).setItem(prefix + key, JSON.stringify(value));
  } catch {
    // A blocked or full preference store must not stop navigation.
  }
}
// Read once on mount/scope change, and save on the user action, before a tab
// unmount or refresh. A loading/null scope never overwrites another lap's state.
export function useStoredView<T>(
  key: string | null,
  fallback: T,
  valid: (value: unknown) => value is T,
): [T, (value: SetStateAction<T>) => void] {
  const [stored, setStored] = useState(() => ({
    key,
    value: readViewState(key, fallback, valid),
  }));
  let current = stored;
  if (stored.key !== key) {
    current = { key, value: readViewState(key, fallback, valid) };
    setStored(current);
  }
  const live = useRef(current);
  live.current = current;
  const update = useCallback(
    (action: SetStateAction<T>) => {
      if (live.current.key !== key) return;
      const value =
        typeof action === "function"
          ? (action as (previous: T) => T)(live.current.value)
          : action;
      if (Object.is(value, live.current.value)) return;
      live.current = { key, value };
      writeViewState(key, value);
      setStored(live.current);
    },
    [key],
  );
  return [current.value, update];
}
export const viewId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 500;
export const viewBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
export const workspaceTab = (value: unknown): value is string =>
  typeof value === "string" &&
  [
    "Analyze",
    "Sessions",
    "Optimal lap",
    "Race Engineer",
    "Tracks",
    "Video sync",
  ].includes(value);
export const turnSelection = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" && /^T[1-9]\d{0,2}$/.test(value));
