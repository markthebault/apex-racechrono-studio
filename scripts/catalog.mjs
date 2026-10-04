// Regenerates the venue catalog from OpenStreetMap: public/tracks.json (names, positions,
// layout lists) and public/venues/<cell>.json (the geometry, one file per 2° cell).
// Overpass is asked in 10° tiles, with retries, skipping tiles where the previous catalog
// has no circuit (pass --all to ask every tile). Tiles are cached in .private/osm-cache so
// an interrupted run resumes; delete that folder to fetch fresh data. A failed tile stops
// the run and leaves the previous catalog in place.
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { buildVenues } from "../src/venueBuild.ts";

const servers = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const cache = ".private/osm-cache";
await mkdir(cache, { recursive: true });

// One Overpass query with retries across servers, cached in a file. Null if all fail.
const cachedOnly = process.argv.includes("--cached-only");
async function ask(file, query) {
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  if (cachedOnly) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = servers[attempt % servers.length];
    try {
      const r = await fetch(url, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "User-Agent": "ApexTrackStudio/0.1 catalog-generator" },
        signal: AbortSignal.timeout(330000),
      });
      const text = await r.text();
      if (text.startsWith("{")) {
        const data = JSON.parse(text);
        if (data.remark && /error|timed out|out of memory/i.test(data.remark))
          throw Error(data.remark);
        await writeFile(file, JSON.stringify(data.elements));
        return data.elements;
      }
      console.log(`  ${url}: HTTP ${r.status}`);
    } catch (error) {
      console.log(`  ${url}: ${error.message}`);
    }
    await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1)));
  }
  return null;
}

// Raceways and circuit layouts in one tile. A tile that fails everywhere is split in four.
async function fetchTile(s, w, n, e) {
  const file = `${cache}/${s}_${w}_${n}_${e}.json`;
  const got = await ask(
    file,
    `[out:json][timeout:120][bbox:${s},${w},${n},${e}];
way[highway=raceway];out body geom qt;
rel[type=circuit];out body qt;
rel[highway=raceway][name];out tags bb qt;`,
  );
  if (got) return got;
  if (n - s <= 1.5) throw Error(`Tile ${s},${w} failed on every server`);
  const ms = (s + n) / 2,
    mw = (w + e) / 2;
  const parts = [];
  for (const [a, b, c, d] of [
    [s, w, ms, mw],
    [s, mw, ms, e],
    [ms, w, n, mw],
    [ms, mw, n, e],
  ])
    parts.push(...(await fetchTile(a, b, c, d)));
  await writeFile(file, JSON.stringify(parts));
  return parts;
}

// --cached-only: never ask a server, build from what is already in the cache.
// --seed: only the circuits listed in scripts/seed-circuits.json, one small request each.
// Fast and reliable on busy servers; a good first catalog to try the app with.
const seed = process.argv.includes("--seed");
const seedTiles = async () => {
  const list = JSON.parse(await readFile("scripts/seed-circuits.json", "utf8"));
  const out = [];
  for (const c of list) {
    const box = [c.lat - 0.12, c.lon - 0.18, c.lat + 0.12, c.lon + 0.18].map(
      (x) => +x.toFixed(3),
    );
    const got = await ask(
      `${cache}/seed_${box.join("_")}.json`,
      `[out:json][timeout:90][bbox:${box.join(",")}];
way[highway=raceway];out body geom qt;
rel[type=circuit];out body qt;
rel[highway=raceway][name];out tags bb qt;`,
    );
    if (!got) {
      if (cachedOnly) continue;
      throw Error(`${c.name} failed on every server`);
    }
    console.log(`Seed ${c.name}: ${got.length} elements`);
    out.push(...got);
  }
  return out;
};

const tileKey = (lat, lon) =>
  `${Math.floor(lat / 10) * 10}_${Math.floor(lon / 10) * 10}`;
let known = null;
if (!process.argv.includes("--all") && existsSync("public/tracks.json")) {
  const previous = JSON.parse(await readFile("public/tracks.json", "utf8"));
  const list = previous.venues ?? previous.tracks ?? [];
  if (list.length) known = new Set(list.map((t) => tileKey(t.lat, t.lon)));
}
// Named venue areas, which give most venues their name, in one worldwide query.
const areas = await ask(
  `${cache}/areas.json`,
  `[out:json][timeout:300];(nwr[leisure=sports_centre][sport~"motor|karting"][name];way[leisure=track][sport~"motor|karting"][name];);out tags bb qt;`,
);
if (!areas) throw Error("Venue areas failed on every server");
const elements = [...areas];
if (seed) elements.push(...(await seedTiles()));
else
  for (let s = -60; s < 80; s += 10)
    for (let w = -180; w < 180; w += 10) {
      if (known && !known.has(`${s}_${w}`)) continue;
      const tile = await fetchTile(s, w, s + 10, w + 10);
      console.log(`Tile ${s},${w}: ${tile.length} elements`);
      for (const e of tile) elements.push(e);
    }

const { index, cells } = buildVenues(elements);
await rm("public/venues", { recursive: true, force: true });
await mkdir("public/venues");
for (const [cell, venues] of cells)
  await writeFile(`public/venues/${cell}.json`, JSON.stringify(venues));
await writeFile(
  "public/tracks.json",
  JSON.stringify({
    source: "OpenStreetMap contributors",
    license: "ODbL-1.0",
    generated: new Date().toISOString(),
    venues: index,
    tracks: existsSync("public/tracks.json")
      ? (JSON.parse(await readFile("public/tracks.json", "utf8")).tracks ?? [])
      : [],
  }),
);
const layouts = index.reduce((n, v) => n + v.layouts.length, 0);
console.log(
  `Saved ${index.length} venues, ${layouts} layouts, ${cells.size} cell files`,
);
