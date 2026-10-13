import { describe, expect, it } from "vitest";
import { referenceLap } from "./groups";
import type { Session, Settings } from "./model";

function session(id: string, trackId: number, durations: number[]): Session {
  return {
    id,
    trackId,
    track: `Track ${trackId}`,
    filename: "recording.vbo",
    size: 0,
    start: 0,
    end: 0,
    importedOptimal: NaN,
    format: "vbo",
    times: new Float64Array(),
    lat: new Float64Array(),
    lon: new Float64Array(),
    channels: [],
    unknown: [],
    laps: durations.map((duration, i) => ({
      id: `${id}:${i}`,
      number: i + 1,
      start: 0,
      end: duration,
      issues: [],
    })),
  };
}
const savedLayout = (referenceId: string): Settings["layouts"] => [
  {
    id: "layout",
    name: "Saved layout",
    referenceId,
    gates: [0, 1000],
    generated: false,
  },
];
describe("analysis collection reference", () => {
  it("switches to the selected track even when lap A belonged to another track", () => {
    const old = session("old", 1, [80000]),
      next = session("next", 2, [95000, 90000]);
    expect(
      referenceLap(
        [old, next],
        [next.id],
        old.laps[0].id,
        savedLayout(old.laps[0].id),
      ),
    ).toBe(next.laps[1].id);
  });
  it("does not show another track's reference when the selected VBO has no laps", () => {
    const timed = session("timed", 1, [80000]),
      untimed = session("untimed", 2, []);
    expect(
      referenceLap(
        [timed, untimed],
        [untimed.id],
        timed.laps[0].id,
        savedLayout(timed.laps[0].id),
      ),
    ).toBeUndefined();
  });
  it("does not reuse a saved layout from an excluded session on the same track", () => {
    const excluded = session("excluded", 1, [80000]),
      chosen = session("chosen", 1, [95000]);
    expect(
      referenceLap(
        [excluded, chosen],
        [chosen.id],
        "",
        savedLayout(excluded.laps[0].id),
      ),
    ).toBe(chosen.laps[0].id);
  });
  it("keeps the current track's saved reference when every session is selected", () => {
    const a = session("a", 1, [100000, 95000]),
      b = session("b", 2, [80000]);
    expect(
      referenceLap([a, b], [], a.laps[1].id, savedLayout(a.laps[0].id)),
    ).toBe(a.laps[0].id);
  });
});
