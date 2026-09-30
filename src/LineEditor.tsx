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
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [line, setLine] = useState<FinishLine | null>(session.line ?? null);
  const laps = useMemo(
    () =>
      line
        ? lapsFromLine(
            session.id,
            session.times,
            session.lat,
            session.lon,
            line,
          )
        : [],
    [line, session],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
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
          color: "#63e5d2",
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
      setLine({
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
    if (!line) return;
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
      color: "#111",
      weight: 7,
      dashArray: "5 5",
      interactive: false,
    }).addTo(layer.current!);
    const arrow = L.divIcon({
      className: "line-arrow",
      html: `<div style="transform:rotate(${line.heading}deg)">▲</div>`,
      iconSize: [24, 24],
    });
    L.marker([line.lat, line.lon], { icon: arrow, interactive: false }).addTo(
      layer.current!,
    );
  }, [line]);
  const times = laps.map((l) => l.end - l.start);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="summary-card line-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Set the start and finish line"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="summary-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div className="summary-track">{session.track}</div>
        <h2 className="review-title">Where is the start/finish line?</h2>
        <p className="muted">
          This file has no lap data, so laps are cut where the car crosses a
          line. Click the track at the start/finish line. The arrow shows the
          direction the line is crossed, taken from the path you drove.
        </p>
        <div className="line-map" ref={el} />
        <div className="line-result" role="status" aria-live="polite">
          {!line ? (
            "Click the track to place the line."
          ) : laps.length ? (
            <>
              <b>
                {laps.length} laps found. Best {lapTime(Math.min(...times))}.
              </b>{" "}
              Slowest {lapTime(Math.max(...times))}.
            </>
          ) : (
            "No complete lap crosses this line in the direction of travel. Try another spot on the track."
          )}
        </div>
        <div className="review-actions">
          <button
            className="sync-button"
            disabled={!laps.length}
            onClick={() => line && onApply(line)}
          >
            Use this line
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
