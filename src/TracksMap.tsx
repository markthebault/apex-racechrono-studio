import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { FinishLine } from "./model";
import type { TrackSummary } from "./tracks";
import type { VenueShape } from "./venues";

export type Gate = { lat: number; lon: number; label: string };

const AMBER = "#f5a524";

// A track as the Tracks screen shows it: the fastest lap in bold, other sessions faintly,
// the start/finish line as a checkered bar with an arrow for the direction of travel, and
// the sector gates when there are any. OpenStreetMap geometry of the venue is amber: every
// mapped piece faintly, and the selected layout in bold when no recorded track is shown.
export function TracksMap({
  track,
  gates = [],
  shape,
  center,
  layout,
  label,
  height,
}: {
  track?: TrackSummary | null;
  gates?: Gate[];
  shape?: VenueShape | null;
  center?: [number, number];
  layout?: number | null;
  label?: string;
  height: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    const m = L.map(el.current!, {
      zoomAnimation: false,
      fadeAnimation: false,
      zoomControl: false,
    }).setView([50.35, 6.95], 5);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(el.current!);
    return () => {
      observer.disconnect();
      m.remove();
    };
  }, []);
  useEffect(() => {
    const m = map.current!,
      g = layer.current!;
    g.clearLayers();
    const bounds: [number, number][] = [];
    if (shape) {
      for (const piece of shape.pieces) {
        L.polyline(piece.points, {
          color: AMBER,
          weight: 2,
          opacity: 0.45,
          dashArray: piece.pit ? "4 5" : undefined,
          interactive: false,
        }).addTo(g);
        bounds.push(...piece.points);
      }
      const chosen = layout == null ? null : shape.layouts[layout];
      if (chosen && !track) {
        L.polyline(chosen.points, {
          color: "#0b1114",
          weight: 9,
          opacity: 0.7,
          interactive: false,
        }).addTo(g);
        L.polyline(chosen.points, {
          color: AMBER,
          weight: 4,
          interactive: false,
        }).addTo(g);
      }
    }
    if (!track) {
      if (bounds.length)
        m.fitBounds(bounds, { padding: [40, 40], animate: false });
      else if (center) {
        L.marker(center).addTo(g);
        m.setView(center, 14, { animate: false });
      }
      return;
    }
    for (const o of track.others)
      L.polyline(o.points, {
        color: "#9fb0b9",
        weight: 2,
        opacity: 0.4,
        interactive: false,
      }).addTo(g);
    // A dark outline under the bold trace keeps it readable on the dimmed map.
    L.polyline(track.outline, {
      color: "#0b1114",
      weight: 9,
      opacity: 0.7,
      interactive: false,
    }).addTo(g);
    L.polyline(track.outline, {
      color: "#63e5d2",
      weight: 4,
      interactive: false,
    }).addTo(g);
    for (const p of gates)
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "gate",
          html: p.label,
          iconSize: [22, 22],
        }),
        interactive: false,
      }).addTo(g);
    // A bar across the direction of travel with its label above it, one marker with a
    // fixed size on screen, so it stays visible however far the map is zoomed out. A
    // circuit has one checkered start/finish bar. A track timed to a separate finish line
    // has a solid green START bar and a checkered FINISH bar.
    const bar = (line: FinishLine, kind: "start" | "finish" | "both") =>
      L.marker([line.lat, line.lon], {
        icon: L.divIcon({
          className: "sf-bar-wrap",
          html: `<div class="sf-bar ${kind}" style="transform:rotate(${line.heading}deg)"></div><div class="sf-tag ${kind}">${{ start: "START", finish: "FINISH", both: "START / FINISH" }[kind]}</div>`,
          iconSize: [150, 130],
          iconAnchor: [75, 65],
        }),
        interactive: false,
      }).addTo(g);
    if (track.line) bar(track.line, track.finish ? "start" : "both");
    if (track.finish) bar(track.finish, "finish");
    if (track.outline.length)
      m.fitBounds(track.outline, { padding: [50, 50], animate: false });
  }, [track, gates.length, shape, layout, center?.[0], center?.[1]]);
  const chosen = shape && layout != null ? shape.layouts[layout] : null;
  return (
    <div className="map-shell" style={{ height }}>
      <div ref={el} className="map" />
      <div className="map-tag">
        <span className="live-dot" />{" "}
        {(label ?? track?.name ?? "Tracks").toUpperCase()}
      </div>
      {(track || shape) && (
        <div className="map-legend">
          {track && (
            <span>
              <i style={{ background: "#63e5d2", height: 4 }} />
              Your fastest lap
            </span>
          )}
          {!track && chosen && (
            <span>
              <i style={{ background: AMBER, height: 4 }} />
              Layout from OpenStreetMap
            </span>
          )}
          {shape && (
            <span>
              <i style={{ background: AMBER, height: 2, opacity: 0.6 }} />
              Mapped track pieces
            </span>
          )}
          {track && track.others.length > 0 && (
            <span>
              <i style={{ background: "#9fb0b9", height: 2, opacity: 0.6 }} />
              Other sessions
            </span>
          )}
          {track?.line && track.finish && (
            <>
              <span>
                <i className="start" />
                Start line
              </span>
              <span>
                <i className="checker" />
                Finish line
              </span>
            </>
          )}
          {track?.line && !track.finish && (
            <span>
              <i className="checker" />
              Start / finish, arrow shows the direction
            </span>
          )}
        </div>
      )}
    </div>
  );
}
