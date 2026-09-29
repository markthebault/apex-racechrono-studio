export type Channel = {
  id: string;
  name: string;
  unit: string;
  times: Float64Array;
  values: Float64Array;
  source: string;
};
export type Lap = {
  id: string;
  number: number;
  start: number;
  end: number;
  issues: string[];
};
export type Session = {
  id: string;
  filename: string;
  size: number;
  track: string;
  trackId: number;
  start: number;
  end: number;
  importedOptimal: number;
  times: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  channels: Channel[];
  laps: Lap[];
  unknown: string[];
};
export type Trace = {
  id: string;
  sessionId: string;
  label: string;
  lap: Lap;
  distance: Float64Array;
  times: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  channels: Record<string, Float64Array>;
  length: number;
  issues: string[];
};
export type Layout = {
  id: string;
  name: string;
  referenceId: string;
  gates: number[];
  generated: boolean;
};
export type Identity = { sha256: string; name: string; size: number };
export type Clip = Identity & { duration: number; start: number };
export type Binding = {
  session: Identity;
  clips: Clip[];
  anchors: { videoSeconds: number; sessionTimestamp: number }[];
};
export type SyncFile = { format: "apex-sync"; version: 1; bindings: Binding[] };
export type ChartConfig = { id: string; channels: string[]; height: number };
export type Settings = {
  speedUnit: "km/h" | "mph";
  colors: [string, string];
  videoHeight: number;
  a: string;
  b: string;
  charts: ChartConfig[];
  excluded: string[];
  included: string[];
  layouts: Layout[];
  mode: "distance" | "time";
  mapHeight: number;
  collection: string[];
  group?: "track" | "date";
  extras?: { id: string; color: string }[];
};
export const definitions: Record<string, { name: string; unit: string }> = {
  speed: { name: "GPS speed", unit: "km/h" },
  rpm: { name: "Engine speed", unit: "rpm" },
  throttle: { name: "Throttle position", unit: "%" },
  coolant: { name: "Coolant temperature", unit: "°C" },
  intake: { name: "Intake temperature", unit: "°C" },
  obdSpeed: { name: "OBD speed", unit: "km/h" },
  altitude: { name: "Altitude", unit: "m" },
  heading: { name: "Heading", unit: "°" },
  satellites: { name: "Satellites", unit: "" },
  acceleration: { name: "Longitudinal acceleration · calculated", unit: "g" },
};
export const lapTime = (ms: number) =>
  !Number.isFinite(ms)
    ? "—"
    : `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;

// A lap drawn against lap A. The first is lap B; more can be added.
export type Comparison = {
  trace: Trace;
  color: string;
  // Where this lap is while lap A sits at the cursor.
  cursor: number;
  tag: string;
};
