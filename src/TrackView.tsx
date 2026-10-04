import { lazy, Suspense, useState, type ComponentProps } from "react";
import { TrackMap } from "./Map";
const Track3D = lazy(() => import("./Track3D"));
export type TrackViewProps = ComponentProps<typeof TrackMap>;
export function TrackView(props: TrackViewProps) {
  const [view, setView] = useState<"2d" | "3d">("2d");
  const [height3d, setHeight3d] = useState(Math.max(props.height, 520));
  return (
    <div className="track-view">
      <div className="track-view-switch" role="group" aria-label="Track view">
        <button aria-pressed={view === "2d"} onClick={() => setView("2d")}>
          2D map
        </button>
        <button aria-pressed={view === "3d"} onClick={() => setView("3d")}>
          3D elevation
        </button>
      </div>
      {view === "2d" ? (
        <TrackMap {...props} />
      ) : (
        <Suspense
          fallback={
            <div
              className="map-shell track-loading"
              style={{ height: height3d }}
            >
              Loading 3D track…
            </div>
          }
        >
          <Track3D {...props} height={height3d} onHeight={setHeight3d} />
        </Suspense>
      )}
    </div>
  );
}
