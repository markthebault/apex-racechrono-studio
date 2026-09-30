import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackSummary } from "./tracks";

export type Gate = { lat: number; lon: number; label: string };

// A track as the Tracks screen shows it: the fastest lap in bold, other sessions faintly,
// the start/finish line as a checkered bar with an arrow for the direction of travel, and
// the sector gates when there are any. A catalog venue, when picked, gets a pin.
export function TracksMap({
  track,
  gates = [],
  venue,
  height,
}: {
  track?: TrackSummary;
  gates?: Gate[];
  venue?: { name: string; lat: number; lon: number } | null;
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
    if (!track) return;
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
    const line = track.line;
    if (line) {
      // A checkered bar across the direction of travel with its label above it, one marker
      // with a fixed size on screen, so it stays visible however far the map is zoomed out.
      L.marker([line.lat, line.lon], {
        icon: L.divIcon({
          className: "sf-bar-wrap",
          html: `<div class="sf-bar" style="transform:rotate(${line.heading}deg)"></div><div class="sf-tag">START / FINISH</div>`,
          iconSize: [150, 130],
          iconAnchor: [75, 78],
        }),
        interactive: false,
      }).addTo(g);
    }
    if (venue)
      L.marker([venue.lat, venue.lon], {
        icon: L.divIcon({
          className: "venue-pin",
          html: `<span>${venue.name.replace(/[<>&]/g, "")}</span>`,
          iconSize: [10, 10],
        }),
        interactive: false,
      }).addTo(g);
    if (venue) m.setView([venue.lat, venue.lon], 15, { animate: false });
    else if (track.outline.length)
      m.fitBounds(track.outline, { padding: [50, 50], animate: false });
  }, [track, gates.length, venue]);
  return (
    <div className="map-shell" style={{ height }}>
      <div ref={el} className="map" />
      <div className="map-tag">
        <span className="live-dot" />{" "}
        {track ? track.name.toUpperCase() : "TRACKS"}
      </div>
      {track && (
        <div className="map-legend">
          <span>
            <i style={{ background: "#63e5d2", height: 4 }} />
            Fastest lap
          </span>
          {track.others.length > 0 && (
            <span>
              <i style={{ background: "#9fb0b9", height: 2, opacity: 0.6 }} />
              Other sessions
            </span>
          )}
          {track.line && (
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
