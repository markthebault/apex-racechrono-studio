import type { Channel, Trace } from "../model";
import { derivative, physicalCurvature, sample, type Signal } from "./signals";
export type ForceAxis = {
  channel?: Channel;
  source: "recorded" | "speed-derived" | "gps-derived" | "unavailable";
  note: string;
};
export function forceAxes(
  t: Trace,
  signals: Signal[],
): { longitudinal: ForceAxis; lateral: ForceAxis } {
  const speed = signals.find((s) => s.semantic === "speed")?.channel;
  const long = signals.find((s) => s.semantic === "longitudinal")?.channel;
  const lat = signals.find((s) => s.semantic === "lateral")?.channel;
  const curvature = !lat && speed ? physicalCurvature(t) : undefined;
  return {
    longitudinal: long
      ? {
          channel: long,
          source: "recorded",
          note: "Mapped recorded acceleration; axis orientation/calibration must be verified. Not brake-pedal input.",
        }
      : speed
        ? {
            channel: derivative(speed),
            source: "speed-derived",
            note: "Speed derivative with centered 0.6 s local regression; grade, wind and noise affect it. Not brake pressure.",
          }
        : {
            source: "unavailable",
            note: "No verified speed or longitudinal channel.",
          },
    lateral: lat
      ? {
          channel: lat,
          source: "recorded",
          note: "Mapped recorded acceleration; axis orientation/calibration must be verified. Not unused grip.",
        }
      : speed
        ? {
            channel: {
              id: "derived-lateral",
              name: "GPS lateral acceleration estimate",
              unit: "m/s²",
              source:
                "Speed squared × signed GPS physical curvature; flat-track estimate",
              times: t.times,
              values: Float64Array.from(t.times, (time, i) => {
                const v = sample(speed, time);
                return v * v * curvature![i];
              }),
            },
            source: "gps-derived",
            note: "Speed² × GPS path curvature. Flat-track estimate; banking, GPS noise and smoothing affect it. Not a tyre-force or grip-limit measurement.",
          }
        : {
            source: "unavailable",
            note: "No verified speed or lateral channel.",
          },
  };
}
