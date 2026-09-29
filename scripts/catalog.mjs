import { writeFile } from "node:fs/promises";
const query =
  "[out:json][timeout:180];way[highway=raceway][name];out tags center;";
const response = await fetch("https://overpass.kumi.systems/api/interpreter", {
  method: "POST",
  body: new URLSearchParams({ data: query }),
  headers: { "User-Agent": "ApexTrackStudio/0.1 catalog-generator" },
});
if (!response.ok) throw Error(`Catalog fetch failed: ${response.status}`);
const data = await response.json();
if (data.remark) throw Error(data.remark);
const seen = new Set();
const tracks = data.elements
  .filter((e) => e.tags?.name && (e.center || e.lat))
  .map((e) => ({
    id: `osm:${e.type}:${e.id}`,
    name: e.tags.name,
    lat: e.center?.lat ?? e.lat,
    lon: e.center?.lon ?? e.lon,
  }))
  .filter((t) => {
    const k = t.name + Math.round(t.lat * 100) + Math.round(t.lon * 100);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
await writeFile(
  "public/tracks.json",
  JSON.stringify({
    source: "OpenStreetMap contributors",
    license: "ODbL-1.0",
    generated: new Date().toISOString(),
    tracks,
  }),
);
console.log(`Saved ${tracks.length} mapped tracks`);
