import { useEffect, useState } from "react";
import { sha256 } from "hash-wasm";
import {
  readState,
  saveState,
  work,
  readEngineerCache,
  writeEngineerCache,
} from "../storage";
import { validateBoundary, type BoundaryAsset } from "./boundaries";
import type { ModeledLine } from "./optimizer";
import {
  limitsFromEnvelope,
  type Limits,
  type SpeedProfile,
} from "./speedProfile";
import type { Snapshot } from "./contracts";
type Configuration = {
  asset: BoundaryAsset;
  width: number;
  clearance: number;
  nodes: number;
  limits?: Limits;
};
type Result = { line: ModeledLine; profile: SpeedProfile | null };
const unavailable: Snapshot["modeled"] = {
  status: "unavailable",
  reasons: [
    "No validated boundary asset selected. Telemetry review is available without it.",
  ],
};
export function ModelPanel({
  layoutId,
  onStatus,
  envelope,
  contextKey,
  sessionIds,
}: {
  layoutId: string;
  envelope?: Snapshot["envelope"];
  contextKey: string;
  sessionIds: string[];
  onStatus: (state: Snapshot["modeled"]) => void;
}) {
  const [config, setConfig] = useState<Configuration>(),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<Result>(),
    [busy, setBusy] = useState(false),
    [limits, setLimits] = useState("");
  useEffect(() => {
    let live = true;
    setReady(false);
    setConfig(undefined);
    setResult(undefined);
    onStatus(unavailable);
    readState<Configuration>(`engineer-boundary:${layoutId}`)
      .then((c) => {
        if (!live) return;
        if (c) validateBoundary(c.asset, layoutId, false);
        setConfig(c);
        setReady(true);
      })
      .catch((e) => {
        if (live) {
          setError(String(e));
          setReady(true);
        }
      });
    return () => {
      live = false;
    };
  }, [layoutId]);
  const envelopeKey = JSON.stringify(envelope);
  useEffect(() => {
    if (!ready || !config) return;
    const control = new AbortController();
    let live = true;
    setBusy(true);
    setError("");
    setResult(undefined);
    onStatus({
      status: "not_ready",
      reasons: [
        "Checking boundaries and automatically computing locally in a worker.",
      ],
    });
    (async () => {
      const geometryKey = await sha256(
        JSON.stringify({
          algorithm: "line-1",
          asset: config.asset,
          width: config.width,
          clearance: config.clearance,
          nodes: config.nodes,
        }),
      );
      let line = await readEngineerCache<ModeledLine>(geometryKey);
      if (!line) {
        const r = await work<Result>(
          "engineer-model",
          { ...config, limits: undefined, layoutId },
          undefined,
          control.signal,
        );
        line = r.line;
        await writeEngineerCache(geometryKey, line, []);
      }
      if (!live) return;
      let profile: SpeedProfile | null = null;
      let profileReason =
        "Speed profile unavailable: no sufficiently supported continuous envelope; supply explicit conservative limits. Open runs also require entry/finish speeds.";
      const chosenLimits =
        config.limits ??
        (line.closed && envelope ? limitsFromEnvelope(envelope) : undefined);
      if (chosenLimits) {
        try {
          const key = await sha256(
            JSON.stringify({
              geometryKey,
              limits: chosenLimits,
              contextKey,
              algorithm: "profile-1",
            }),
          );
          profile = (await readEngineerCache<SpeedProfile>(key)) ?? null;
          if (!profile) {
            profile = await work<SpeedProfile>(
              "engineer-profile",
              { line, limits: chosenLimits },
              undefined,
              control.signal,
            );
            await writeEngineerCache(key, profile, sessionIds);
          }
        } catch (e) {
          profileReason = (e as Error).message;
        }
      }
      if (!live) return;
      setResult({ line, profile });
      setBusy(false);
      onStatus({
        status: "available",
        reasons: [
          `Geometry ${geometryKey}; ${line.points.length} nodes; ${line.diagnostics.method}`,
          profile
            ? `Physics-modeled time ${profile.totalMs.toFixed(0)} ms; declared ${profile.assumptions.source}; distinct from recorded and composite lap times.`
            : profileReason,
          ...line.assumptions,
        ],
      });
    })().catch((e) => {
      if (live) {
        setBusy(false);
        setError(e.message);
        onStatus({ status: "unavailable", reasons: [e.message] });
      }
    });
    return () => {
      live = false;
      control.abort();
    };
  }, [ready, config, layoutId, envelopeKey, contextKey]);
  const update = (c: Configuration) => {
    setConfig(c);
    saveState(`engineer-boundary:${layoutId}`, c).catch((e) =>
      setError(`Local boundary settings could not be saved: ${e.message}`),
    );
  };
  let path = "",
    baseline = "";
  if (result) {
    const p = [...result.line.points, ...config!.asset.spine],
      xs = p.map((p) => p[0]),
      ys = p.map((p) => p[1]),
      x = Math.min(...xs),
      y = Math.min(...ys),
      scale = 460 / Math.max(Math.max(...xs) - x, Math.max(...ys) - y, 1);
    const draw = (p: typeof result.line.points) =>
      p
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${20 + (p[0] - x) * scale},${480 - (p[1] - y) * scale}`,
        )
        .join(" ") + (result.line.closed ? " Z" : "");
    path = draw(result.line.points);
    baseline = draw(config!.asset.spine);
  }
  return (
    <details className="engineer-card">
      <summary>Modeled reference · optional track boundaries</summary>
      <p>
        Import a permitted boundary file with its own reference spine. Catalog
        outlines and recorded GPS paths are not track boundaries. Valid input
        automatically computes a local modeled line. Files and derived geometry
        stay local and are excluded from project exports and AI tools.
      </p>
      <label className="engineer-upload">
        Import boundary JSON
        <input
          type="file"
          accept=".json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              if (file.size > 8 * 1024 * 1024)
                throw Error("Boundary file exceeds 8 MB.");
              const asset = validateBoundary(
                JSON.parse(await file.text()),
                layoutId,
                false,
              );
              update({ asset, width: 1.8, clearance: 0.5, nodes: 250 });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </label>
      {config && (
        <>
          <p>
            Source: {config.asset.source} · {config.asset.date} · accuracy{" "}
            {config.asset.accuracyM ?? "unknown"} m · {config.asset.license} ·{" "}
            {config.asset.redistribution}. Width starts with a visible 1.8 m
            conservative assumption; adjust for your car.
          </p>
          <div className="engineer-fields">
            <label>
              Vehicle width (m)
              <input
                type="number"
                min=".5"
                max="4"
                step=".1"
                value={config.width}
                onChange={(e) =>
                  update({ ...config, width: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Edge clearance (m)
              <input
                type="number"
                min="0"
                max="5"
                step=".1"
                value={config.clearance}
                onChange={(e) =>
                  update({ ...config, clearance: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Solver nodes
              <input
                type="number"
                min="20"
                max="4000"
                step="10"
                value={config.nodes}
                onChange={(e) =>
                  update({ ...config, nodes: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            Conservative speed assumptions (JSON; SI units)
            <textarea
              value={limits}
              placeholder={
                '{"acceleration":2,"braking":4,"lateral":5,"maxSpeed":40,"source":"Conservative user assumptions"}'
              }
              onChange={(e) => setLimits(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              try {
                const v = JSON.parse(limits) as Limits;
                update({ ...config, limits: v });
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Apply speed assumptions
          </button>
          <button onClick={() => update({ ...config, limits: undefined })}>
            Geometry only
          </button>
        </>
      )}
      {busy && <p role="status">Computing locally in a worker…</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <figure>
            <svg
              viewBox="0 0 500 500"
              aria-label="Modeled line and reference spine"
              role="img"
            >
              <path d={baseline} fill="none" stroke="#6b7280" strokeWidth="2" />
              <path d={path} fill="none" stroke="#8ed4b2" strokeWidth="2" />
            </svg>
            <figcaption>
              Green: modeled minimum-curvature line. Gray: boundary spine. No
              claim of a guaranteed fastest or safe line.
            </figcaption>
          </figure>
          <p>
            {result.line.points.length} nodes · initialization{" "}
            {result.line.diagnostics.initMs.toFixed(0)} ms · solve and
            validation {result.line.diagnostics.solveMs.toFixed(0)} ms.
          </p>
          {result.profile && (
            <p>
              Physics-modeled time: {(result.profile.totalMs / 1000).toFixed(2)}{" "}
              s under the declared modeling assumptions. This is separate from
              recorded best and best-sector composite.
            </p>
          )}
        </>
      )}
    </details>
  );
}
