# Apex · RaceChrono analysis studio

A local browser workspace for RaceChrono sessions, GPS traces, cross-session lap comparisons, customizable telemetry charts, sector-based theoretical laps, and synchronized local videos.

## Run

```sh
npm install
npm run dev
```

Open http://localhost:5173. Drop `.rcz` files anywhere on the window or use **Import sessions**. A dashed overlay confirms the drop target. Each session joins the collection under the track named in its file, and the Sessions tab groups it there. A session on a track you had not imported before also opens the analyzer on that track, on its fastest lap. Dropping the same recording again refreshes it rather than adding a copy. Every file is handled on its own, so one bad file is reported without stopping the others. Videos are skipped with a note, because they are linked from Video sync. `.apex.zip` projects and `.rcsync.json` files can be dropped the same way. `npm run build` produces the static site in `dist/`. Serve it over HTTPS or localhost for persistent file handles and offline app caching. No application backend is needed.

The development server can offer an **Open local recordings (development)** button. Point it at your own files with an untracked `.env.local`, for example `APEX_LOCAL_SESSIONS=/path/a.rcz,/path/b.rcz`, and list extra hostnames for the server in `APEX_ALLOWED_HOSTS`. These recordings are served only by the Vite dev server and are never part of `public/` or the production build. Deploy `dist/`, not the development server.

## Analysis

Choose A and B from different sessions, then use **+ Add lap** to compare up to four more laps against A, called C to F. Each has its own color and can be a real lap or the theoretical optimal, and each is removed with ×. Every added lap gets its own trace and car on the map, its own line in every chart, its own column in the hover box, and its own delta line and readout against A. The shaded delta fill follows lap B, or the first added lap when B is empty. Videos still follow A and B only. Charts, GPS markers and videos share the cursor. Hovering a chart shows a dashed cursor with the values of every lap at that distance, and translucent ghost cars on the map at the same point on every lap, red where that lap is braking. Hovering does not move anything, and the ghosts disappear when the pointer leaves the chart or while you drag out a zoom range. Click a chart to move the shared cursor. The left and right arrow keys move lap A by 0.2 s of lap time, and Shift moves 10 times as far, 2 s. The step is in time, so a slow corner moves fewer metres than a straight, and a stop is crossed at the same pace: the lap clock keeps counting while the car stands still. Type a lap time such as `85:40` into the clock and press Enter to jump straight to that moment. Playback also runs on time, so it plays through a stop. The keys work on the Analyze and Video sync tabs, stop at the ends of the lap or of a zoomed range, and leave dropdowns and sliders alone when one has focus. On the map, click within about 30 pixels of either trace to do the same; a click farther away is ignored. Drag across a chart to zoom. Charts that include speed show the cumulative time delta between laps A and B as a faded background line, on its own scale printed at the right edge: above the dashed zero line A is behind, below it A is ahead. The delta is the difference of elapsed times at the same distance, so it ends at the difference of the two lap times. Add and overlay channels, reorder charts, resize panels, and change speed units and lap colors. Elapsed-time replay advances both laps by the same duration; the charts retain their distance axes and show separate cursor positions.

The Sessions view shows a lap's status only when something needs your attention or you have made a decision: **Needs review**, **Can't be used**, **Marked valid** or **Excluded**. A lap with no problem, or from a track other than the one being analyzed, shows nothing but **Analyze**, and minor notes such as a GPS gap appear as small text. Every lap counts by default, including laps with GPS outages and laps interrupted by a red flag. Only sectors that overlap an outage of more than 2 seconds are skipped, and a sector where the car stood still is never the fastest. **Review**, shown on laps with a status or a note, opens a dialog that explains each flag in plain words and shows the theoretical lap without and with that lap, and how many sectors the lap would win. Nothing changes until you press **Mark as valid**, **Exclude from optimal** or **Back to automatic**. The choice is saved on this device with your other settings and travels in Export project. Laps RaceChrono marked invalid and laps with incomplete GPS coverage need your review before they count. A lap that does not line up with the reference cannot be forced in, because its sectors would be measured against the wrong stretch of track. A lap from another track is not a problem: the analyzer compares one track at a time, so it is simply not part of the current analysis.

The map shows lap A and lap B with a small car each, rotated to the direction of travel. A car turns red while its longitudinal acceleration, calculated from GPS speed, is at or below -0.2 g.

The theoretical optimal is the sum of the fastest usable sectors across the selected collection. It depends on the sector count: for the 11 laps of the 27 September track day it is about 8:39.5 with 19 sectors and lower with more. Every sector names its source lap. Approximately 1 km sectors are generated when none exist. Edit their distances, add a gate at the cursor, or change the custom timed section's start and finish. Imported RaceChrono lap boundaries stay unchanged. Sector joins can involve different speeds and lines; the result is not a physically validated achievable lap.

## Sessions, groups and summaries

The Sessions tab groups recordings **by track** or **by date**. The choice is remembered. Each session has an **Include in analyzer** checkbox, and each group header has a checkbox that selects or clears the whole group, so you can combine sessions from different days on the same track. **Analyze only these** selects one group and opens the analyzer. The sidebar lists the same sessions in one group per track, with the track name and session count as a heading. Only the sessions inside a group have checkboxes, and they edit the same selection. Clicking a track heading sets the analysis on that track: it keeps the ticked sessions of that track, or ticks all of them when none is ticked, clears the other tracks, switches to the track's fastest lap and opens the Analyze tab. At least one session stays selected. An empty selection in storage means every session, so a newly imported session joins automatically.

The selection scopes the lap pickers, the best recorded lap and the theoretical optimal lap. The analyzer compares laps on one track at a time. If the selection spans several tracks, a notice names the current track, and picking a lap from another track in Lap A switches to it.

Click a session card, or **Lap times**, for a summary in the style of a timing screen: top speed while timing, lap count, best lap, every lap with its gap to the best, and an **opt** row with the best sectors of that session. Click a lap to analyze it. The opt row uses this app's sector calculation when the session is on the track being analyzed, and otherwise the value RaceChrono stored, labelled as such.

The **Optimal lap** tab shows **Opportunities**: the fastest lap against the best sectors of every lap in scope, drawn on the track outline with the time to gain per sector, ranked below, with arrows to step through them. The scope is the ticked sessions when you have made a selection, otherwise all sessions of one day, which you can change in the panel. Sector gains are measured against the fastest lap, so they add up to its lap time minus the optimal, apart from sectors where that lap crossed a GPS outage.

## Video and portable synchronization

1. Select laps, open **Video sync**, and choose local MP4, MOV, or WebM files. Browser codec support determines what can play. H.264 MP4 is a useful default. HEVC (H.265), which many cameras and phones record, plays in Safari and in Chrome only with hardware support. Convert it with `ffmpeg -i input.MP4 -c:v libx264 -crf 23 -an output.mp4`.
2. The files are streamed from their local object URLs. They are never uploaded or stored in IndexedDB. SHA-256 is calculated in a worker using 4 MB chunks.
3. When the first video of a session is opened, the app reads the recording time stored in the file and, if it falls inside the session, places the video on the telemetry clock by itself and jumps there. Cameras disagree on whether that time is UTC or local wall-clock, so the reading that fits the session is used, and the note says when both fit. Many files carry the time they were exported instead of the time they were recorded, for example a clip cut and saved in a video editor. The app then says so and opens the manual editor.
4. **Video started at** is an editable field in **Edit synchronization**. Type the local time the video started, for example `14:10:04` or `14:10:04.500`, or `2026-09-27 14:10:04` for another day, and press Enter. Below it the panel shows when the GPS data and the video each begin and end, and where they overlap. The video may start before the GPS data or end after it; only the overlap has both. **Go to where video and GPS overlap** jumps the telemetry and the picture to the first moment they share. **Link this frame to GPS start** ties the frame you have paused on to the moment the GPS data begins, for when you can see that moment in the picture. Typing a start time replaces any drift correction.
5. By hand, in **Edit synchronization**: pause on a recognizable moment in the video, put the telemetry on the same moment, and press the green **Sync here**. Type a lap time in the lap clock (for example `85:40`) and press Enter to jump to an exact moment, click the map or a chart, or use the arrow keys. The clock is exact even during a long stop, where position alone cannot tell one minute from the next. A second **Add drift correction** further along the video corrects clock drift. Frame stepping uses 1/30-second increments.
6. Camera chunks are initially ordered by natural filename order. Their recording start times can be edited to represent gaps. The two panels follow their own lap timestamps.
7. Download `.rcsync.json` for a small sidecar containing session and video filenames, sizes, SHA-256 hashes, clip order, duration, and anchors. It contains no session or video bytes.
8. Reopen the sync file. Sessions already in IndexedDB are reused. Import missing RCZ files and reselect videos when necessary. A matching hash accepts a renamed video; the saved binding is not overwritten by a wrong file. Use **Unlink** to remove an old binding before replacing the recording with different footage.

**Export project** creates `.apex.zip` with the original RCZ files, layout, chart settings, and sync data. It excludes video contents. Use it as the portable backup; browser storage can be cleared by the browser or user. Wait for **Saved locally** before closing. File handles are reused where supported and permission is granted. HTTP previews may require manual reselection.

The format uses `format: "apex-sync"`, `version: 1`, and `bindings[]`. Each binding has a `session` identity, ordered `clips[]`, and zero to two `anchors[]` with `videoSeconds` and Unix `sessionTimestamp` in milliseconds. One anchor defines offset; two define an affine time mapping. Project format is `apex-project`, version 1.

## Data and track catalog

The included snapshot contains 6,643 named mapped raceways from OpenStreetMap. It is global but not exhaustive, and can include kart tracks and individual circuit sections. Search results are venue locations, not certified timing layouts. GPS imports supply the timed reference. Regenerate with:

```sh
npm run catalog
```

Catalog data © OpenStreetMap contributors, ODbL 1.0. See https://www.openstreetmap.org/copyright. The script uses a single Overpass request; failed requests preserve the previous snapshot. Street-map tiles use OpenStreetMap's standard server with visible attribution and normal browser caching. There is no tile prefetch. Production caches the application shell for offline telemetry use; map tiles and external fonts require connectivity or an existing browser cache.

RCZ decoding is verified against the two supplied version-1 archives. GPS coordinates use signed fixed-point values divided by 6,000,000; timestamps are little-endian int64 milliseconds. GPS speed is mm/s and is converted to km/h; altitude is mm. Recognized OBD float64 channels are RPM, throttle, coolant, intake temperature and speed. Other structurally supported channels are exposed as raw values with no invented units. Original archive entries remain preserved. The lap RaceChrono lists without a finish time, because recording stopped during it, is skipped as untimed. Other RCZ variants may require additional decoder support and produce an explicit error.

## Validation

```sh
npm test
npm run build
```

Tests that need real RaceChrono recordings are skipped unless `APEX_FIXTURES` names a folder that holds them. See the comment at the top of `src/core.test.ts` for the expected file names. Recordings are private and are not in this repository. Synthetic tests cover interpolation, sector logic, grouping, file classification and portable sync validation. See `VALIDATION.md` for browser evidence and limitations.

## Optional: a persistent HTTPS service on a Mac with Tailscale

This is how the maintainer keeps a copy running. It is optional; the app is static and any static host over HTTPS or localhost works.

`npm run deploy` builds the app, copies `dist/` to a runtime folder, restarts a macOS LaunchAgent that runs `scripts/serve.mjs` on `127.0.0.1:5180`, and checks that the service serves the new build. Tailscale Serve terminates HTTPS in front of it, tailnet only. HTTPS is a secure context, which browsers need for the offline cache and persistent file handles.

1. Create the runtime folder and a LaunchAgent (label `local.apex.racechrono` by default) that runs `node "<runtime>/serve.mjs" "<runtime>/web"`, with the runtime folder as its working directory. The default runtime folder is `~/Library/Application Support/ApexStudio`.
2. Map an HTTPS port to the loopback server, and remove it later with `--https=5173 off`:

   ```sh
   tailscale serve --bg --https=5173 http://127.0.0.1:5180
   ```

3. Put your address in an untracked `.env.deploy`, for example `APEX_PUBLIC_URL=https://my-host.my-tailnet.ts.net:5173`. `APEX_RUNTIME` and `APEX_LABEL` override the defaults.
4. Run `npm run deploy` after every change.

The service serves only the production build. The development-only recording endpoints are not exposed. Browser storage is tied to the exact origin, so sessions saved under one address do not appear under another. Move them with **Export project** and **Import sessions**.

## Data and license

Application code: MIT, see `LICENSE`. The included track catalog is derived from OpenStreetMap and is licensed under the Open Database License 1.0. Attribution: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright.

RaceChrono recordings, GPS traces and videos are personal data. The repository contains none, and the app keeps them in your browser. Do not commit them.
