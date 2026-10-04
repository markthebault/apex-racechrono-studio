// Where the pointer is over a chart, as a distance along the lap, or null. Charts publish
// it; the other charts and the map listen, without re-rendering the whole app.
type Listener = (distance: number | null) => void;
const listeners = new Set<Listener>();
export const hoverBus = {
  set(distance: number | null) {
    listeners.forEach((f) => f(distance));
  },
  subscribe(f: Listener) {
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  },
};
