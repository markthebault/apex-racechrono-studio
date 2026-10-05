import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { TrackViewProps } from "./TrackView";
import {
  trackColor,
  trackFrame,
  trackSegments,
  trackPosition,
  type TrackPoint,
} from "./track3d";
import {
  atDistance,
  brakeSignal,
  brakingRuns,
  smoothedBrake,
  brakeColor,
  speedColor,
  SPEED_SCALE,
  isBraking,
} from "./analysis";
import { hoverBus } from "./hover";

function label(text: string, color: string, size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#101e28";
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 56, 12);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#edf8fc";
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 64, 43);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
    }),
  );
  sprite.scale.set(size * 2, size, 1);
  return sprite;
}
function car(color: string, size: number, tag: string, ghost = false) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.35,
    roughness: 0.3,
    transparent: ghost,
    opacity: ghost ? 0.35 : 1,
  });
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.46, size * 0.18, size),
    bodyMaterial,
  );
  body.position.y = size * 0.19;
  group.add(body);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.36, size * 0.16, size * 0.43),
    new THREE.MeshStandardMaterial({
      color: "#172b3c",
      metalness: 0.65,
      roughness: 0.2,
      transparent: ghost,
      opacity: ghost ? 0.3 : 1,
    }),
  );
  glass.position.set(0, size * 0.34, size * 0.06);
  group.add(glass);
  const wheelMaterial = new THREE.MeshStandardMaterial({
    color: "#080d14",
    transparent: ghost,
    opacity: ghost ? 0.3 : 1,
  });
  for (const x of [-0.25, 0.25])
    for (const z of [-0.31, 0.31]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.11, size * 0.11, size * 0.09, 12),
        wheelMaterial,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(size * x, size * 0.11, size * z);
      group.add(wheel);
    }
  const headlights = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.35, size * 0.045, size * 0.025),
    new THREE.MeshBasicMaterial({ color: "#e5f8ff" }),
  );
  headlights.position.set(0, size * 0.21, -size * 0.51);
  group.add(headlights);
  const name = label(tag, color, size * 0.6);
  name.position.y = size * 1.1;
  group.add(name);
  return { group, bodyMaterial, color };
}
function ribbon(
  points: TrackPoint[],
  halfWidth: number,
  colorAt: (i: number) => string,
  floor?: number,
) {
  const positions: number[] = [],
    colors: number[] = [];
  const sides = points.map((p, i) => {
    const prev = points[Math.max(0, i - 1)],
      next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x,
      dz = next.z - prev.z,
      length = Math.hypot(dx, dz) || 1;
    return [
      new THREE.Vector3(
        p.x - (dz / length) * halfWidth,
        p.y,
        p.z + (dx / length) * halfWidth,
      ),
      new THREE.Vector3(
        p.x + (dz / length) * halfWidth,
        p.y,
        p.z - (dx / length) * halfWidth,
      ),
    ];
  });
  const triangle = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    color: THREE.Color,
  ) => {
    for (const p of [a, b, c]) {
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let i = 1; i < sides.length; i++) {
    const color = new THREE.Color(trackColor(colorAt(points[i].index)));
    if (floor === undefined) {
      triangle(sides[i - 1][0], sides[i - 1][1], sides[i][0], color);
      triangle(sides[i - 1][1], sides[i][1], sides[i][0], color);
    } else
      for (const side of [0, 1]) {
        const a = sides[i - 1][side],
          b = sides[i][side];
        const lowA = new THREE.Vector3(a.x, floor, a.z),
          lowB = new THREE.Vector3(b.x, floor, b.z);
        triangle(a, lowA, b, color);
        triangle(lowA, lowB, b, color);
      }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.1,
    }),
  );
}
export default function Track3D({
  a,
  others = [],
  colors = ["#ff8855", "#8ed4b2"],
  cursor,
  gates,
  brakeMarkers = [],
  onCursor,
  height,
  onHeight,
  speedUnit = "km/h",
}: TrackViewProps) {
  const el = useRef<HTMLDivElement>(null);
  const [exaggeration, setExaggeration] = useState(2);
  const [showSpeed, setShowSpeed] = useState(true),
    [showBrake, setShowBrake] = useState(false);
  const [error, setError] = useState("");
  const [ghost, setGhost] = useState<number | null>(null);
  useEffect(() => hoverBus.subscribe(setGhost), []);
  const frame = useMemo(() => (a ? trackFrame(a) : undefined), [a]);
  const latest = useRef({ cursor, others, ghost, onCursor });
  latest.current = { cursor, others, ghost, onCursor };
  const reset = useRef<() => void>(() => {});
  const lapKey = others.map((o) => o.trace.id + o.color + o.tag).join("|");
  useEffect(() => {
    if (!a || !frame || !el.current) return;
    const host = el.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("3D needs WebGL in your browser. You can still use the 2D map.");
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      "3D track. Drag to orbit, scroll to zoom, click the track to seek.",
    );
    const scene = new THREE.Scene();
    const segments = trackSegments(a, frame, exaggeration);
    const points = segments.flat();
    const bounds = new THREE.Box3();
    points.forEach((p) =>
      bounds.expandByPoint(new THREE.Vector3(p.x, p.y, p.z)),
    );
    const centre = points.length
      ? bounds.getCenter(new THREE.Vector3())
      : new THREE.Vector3();
    const dimensions = points.length
      ? bounds.getSize(new THREE.Vector3())
      : new THREE.Vector3(100, 0, 100);
    const extent = Math.max(dimensions.x, dimensions.y, dimensions.z, 100);
    const width = extent / 170,
      floor = -extent * 0.045;
    const camera = new THREE.PerspectiveCamera(
      38,
      1,
      extent / 1000,
      extent * 30,
    );
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = extent * 0.08;
    controls.maxDistance = extent * 8;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;
    reset.current = () => {
      controls.target.copy(centre);
      // Fit the projected bounds, with the long axis across the viewport.
      const direction = new THREE.Vector3(
        dimensions.z > dimensions.x ? 1 : 0.25,
        0.9,
        dimensions.z > dimensions.x ? 0.25 : 1,
      ).normalize();
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), direction)
        .normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      let distance = 100;
      for (const p of points) {
        const corner = new THREE.Vector3(p.x, p.y, p.z).sub(centre);
        distance = Math.max(
          distance,
          corner.dot(direction) +
            Math.max(
              Math.abs(corner.dot(right)) / (tanY * camera.aspect),
              Math.abs(corner.dot(up)) / tanY,
            ),
        );
      }
      camera.position
        .copy(centre)
        .add(direction.multiplyScalar(distance * 1.15));
      controls.update();
    };
    scene.add(new THREE.HemisphereLight("#c9e5ff", "#253b3e", 2.4));
    const sun = new THREE.DirectionalLight("#fff4de", 3);
    sun.position.set(extent, extent * 2, extent);
    scene.add(sun);
    const grid = new THREE.GridHelper(extent * 2.4, 24, "#355366", "#1e3344");
    grid.position.set(centre.x, floor, centre.z);
    scene.add(grid);
    const braking = new Map<number, number>();
    if (showBrake)
      for (const [from, to] of brakingRuns(a)) {
        const values = smoothedBrake(a, from, to);
        for (let i = from; i <= to; i++) braking.set(i, values[i - from]);
      }
    const telemetryColor = (i: number) =>
      braking.has(i)
        ? brakeColor(braking.get(i)!)
        : showSpeed && Number.isFinite(a.channels.speed?.[i])
          ? speedColor(a.channels.speed[i])
          : colors[0];
    const roads: THREE.Mesh[] = [];
    for (const part of segments) {
      scene.add(ribbon(part, width, () => "#506376", floor));
      const road = ribbon(
        part.map((p) => ({ ...p, y: p.y + width * 0.04 })),
        width,
        telemetryColor,
      );
      scene.add(road);
      roads.push(road);
      // A pale border keeps the track readable against its elevation walls.
      const edge = ribbon(part, width * 1.08, () => "#a1b7c7");
      edge.position.y = -width * 0.025;
      scene.add(edge);
    }
    const laps = [
      { trace: a, color: colors[0], tag: "A" },
      ...latest.current.others,
    ];
    const cars = laps.map((lap) => {
      if (lap.trace !== a)
        for (const part of trackSegments(lap.trace, frame, exaggeration)) {
          const line = ribbon(
            part.map((p) => ({ ...p, y: p.y + width * 0.16 })),
            width * 0.18,
            () => lap.color,
          );
          scene.add(line);
        }
      const current = car(lap.color, extent / 80, lap.tag),
        hover = car(lap.color, extent / 80, lap.tag, true);
      scene.add(current.group, hover.group);
      return { ...lap, current, hover };
    });
    const gateLabels: THREE.Sprite[] = [];
    for (const point of brakeMarkers) {
      const p = trackPosition(point.trace, point.distance, frame, exaggeration);
      if (!p) continue;
      const marker = label(point.label, point.color, extent / 110);
      marker.position.set(p.x, p.y + width * 4, p.z);
      scene.add(marker);
      gateLabels.push(marker);
    }
    for (const [i, d] of gates.entries()) {
      const p = trackPosition(a, d, frame, exaggeration);
      if (!p) continue;
      const marker = label(
        i === 0 ? "S" : i === gates.length - 1 ? "F" : String(i),
        "#9cb6c8",
        extent / 110,
      );
      marker.position.set(p.x, p.y + width * 3, p.z);
      scene.add(marker);
      gateLabels.push(marker);
    }
    const observer = new ResizeObserver(() => {
      const w = host.clientWidth,
        h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    });
    observer.observe(host);
    renderer.setSize(host.clientWidth, host.clientHeight);
    camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
    camera.updateProjectionMatrix();
    reset.current();
    const raycaster = new THREE.Raycaster();
    let down = { x: 0, y: 0 };
    const pointerDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObjects(roads)[0];
      if (!hit) return;
      let best = Infinity,
        distance = 0;
      for (const p of points) {
        const squared = hit.point.distanceToSquared(
          new THREE.Vector3(p.x, p.y, p.z),
        );
        if (squared < best) {
          best = squared;
          distance = p.distance;
        }
      }
      latest.current.onCursor(distance);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    const lost = (e: Event) => {
      e.preventDefault();
      setError(
        "The 3D graphics context was lost. Switch to 2D, then back to 3D to reload.",
      );
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    let raf = 0;
    const updateCar = (
      item: ReturnType<typeof car>,
      t: typeof a,
      d: number | null,
    ) => {
      const p =
        d === null ? undefined : trackPosition(t, d, frame, exaggeration);
      item.group.visible = !!p;
      if (!p || d === null) return;
      item.group.position.set(p.x, p.y + width * 0.2, p.z);
      const metresPerPixel =
        (2 *
          camera.position.distanceTo(item.group.position) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
        Math.max(host.clientHeight, 1);
      item.group.scale.setScalar(
        Math.max(1, (metresPerPixel * 22) / (extent / 80)),
      );
      const before = trackPosition(t, Math.max(0, d - 3), frame, exaggeration),
        after = trackPosition(
          t,
          Math.min(t.length, d + 3),
          frame,
          exaggeration,
        );
      if (before && after) {
        const forward = new THREE.Vector3(
          after.x - before.x,
          after.y - before.y,
          after.z - before.z,
        ).normalize();
        if (forward.lengthSq())
          item.group.quaternion.setFromRotationMatrix(
            new THREE.Matrix4().lookAt(
              new THREE.Vector3(),
              forward,
              new THREE.Vector3(0, 1, 0),
            ),
          );
      }
      item.bodyMaterial.color.set(isBraking(t, d) ? "#ff3434" : item.color);
    };
    const render = () => {
      for (const lap of cars) {
        const d =
          lap.trace === a
            ? latest.current.cursor
            : (latest.current.others.find((o) => o.tag === lap.tag)?.cursor ??
              null);
        updateCar(lap.current, lap.trace, d);
        updateCar(lap.hover, lap.trace, latest.current.ghost);
      }
      controls.update();
      for (const marker of gateLabels) {
        const size =
          ((2 *
            camera.position.distanceTo(marker.position) *
            Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
            Math.max(host.clientHeight, 1)) *
          13;
        marker.scale.set(size * 2, size, 1);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (mesh.material)
          for (const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]) {
            (material as THREE.MeshBasicMaterial).map?.dispose();
            material.dispose();
          }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      host.replaceChildren();
    };
  }, [
    a,
    frame,
    lapKey,
    colors[0],
    exaggeration,
    showSpeed,
    showBrake,
    gates,
    brakeMarkers,
  ]);
  const recorded = a ? brakeSignal(a).recorded : false;
  const altitude = a?.channels.altitude
    ? atDistance(a, a.channels.altitude, cursor)
    : NaN;
  return (
    <div className="map-shell map-3d" style={{ height }}>
      <div ref={el} className="map-3d-canvas" />
      <div className="map-tag">
        <span className="live-dot" /> ELEVATION VIEW <span>Recorded GPS</span>
      </div>
      {error && (
        <div className="track-3d-error" role="alert">
          {error}
        </div>
      )}
      {!frame && <div className="track-3d-error">No GPS trace available.</div>}
      <div className="map-tools track-3d-tools">
        <button
          aria-pressed={showSpeed}
          disabled={!a?.channels.speed}
          onClick={() => setShowSpeed(!showSpeed)}
        >
          <i className="speed" />
          Speed colours
        </button>
        <button
          aria-pressed={showBrake}
          disabled={!a || (!recorded && !a.channels.acceleration)}
          onClick={() => setShowBrake(!showBrake)}
        >
          <i className="brake" />
          Braking zones
        </button>
        <label className="elevation-control">
          Elevation <b>{exaggeration}×</b>
          <input
            aria-label="Elevation exaggeration"
            type="range"
            min="1"
            max="5"
            step=".5"
            value={exaggeration}
            disabled={!frame?.hasElevation}
            onChange={(e) => setExaggeration(+e.target.value)}
          />
        </label>
        <button onClick={() => reset.current()}>Reset camera</button>
      </div>
      <div className="track-3d-readout">
        <strong>
          {Number.isFinite(altitude)
            ? `${Math.round(altitude)} m`
            : "No elevation"}
        </strong>
        <span>
          {frame?.hasElevation
            ? `${Math.round(frame.relief)} m elevation range · ${exaggeration}× height`
            : "Altitude unavailable · flat track"}
        </span>
        {frame?.partialElevation && (
          <span>Missing altitude sections are omitted</span>
        )}
      </div>
      <div className="track-3d-legend">
        {showSpeed && (
          <div className="scale">
            <div className="speed-ramp" />
            <span>
              {SPEED_SCALE.map((v) =>
                Math.round(speedUnit === "mph" ? v / 1.609344 : v),
              ).join(" · ")}{" "}
              {speedUnit}
            </span>
          </div>
        )}
        {showBrake && (
          <div className="scale">
            <div className="brake-ramp" />
            <span>
              {recorded ? "Recorded brake" : "Braking inferred from GPS speed"}{" "}
              · light to hard
            </span>
          </div>
        )}
        <span>Drag to orbit · scroll to zoom · click track to seek</span>
        <span>Track width and cars enlarged for visibility</span>
      </div>
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
