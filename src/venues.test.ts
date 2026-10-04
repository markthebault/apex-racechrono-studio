import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { catalogVenues, searchVenues, venueOf } from "./venues";
it("preserves full location search alongside enriched venues without duplicate IDs", () => {
  const data = JSON.parse(readFileSync("public/tracks.json", "utf8"));
  const catalog = catalogVenues(data);
  expect(data.tracks.length).toBeGreaterThan(6000);
  expect(catalog.length).toBeGreaterThan(6000);
  expect(new Set(catalog.map((v) => v.id)).size).toBe(catalog.length);
  for (const venue of data.venues)
    expect(catalog.find((v) => v.id === venue.id)).toEqual(venue);
  const location = catalog.find((v) => !v.cell)!;
  expect(
    searchVenues(catalog, location.name, catalog.length).some(
      (v) => v.venue.id === location.id,
    ),
  ).toBe(true);
  expect(
    venueOf({ outline: [[location.lat, location.lon]] }, [location]),
  ).toBeUndefined();
});
