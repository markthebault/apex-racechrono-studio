import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Trace, Comparison } from "./model";
import { hoverBus } from "./hover";
import {
  interpolate,
  atDistance,
  isBraking,
  bearing,
  nearestOnTrace,
  BRAKE_G,
} from "./analysis";

const safe = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#63e5d2");
// Top-down car, nose up. The body turns red under braking; the outline keeps the lap color.
function carIcon(
  color: string,
  braking: boolean,
  heading: number,
  tag: string,
  ghost = false,
) {
  const body = braking ? "#ff2a2a" : safe(color);
  return L.divIcon({
    className: "car-icon",
    iconSize: [26, 40],
    iconAnchor: [13, 20],
    html: `<div class="car${braking ? " braking" : ""}${ghost ? " ghost" : ""}"><svg viewBox="0 0 20 36" width="20" height="36" style="transform:rotate(${Number.isFinite(heading) ? heading.toFixed(0) : 0}deg)">${braking ? '<ellipse cx="10" cy="18" rx="10" ry="17.5" fill="#ff2a2a" opacity=".35"/>' : ""}<rect x="0.5" y="6" width="3" height="7" rx="1" fill="#0b1114"/><rect x="16.5" y="6" width="3" height="7" rx="1" fill="#0b1114"/><rect x="0.5" y="24" width="3" height="7" rx="1" fill="#0b1114"/><rect x="16.5" y="24" width="3" height="7" rx="1" fill="#0b1114"/><rect x="3" y="1.5" width="14" height="33" rx="6" fill="${body}" stroke="${safe(color)}" stroke-width="2"/><rect x="5.5" y="10" width="9" height="6" rx="1.5" fill="#0b1114" opacity=".85"/><rect x="6" y="24" width="8" height="4" rx="1.5" fill="#0b1114" opacity=".85"/></svg><b style="border-color:${safe(color)}">${tag}</b></div>`,
  });
}
export function TrackMap({
  a,
  colors = ["#63e5d2", "#f8a36b"],
  others = [],
  cursor,
  range,
  gates,
  onCursor,
  height,
  onHeight,
  center,
}: {
  a?: Trace;
  colors?: [string, string];
  others?: Comparison[];
  cursor: number;
  range: [number, number];
  gates: number[];
  onCursor: (d: number) => void;
  height: number;
  onHeight: (h: number) => void;
  center?: [number, number];
}) {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<L.LayerGroup | null>(null),
    markers = useRef<L.LayerGroup | null>(null),
    ghosts = useRef<L.LayerGroup | null>(null);
  // Distance under the pointer on a chart. Ghost cars mark it on every lap.
  const [ghost, setGhost] = useState<number | null>(null);
  useEffect(() => hoverBus.subscribe(setGhost), []);
  // The click handler reads the latest props through this ref.
  const latest = useRef({ a, others, range, onCursor });
  latest.current = { a, others, range, onCursor };
  // The traces only need redrawing when the laps themselves change, not on every cursor move.
  const lapKey = others.map((o) => o.trace.id + o.color).join("|");
  useEffect(() => {
    const m = L.map(el.current!, {
      zoomControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    }).setView([50.35, 6.95], 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      maxZoom: 19,
    }).addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    // Click anywhere near a trace, not only on its 3 px stroke, to move the cursor.
    m.on("click", (e) => {
      const { a, others, range, onCursor } = latest.current;
      let best: { distance: number; px: number } | undefined;
      for (const t of [a, ...others.map((o) => o.trace)]) {
        if (!t) continue;
        const n = nearestOnTrace(t, e.latlng.lat, e.latlng.lng, range);
        if (!n) continue;
        const px = m
          .latLngToContainerPoint([n.lat, n.lon])
          .distanceTo(e.containerPoint);
        if (!best || px < best.px) best = { distance: n.distance, px };
      }
      if (best && best.px <= 30) onCursor(best.distance);
    });
    map.current = m;
    layers.current = L.layerGroup().addTo(m);
    markers.current = L.layerGroup().addTo(m);
    ghosts.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(el.current!);
    return () => {
      observer.disconnect();
      m.remove();
    };
  }, []);
  useEffect(() => {
    if (center) map.current?.setView(center, 14, { animate: false });
  }, [center]);
  useEffect(() => {
    const group = layers.current;
    group?.clearLayers();
    if (!a) return;
    const drawn: [Trace, string][] = [
      ...latest.current.others
        .map((o) => [o.trace, o.color] as [Trace, string])
        .reverse(),
      [a, colors[0]],
    ];
    for (const [t, color] of drawn) {
      let line: L.LatLngTuple[] = [];
      const flush = () => {
        if (line.length > 1)
          L.polyline(line, {
            color,
            weight: t === a ? 3 : 2.5,
            opacity: 0.9,
            interactive: false,
          }).addTo(group!);
        line = [];
      };
      for (let i = 0; i < t.lat.length; i += 5) {
        if (
          !Number.isFinite(t.lat[i]) ||
          (i >= 5 && t.times[i] - t.times[i - 5] > 2000)
        ) {
          flush();
          continue;
        }
        line.push([t.lat[i], t.lon[i]]);
      }
      flush();
    }
    for (let i = 0; i < gates.length; i++) {
      const d = gates[i],
        lat = interpolate(a.distance, a.lat, d),
        lon = interpolate(a.distance, a.lon, d);
      if (Number.isFinite(lat))
        L.marker([lat, lon], {
          icon: L.divIcon({
            className: "gate",
            html: i === 0 ? "S" : i === gates.length - 1 ? "F" : String(i),
            iconSize: [22, 22],
          }),
        }).addTo(group!);
    }
  }, [a, lapKey, gates, colors[0]]);
  // The view follows the zoom window. While the window scrolls during playback this runs
  // every few milliseconds, so refitting is limited to a few times a second.
  const fitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastFit = useRef(0);
  useEffect(() => {
    if (!a) return;
    const fit = () => {
      lastFit.current = Date.now();
      const coords: Array<[number, number]> = [];
      for (let i = 0; i < a.lat.length; i += 10)
        if (
          a.distance[i] >= range[0] &&
          a.distance[i] <= range[1] &&
          Number.isFinite(a.lat[i])
        )
          coords.push([a.lat[i], a.lon[i]]);
      if (coords.length)
        map.current?.fitBounds(coords, { padding: [35, 35], animate: false });
    };
    clearTimeout(fitTimer.current);
    const wait = 350 - (Date.now() - lastFit.current);
    if (wait <= 0) fit();
    else fitTimer.current = setTimeout(fit, wait);
    return () => clearTimeout(fitTimer.current);
  }, [a, range[0], range[1]]);
  useEffect(() => {
    markers.current?.clearLayers();
    const cars: [Trace, string, string, number][] = [
      ...others
        .map(
          (o) =>
            [o.trace, o.color, o.tag, o.cursor] as [
              Trace,
              string,
              string,
              number,
            ],
        )
        .reverse(),
      [a!, colors[0], "A", cursor],
    ];
    for (const [t, color, tag, d] of cars) {
      if (!t) continue;
      const lat = atDistance(t, t.lat, d),
        lon = atDistance(t, t.lon, d);
      if (Number.isFinite(lat))
        L.marker([lat, lon], {
          icon: carIcon(color, isBraking(t, d), bearing(t, d), tag),
          interactive: false,
          keyboard: false,
          zIndexOffset: t === a ? 1000 : 900,
        }).addTo(markers.current!);
    }
  }, [a, others, cursor, colors[0]]);
  useEffect(() => {
    ghosts.current?.clearLayers();
    if (ghost === null || !a) return;
    const laps: [Trace, string, string][] = [
      ...others.map(
        (o) => [o.trace, o.color, o.tag] as [Trace, string, string],
      ),
      [a, colors[0], "A"],
    ];
    for (const [t, color, tag] of laps) {
      const lat = atDistance(t, t.lat, ghost),
        lon = atDistance(t, t.lon, ghost);
      if (Number.isFinite(lat))
        L.marker([lat, lon], {
          icon: carIcon(
            color,
            isBraking(t, ghost),
            bearing(t, ghost),
            tag,
            true,
          ),
          interactive: false,
          keyboard: false,
          zIndexOffset: 500,
        }).addTo(ghosts.current!);
    }
  }, [ghost, a, others, colors[0]]);
  return (
    <div className="map-shell" style={{ height }}>
      <div ref={el} className="map" />
      <div className="map-tag">
        <span className="live-dot" /> GPS TRACE <span>OpenStreetMap</span>
      </div>
      {a && (
        <div className="map-legend">
          {[
            [a, colors[0], "A"] as const,
            ...others.map((o) => [o.trace, o.color, o.tag] as const),
          ].map(([t, color, tag]) => (
            <span key={tag}>
              <i style={{ background: safe(color) }} />
              {tag} · {t.label}
            </span>
          ))}
          <span>
            <i className="brake" />
            Braking below {BRAKE_G} g
          </span>
        </div>
      )}
      <div className="map-resize">
        <label>
          Map height{" "}
          <input
            aria-label="Map height"
            type="range"
            min="240"
            max="650"
            value={height}
            onChange={(e) => onHeight(+e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
