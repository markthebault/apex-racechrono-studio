import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FinishLine, Session } from "./model";
import { lapTime } from "./model";
import { headingAt, lapsFromLine } from "./laps";

const K = 6371000 * (Math.PI / 180);

// Place the start/finish line by clicking the track. Laps are recut live so the result can
// be judged before it is kept.
export function LineEditor({
  session,
  onApply,
  onClose,
}: {
  session: Session;
  onApply: (line: FinishLine) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pathBounds = useRef<L.LatLngTuple[]>([]);
  const [line, setLine] = useState<FinishLine | null>(session.line ?? null);
  const [separate, setSeparate] = useState(!!session.line?.finish);
  const [finish, setFinish] = useState<FinishLine | null>(
    session.line?.finish ?? null,
  );
  const [active, setActive] = useState<"start" | "finish">("start");
  const activeRef = useRef(active);
  activeRef.current = active;
  const selected = active === "finish" ? finish : line;
  const updateSelected = (
    update: (old: FinishLine | null) => FinishLine | null,
  ) => (active === "finish" ? setFinish : setLine)(update);
  const timing = useMemo(
    () =>
      line && (!separate || finish)
        ? { ...line, finish: separate ? finish! : undefined }
        : null,
    [line, finish, separate],
  );
  const laps = useMemo(
    () =>
      timing
        ? lapsFromLine(
            session.id,
            session.times,
            session.lat,
            session.lon,
            timing,
          )
        : [],
    [timing, session],
  );
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const m = L.map(el.current!, {
      zoomAnimation: false,
      fadeAnimation: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(m);
    const path: L.LatLngTuple[] = [];
    let run: L.LatLngTuple[] = [];
    const flush = () => {
      if (run.length > 1)
        L.polyline(run, {
          color: "#ff8855",
          weight: 3,
          interactive: false,
        }).addTo(m);
      run = [];
    };
    for (let i = 0; i < session.lat.length; i += 5) {
      if (i >= 5 && session.times[i] - session.times[i - 5] > 2000) flush();
      const p: L.LatLngTuple = [session.lat[i], session.lon[i]];
      run.push(p);
      path.push(p);
    }
    flush();
    pathBounds.current = path;
    m.fitBounds(path, { padding: [30, 30], animate: false });
    layer.current = L.layerGroup().addTo(m);
    // The nearest recorded point to the click, if it is near enough to mean the track.
    m.on("click", (e) => {
      let best = Infinity,
        at = -1;
      const k = Math.cos((e.latlng.lat * Math.PI) / 180);
      for (let i = 0; i < session.lat.length; i++) {
        const d =
          (session.lat[i] - e.latlng.lat) ** 2 +
          ((session.lon[i] - e.latlng.lng) * k) ** 2;
        if (d < best) {
          best = d;
          at = i;
        }
      }
      if (at < 0) return;
      const p = m.latLngToContainerPoint([session.lat[at], session.lon[at]]);
      if (p.distanceTo(e.containerPoint) > 40) return;
      (activeRef.current === "finish" ? setFinish : setLine)({
        lat: session.lat[at],
        lon: session.lon[at],
        heading: headingAt(session.lat, session.lon, at),
        source: "user",
      });
    });
    map.current = m;
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(el.current!);
    return () => {
      observer.disconnect();
      m.remove();
    };
  }, [session]);
  useEffect(() => {
    layer.current?.clearLayers();
    const draw = (line: FinishLine, label: string, color: string) => {
      // The line itself, 30 m each side, square across the direction of travel.
      const h = ((line.heading + 90) * Math.PI) / 180;
      const dLat = (30 * Math.cos(h)) / K,
        dLon = (30 * Math.sin(h)) / (K * Math.cos((line.lat * Math.PI) / 180));
      const ends: L.LatLngTuple[] = [
        [line.lat - dLat, line.lon - dLon],
        [line.lat + dLat, line.lon + dLon],
      ];
      L.polyline(ends, { color: "#fff", weight: 7, interactive: false }).addTo(
        layer.current!,
      );
      L.polyline(ends, {
        color,
        weight: 7,
        dashArray: "5 5",
        interactive: false,
      }).addTo(layer.current!);
      const arrow = L.divIcon({
        className: "line-arrow",
        html: `<div style="transform:rotate(${line.heading}deg)">▲</div>`,
        iconSize: [24, 24],
      });
      L.marker([line.lat, line.lon], { icon: arrow, interactive: false })
        .bindTooltip(label, {
          permanent: true,
          direction: "top",
          offset: [0, -14],
        })
        .addTo(layer.current!);
    };
    if (line) draw(line, separate ? "Start" : "Start / finish", "#111");
    if (separate && finish) draw(finish, "Finish", "#238bda");
  }, [line, finish, separate]);
  const times = laps.map((l) => l.end - l.start);
  return (
    <dialog
      ref={dialog}
      className="summary-card line-editor"
      aria-label="Set the start and finish line"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <button className="summary-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="summary-track">{session.track}</div>
      <h2 className="review-title">Set your timing lines</h2>
      <p className="muted line-instructions">
        Zoom in and tap your recorded path to place the selected line. Rotate it
        below; the arrow shows the crossing direction. Preview laps before
        saving.
      </p>
      <label className="line-separate">
        <input
          type="checkbox"
          checked={separate}
          onChange={(e) => {
            setSeparate(e.target.checked);
            setActive(e.target.checked ? "finish" : "start");
          }}
        />
        Separate finish line
      </label>
      {separate && (
        <div className="line-select" role="group" aria-label="Line to place">
          <button
            aria-pressed={active === "start"}
            onClick={() => setActive("start")}
          >
            Start line
          </button>
          <button
            aria-pressed={active === "finish"}
            onClick={() => setActive("finish")}
          >
            Finish line
          </button>
        </div>
      )}
      <div className="line-map-tools">
        <button
          onClick={() =>
            map.current?.fitBounds(pathBounds.current, {
              padding: [30, 30],
              animate: false,
            })
          }
        >
          Fit recording
        </button>
        <button
          disabled={!selected}
          onClick={() =>
            selected &&
            map.current?.setView([selected.lat, selected.lon], 18, {
              animate: false,
            })
          }
        >
          Zoom to line
        </button>
        <button
          disabled={!selected}
          onClick={() =>
            updateSelected((old) =>
              old
                ? { ...old, heading: (old.heading + 180) % 360, source: "user" }
                : old,
            )
          }
        >
          Reverse arrow
        </button>
      </div>
      <div
        className="line-map"
        ref={el}
        role="group"
        aria-label="Recorded path: zoom in and tap to place the timing line"
      />
      <div className="line-rotations">
        {(separate ? (["start", "finish"] as const) : (["start"] as const)).map(
          (which) => {
            const value = which === "start" ? line : finish;
            const label = separate
              ? `${which === "start" ? "Start" : "Finish"} line rotation`
              : "Start / finish line rotation";
            return (
              <label className="line-rotation" key={which}>
                <span>
                  {label}
                  <output>
                    {value ? `${Math.round(value.heading)}°` : "Place line"}
                  </output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  aria-label={label}
                  disabled={!value}
                  value={value?.heading ?? 0}
                  onChange={(e) => {
                    const heading = Number(e.target.value);
                    (which === "start" ? setLine : setFinish)((old) =>
                      old ? { ...old, heading, source: "user" } : old,
                    );
                  }}
                />
              </label>
            );
          },
        )}
      </div>
      <div className="line-result" role="status" aria-live="polite">
        {!timing ? (
          `Tap the recorded path to place the ${separate && line ? "finish" : "start / finish"} line.`
        ) : laps.length ? (
          <>
            <b>
              {laps.length} laps found. Best {lapTime(Math.min(...times))}.
            </b>{" "}
            Slowest {lapTime(Math.max(...times))}.
          </>
        ) : (
          "No complete lap crosses the timing lines in the direction of travel. Try another spot on the track."
        )}
      </div>
      <div className="review-actions line-save-actions">
        <button
          className="sync-button"
          disabled={!laps.length}
          onClick={() => timing && onApply(timing)}
        >
          {separate ? "Use these lines" : "Use this line"}
        </button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </dialog>
  );
}
