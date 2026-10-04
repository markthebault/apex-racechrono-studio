# Open track database: specification v0.1 (draft)

Purpose: a public, static, versioned database of race circuits, their layouts, start/finish lines and sectors. Any lap-timing or telemetry application can read it with plain HTTP and a JSON parser. No server, no account, no SDK.

Audience: an AI agent (or person) building the dataset and its tooling, and developers of consuming applications.

Status: draft for review. Items marked **DECISION** need an owner's answer before building (section 13).

## 1. Scope

In scope
- Circuits and other timed courses: closed circuits, point-to-point courses (hill climbs, stages, Nordschleife BTG-style tourist laps), kart tracks.
- Per layout: centreline trace, start line, finish line (same as start on a circuit), sector lines, pit lane, named corners.
- Identity: stable IDs, aliases, links to other databases (OpenStreetMap, Wikidata, RaceChrono track ID).
- Provenance, confidence and licence per item.
- Tooling: schema validation, build scripts, checks that run in CI.

Out of scope
- Lap times, leaderboards, weather, event calendars, user telemetry.
- Any raw GPS trace recorded by a person. Only derived, generalised geometry is published.
- Live services. The database is files in a Git repository.

## 2. Principles

1. **Standards first.** Geometry is GeoJSON (RFC 7946). Metadata is JSON validated by JSON Schema (draft 2020-12). No custom binary format.
2. **Static and cacheable.** Every file is addressable by URL. The app loads a small index, then only the venues it needs. Everything works offline once cached.
3. **Small.** The index for the whole world stays under 1 MB gzipped. One layout stays under 100 KB.
4. **Stable identity.** IDs never change and are never reused. Renames go into `aliases`.
5. **Honest data.** Every feature says where it came from and how much to trust it. A guessed sector is never presented as an official one.
6. **Consumer-neutral.** Nothing in the format mentions a particular application.
7. **Reviewable.** One PR changes one venue. Diffs are readable: sorted keys, one feature per logical line where practical, fixed coordinate precision.

## 3. Repository layout

```
/dataset.json                     manifest: version, generated date, file hashes, licence
/index.json                       catalog of all venues (search + matching)
/venues/<venue-id>/venue.json     metadata for one venue and the list of its layouts
/venues/<venue-id>/<layout-id>.geojson   geometry of one layout
/schema/*.schema.json             JSON Schemas for every file type above
/sources/                         raw inputs and notes (OSM extracts, references), never served to apps
/tools/                           build, validate and diff scripts
/CHANGELOG.md
/LICENSE  /NOTICE.md              licences and attribution text
```

Venue IDs are lowercase kebab-case slugs prefixed by ISO 3166-1 alpha-2 country code, for example `de-nuerburgring`, `at-salzburgring`, `cz-autodrom-most`, `fr-anneau-du-rhin`. The slug is transliterated ASCII. Layout IDs are unique within a venue, for example `nordschleife-btg`, `gp-2002`, `vitesse-3-7`. Full layout key: `<venue-id>/<layout-id>`.

## 4. Files

### 4.1 `dataset.json` (manifest)

```json
{
  "schema": "https://example.org/track-db/schema/dataset.schema.json",
  "specVersion": "0.1.0",
  "datasetVersion": "2026.10.0",
  "generated": "2026-10-01T09:00:00Z",
  "counts": { "venues": 0, "layouts": 0 },
  "index": { "path": "index.json", "sha256": "..." },
  "license": "ODbL-1.0",
  "attribution": "Contains data © OpenStreetMap contributors (ODbL) and contributors to this database."
}
```

`datasetVersion` is CalVer (`YYYY.MM.patch`). `specVersion` is SemVer: a breaking change to any file format bumps the major number. Consumers must ignore unknown fields and must refuse a higher major `specVersion` than they support.

### 4.2 `index.json` (catalog)

One entry per venue. Enough to search, to match a recording to a venue, and to show how many layouts exist. No geometry.

```json
{
  "specVersion": "0.1.0",
  "datasetVersion": "2026.10.0",
  "venues": [
    {
      "id": "cz-autodrom-most",
      "name": "Autodrom Most",
      "aliases": ["Most", "Rennstrecke Most"],
      "country": "CZ",
      "center": [13.6018, 50.5188],
      "bbox": [13.589, 50.514, 13.616, 50.522],
      "kind": "circuit",
      "layouts": [
        { "id": "grand-prix", "name": "Grand Prix", "lengthM": 4212, "type": "circuit",
          "hasStartFinish": true, "sectorCount": 3, "confidence": "verified" }
      ],
      "path": "venues/cz-autodrom-most/venue.json"
    }
  ]
}
```

Coordinates are `[longitude, latitude]` (GeoJSON order) everywhere in this database. `bbox` is `[west, south, east, north]` and contains every layout of the venue plus 200 m.

### 4.3 `venue.json`

```json
{
  "specVersion": "0.1.0",
  "id": "cz-autodrom-most",
  "name": "Autodrom Most",
  "names": { "cs": "Autodrom Most", "en": "Most Autodrome" },
  "aliases": ["Most"],
  "country": "CZ",
  "region": "Ústí nad Labem",
  "timezone": "Europe/Prague",
  "center": [13.6018, 50.5188],
  "bbox": [13.589, 50.514, 13.616, 50.522],
  "website": "https://example.org",
  "externalIds": {
    "osm": ["way/60905520"],
    "wikidata": "Q...",
    "racechrono": [],
    "vbox": []
  },
  "layouts": [
    { "id": "grand-prix", "name": "Grand Prix", "file": "grand-prix.geojson",
      "status": "current", "type": "circuit", "direction": "clockwise",
      "lengthM": 4212, "timedLengthM": 4212, "surface": "asphalt",
      "externalIds": { "racechrono": [], "osm": [] },
      "aliases": [], "validFrom": null, "validTo": null }
  ],
  "sources": [ { "id": "osm", "name": "OpenStreetMap contributors", "license": "ODbL-1.0",
                 "url": "https://www.openstreetmap.org/copyright", "retrieved": "2026-09-30" } ],
  "updated": "2026-10-01"
}
```

Field notes
- `layouts[].status`: `current`, `historic`, `planned`, `temporary`. `validFrom`/`validTo` are ISO dates for historic layouts.
- `type`: `circuit` (start = finish), `point_to_point` (finish differs from start; the way back is untimed), `hillclimb`, `stage`. The type is derived from the geometry and checked (section 11).
- `lengthM` is the length of the centreline. `timedLengthM` is the distance from start line to finish line along the centreline. They are equal on a closed circuit.
- `externalIds.racechrono` holds numeric track IDs from RaceChrono session files (section 10). One layout can have several. One RaceChrono ID maps to at most one layout.
- `direction`: `clockwise`, `counterclockwise`, `both` (circuit run either way), `n/a`.

### 4.4 `<layout-id>.geojson`

A GeoJSON `FeatureCollection`. Each feature carries `properties.kind`. Required and optional features:

| kind | geometry | required | meaning |
|---|---|---|---|
| `centerline` | LineString | yes, exactly one | The racing surface's middle line, in driving direction, from the start line to the finish line. A closed circuit repeats its first coordinate at the end. |
| `start` | LineString (2 points) | yes | The timing line at the start, drawn across the track from one edge to the other. |
| `finish` | LineString (2 points) | yes | The timing line at the finish. Identical to `start` for a closed circuit: still present as its own feature so consumers never guess. |
| `sector` | LineString (2 points) | optional, repeated | Timing line that ends sector *n*. Sector 1 runs from `start` to the first `sector`; the last sector ends at `finish`. |
| `pitlane` | LineString | optional | Pit lane centreline in driving direction, with `pitEntry`/`pitExit` as properties of the first and last vertex (distances). |
| `corner` | Point | optional, repeated | Numbered or named corner, `distanceM` along the centreline. |
| `landmark` | Point | optional | Grandstand, bridge, gate, or anything used to explain a location. |
| `shortcut` | LineString | optional | An alternative route inside the layout, for layouts with chicanes or bypasses that are not a separate layout. |

Common properties on every feature
```json
{ "kind": "start", "id": "start", "source": "measured", "confidence": "verified",
  "note": "", "updated": "2026-10-01" }
```

Kind-specific properties
- `centerline`: `lengthM`, `closed` (boolean), `direction`, `elevationSource` (`none`, `srtm`, `lidar`, `measured`), `pointSpacingMaxM`.
- `start`, `finish`, `sector`: `bearingDeg` (direction of travel across the line, degrees clockwise from north, 0–360), `distanceM` (position along the centreline, 0 for `start`), `widthM`.
- `sector`: `index` (1-based; the sector this line ends), `name` (optional), `official` (boolean; true only if published by the circuit or governing body).
- `corner`: `number`, `name`, `distanceM`, `direction` (`left`, `right`), `apexRadiusM` (optional).
- `pitlane`: `entryDistanceM`, `exitDistanceM` measured on the centreline, `speedLimitKmh`.

Geometry rules
- WGS 84, decimal degrees, `[lon, lat]` or `[lon, lat, elevationM]`.
- 6 decimal places (0.1 m). Elevation, if present, in whole centimetres, never mixed within one file.
- `centerline`: at most 10 m between vertices on straights and at most 3 m through corners. Simplification tolerance 0.5 m. No duplicate consecutive points. No self-loops other than the deliberate closing point.
- `start`, `finish`, `sector` lines: two vertices, one on each edge of the track, so the segment is perpendicular to travel within 10 degrees and at least the track width long (typical 8 to 30 m). It must cross the centreline exactly once.
- Distances are metres measured along the `centerline`, using geodesic distance (WGS 84 ellipsoid).
- Files are pretty-printed with two-space indent, keys sorted, no trailing spaces, LF line endings, so diffs review well.

## 5. Sectors

- A layout may have zero sectors. Consumers then treat the lap as one sector or invent their own splits and label them so.
- `official: true` only when the circuit or governing body publishes those sectors (for example broadcast timing sectors). Otherwise `official: false`.
- Sector lines are ordered by `distanceM` and strictly increasing. There must be no sector line within 50 m of `start` or `finish`.
- A layout can define alternative sector sets in one file by adding a `sectorSet` property (`"official"`, `"mini-6"`) to each `sector` feature. The layout's `venue.json` entry names the default set in `defaultSectorSet`. Consumers fall back to the default when they do not know a set.

## 6. Point-to-point and untimed connections

For a course timed from a start line to a separate finish line:
- `type` is `point_to_point`, `start` and `finish` are different places, and `centerline` runs from `start` to `finish` only.
- The untimed way back is not part of the timed course. An optional `connector` feature (LineString, `kind: "connector"`) may describe it, with `timed: false`.
- `timedLengthM` is the timed distance and is what a consumer compares with a recorded lap length.

## 7. Identity, naming and versioning

- IDs are permanent. If a venue closes, keep it with `status: "historic"` on its layouts. If two venues merge, keep both IDs and add `supersededBy`.
- `aliases` carry old names, local-language names, sponsor names (for example "CM.com Circuit Zandvoort") and short names. Search must find a venue by any alias and by any corner or layout name.
- Layout IDs describe the layout, not the year, unless the layout is defined by a year (`gp-2002`).
- Changes that move a `start` or `finish` line by more than 5 m, or alter a `centerline` by more than 2 m, are recorded in `CHANGELOG.md` because they alter lap timing for existing users.
- Per-file `updated` dates plus the dataset CalVer let a consumer detect what changed.

## 8. Provenance, confidence and licences

Every feature has:
- `source`: one of `official` (published by the circuit or sanctioning body), `measured` (surveyed or derived from calibrated GPS by the maintainers), `derived` (computed from an open dataset such as OpenStreetMap), `contributed` (submitted by a person, reviewed), `estimated` (guess, for example equal sector splits).
- `confidence`: `verified` (checked against two independent sources or a survey), `good` (one reliable source, geometry agrees with measured laps), `rough` (visually traced, not yet checked), `unverified`.

Licensing
- The dataset licence must be compatible with every input. OpenStreetMap-derived geometry is under ODbL 1.0: derived databases must be shared under ODbL with attribution to OpenStreetMap contributors. If the dataset uses any OSM geometry, license the whole dataset ODbL-1.0 and ship the attribution text in `NOTICE.md`.
- Do not copy data from a proprietary or community database (Racelogic's VBOX track database, RaceChrono's track database, Google, TrackAddict, and similar) without a written licence. Read their terms first. Unknown terms mean do not copy. Record each source, its terms and the date checked in `sources/`.
- Do not publish any raw recording. Publish only a generalised centreline (at least three recordings averaged, or a mapped trace) and the timing lines derived from them.
- Personal data: none. No driver names, session IDs, device serials, file names or timestamps of recordings in any published file.
- **Legal and compliance questions on licence choice go to the organisation's legal team.** This spec gives general guidance only.

## 9. What a consuming application does

1. Fetch `dataset.json`, compare `datasetVersion` with its cache, refetch `index.json` if changed (send `If-None-Match` or compare the hash).
2. Search: match a query against `name`, `aliases`, and layout names.
3. Match a recording to a venue: keep venues whose `bbox` contains the recording's centre (allow 300 m), then fetch their layouts and choose the one whose `centerline` best fits the recording. Suggested score: the share of recording points within 25 m of the centreline, and the lap length within 3% of `timedLengthM`. If a session file carries a track ID, try `externalIds.racechrono` first and only use geometry to confirm.
4. Use the `start` and `finish` lines to cut laps by line crossing in the direction given by `bearingDeg` (within 60 degrees), and `sector` lines to cut sectors.
5. Cache every fetched file by URL and `datasetVersion`. Files are immutable per dataset version.
6. Never write back. Corrections go through the repository as issues or PRs.

The first consumer, a browser-based lap-analysis app, needs at least: search by name/alias/corner name; venue matching; per-layout centreline for a map; start/finish with bearing; separate finish for point-to-point; sector lines; `externalIds.racechrono`; `confidence` and `source` to word its notes honestly.

## 10. Data worth taking from RaceChrono session files

A RaceChrono `.rcz` session (a ZIP) carries useful, non-personal facts, which help build and check layouts. The agent's tooling may read these from recordings the maintainers own. Nothing from a recording is published except what section 8 allows.

Available in `session.json`
- `trackId` (a number in RaceChrono's own database, for example `117`) and `trackName`. Use as `externalIds.racechrono` and as an alias. The ID identifies a track definition in RaceChrono, not a physical circuit, so several IDs can map to one venue and, rarely, one ID to two layouts. Verify by geometry.
- `laps[]` with `startTimestamp` and `finishTimestamp` per lap, in milliseconds. Where the GPS is at those times gives the **start line** and **finish line**. On a circuit they coincide. On a course like Nordschleife BTG they are about 1.7 km apart, and the laps show an untimed gap between one finish and the next start.
- `bestLaptime`, `optimalLaptime`, `lapCount`, `lengthDistance` (metres recorded), `lengthTime`.
- `firstPositionLatitude` and `firstPositionLongitude` (degrees × 6,000,000), used for a coarse venue lookup.

Available in the channel files
- GPS position at 10 to 25 Hz. The lap traces give the centreline. Averaging many laps (at least 3, from at least 2 sessions or devices) and discarding pit and out-laps gives a stable line.
- Speed and heading, which give `bearingDeg` for the timing lines.
- Altitude, for elevation.

Not available
- RaceChrono does not store sector lines or the line's coordinates in the file. Sectors must come from another source or be declared `estimated`.

Extraction tool (in `/tools`, a script the agent writes)
1. Read a set of recordings and list track IDs, names, lap counts and start/finish positions.
2. For each track ID, compute the median start position, the median finish position and their spread. Report the layout as `circuit` if they are within 60 m and `point_to_point` if they are 150 m or more apart and at least 80% of laps agree.
3. Align laps by distance and average them into a centreline. Report the RMS lateral spread.
4. Write a proposal file the maintainer reviews, never a published file.

## 11. Validation (acceptance criteria)

A build passes only if all of these hold. Each is an automated check in CI, with a failing test for a deliberately broken example.

Schema
- Every file validates against its JSON Schema. Unknown `kind` values fail.
- Every ID is unique, matches `^[a-z]{2}-[a-z0-9-]+$` (venues) or `^[a-z0-9-]+$` (layouts), and every referenced file exists.

Geometry
- `centerline` has at least 20 vertices, no consecutive vertices closer than 0.5 m or further than 25 m, and `lengthM` equals the computed geodesic length within 0.5%.
- `closed: true` implies first and last coordinate are within 1 m. `type: circuit` implies `closed: true`. `type: point_to_point` implies `start` and `finish` are 150 m or more apart along the centreline.
- Each timing line crosses the centreline exactly once, is within 10 degrees of perpendicular to it, and is between 6 m and 60 m long.
- `bearingDeg` on each timing line is within 20 degrees of the centreline's direction at the crossing.
- `sector` lines are in strictly increasing `distanceM`, between `start` and `finish`.
- Every feature lies inside the venue `bbox`.

Consistency
- `venue.json` `layouts[]` matches the GeoJSON files: same IDs, same `lengthM`, same type.
- `index.json` is exactly derivable from the venue files (the build regenerates it and the check compares).
- No two layouts of one venue have centrelines that overlap more than 97% of their length (duplicates) unless `supersededBy` is set.

Provenance
- Every feature has `source` and `confidence`. `official: true` sectors have a `source` of `official` and a URL in the venue's `sources`.
- Every source listed has a licence and a date checked. Any source with unknown terms fails the build.

Size
- `index.json` under 1 MB gzipped, each `.geojson` under 100 KB, `venue.json` under 20 KB.

Reference tests (a minimum set, with synthetic data)
- A circular test track, closed, one start line: valid.
- A straight test course: valid `point_to_point`.
- Each rule above: one minimal broken example that must fail with a readable message.
- Round-trip: rebuilding from `sources/` reproduces the published files byte for byte.

## 12. Build plan for the agent

1. Create the repository skeleton, schemas and validator first. No data yet. Get CI green on synthetic fixtures.
2. Write the OSM importer. Query the raceways and named venue areas, group pieces into venues, assemble closed loops, produce **draft** layouts with `source: derived`, `confidence: rough`. (The first consumer has a prototype of this importer. Reuse its logic if the owner agrees, but the output here is the format in section 4.)
3. Seed 20 circuits by hand-checking: European first. For each, verify against the circuit's own map, record the source, promote to `good` or `verified`.
4. Add start/finish lines. Priority order: an official source with a licence that allows use; measured from the maintainers' own recordings; contributed with review. Never invent one and never mark a guessed line `verified`.
5. Add sectors only from `official` or `measured` sources, or generate equal splits explicitly labelled `estimated`.
6. Add the extraction tool from section 10.
7. Publish through GitHub Pages or a release asset with immutable, versioned URLs.
8. Contribution guide: how to propose a new layout, what evidence is needed, how a recording is anonymised before submission.

Definition of done for v1: 50 circuits, at least 30 of them with verified start/finish lines, CI checks all green, a small reference consumer (a script) that loads the index, finds a venue by alias, matches a synthetic recording to a layout, and cuts laps with the start line.

## 13. Decisions needed from the owner

1. **Licence.** ODbL-1.0 for the whole dataset (needed if any OSM geometry is used) versus a permissive licence with no OSM data. Ask the legal team before the first public release.
2. **Name and hosting.** Repository name, organisation, and public URL scheme (GitHub Pages, raw files, or a CDN).
3. **Timing line shape.** Two-vertex lines as specified here, or a centre point plus bearing plus width. This spec uses two vertices because that is what timing hardware and most databases use, and it converts to the other form without loss.
4. **Sector policy.** Only official and measured sectors, or also estimated equal splits.
5. **Direction of travel.** Circuits raced both ways (some kart tracks, Nordschleife in tourist mode) as one layout with `direction: both`, or two layouts. This spec recommends two layouts when the start/finish differ, one layout otherwise.
6. **Contribution model.** Maintainers only, or accepted PRs with review, and whether contributions may come from personal recordings after anonymisation.
7. **Scope of v1.** Regions and circuit count.
