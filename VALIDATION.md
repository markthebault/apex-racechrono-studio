# Validation · 29 September 2026

## Automated checks

- `npm test`: 94 tests pass with the private recordings available; the tests that need them are skipped without.
- `npm run build`: TypeScript and Vite production build passed.
- `npm audit --omit=dev`: no vulnerabilities reported.
- `node --check dist/sw.js`: generated service worker passed syntax validation.
- Inspected `dist/`: application assets and the track catalog only. No private RCZ or video files.

The tests cover exact lap durations and GPS sample counts in both supplied recordings, coordinate and speed scaling, OBD units, interrupted-lap detection, corrupt archives, layout compatibility, sector interpolation and provenance, preserving gaps, hash-keyed duplicate persistence, atomic project restoration, invalid project settings, sync schema validation, affine drift correction, and stripping nonportable sync properties.

The morning recording has 64,562 GPS samples and three laps. The afternoon recording has 183,615 GPS samples and four laps. The 94:08.218 lap is a red-flag stop and is flagged as interrupted.

Track day of 27 September 2026, three sessions and 11 laps (test skipped when the recordings are not on this machine): every lap feeds the optimal lap. Sectors that overlap a GPS outage of more than 2 seconds are skipped. With 19 sectors of about 1 km the theoretical lap is 8:39.515, against a best recorded lap of 8:59.516. An independent Python implementation and a separate agent working from the raw archives gave 8:39.371 to 8:39.510 for the same rules. The value falls with more sectors (about 8:37.5 at 50) and rises with fewer, so quote it with its sector count. It is a sector sum, not evidence of an achievable lap.

Braking is estimated from calculated longitudinal acceleration at or below -0.2 g. That flags about 12% of a clean Nordschleife lap. The threshold is a choice, not a measurement of brake pressure.

## Shared-browser checks

Performed through the T3 collaborative browser:

- Imported both original RCZ files, inspected seven laps and their quality flags, and compared laps across sessions.
- Searched the 6,643-entry OSM catalog for Nürburgring and inspected results.
- Drag-selected a chart section and verified the shared range changed to approximately 5.14–9.15 km; reset restored the full reference.
- Added an altitude chart and overlaid throttle, inspected theoretical-sector sources, and selected the theoretical lap for comparison.
- Switched km/h to mph and verified the starting speed changed from 112.0 to 69.6.
- Inspected desktop screenshots and the 390 × 844 layout. Document width stayed at 390 pixels. Wide tables scroll inside their panels.
- Opened labeled synthetic H.264 footage in both video panels, set anchors, sought by track position, and verified both video elements played.
- Exported a 1,236-byte sync sidecar with two session identities and two video identities, including SHA-256, names, sizes, clip durations and anchors. No binary footage or telemetry was present.
- Exported and reimported a roughly 4.56 MB project containing both original RCZ sessions, all seven laps, chart settings, and two sync bindings. No video bytes were included.
- Reloaded the browser, confirmed saved sessions and sync bindings survived, and relinked a renamed video by matching SHA-256.
- Selected a wrong-content file with the original video name. The app rejected its hash without overwriting either saved binding.
- Removed a session from the test browser's IndexedDB, confirmed the missing-session notice, and restored the original RCZ by its hash.
- Imported a second valid synthetic MP4 chunk. At approximately 35 seconds into the recording, the second clip was selected at approximately 5 seconds.
- Set a second anchor on the second clip and verified the stored affine mapping returned exactly 36 recording seconds at that anchor timestamp.
- Verified worker SHA-256 against the standard `abc` digest and verified cancellation.
- Removed the synthetic sync bindings through **Unlink** after testing. The browser is ready for the user's actual videos.

## Evidence

A recorded walkthrough and screenshots were kept outside the repository, because they show real telemetry. The 82-second walkthrough showed real telemetry, chart customization, section zoom, session quality flags, theoretical-sector comparison, and local video synchronization using explicitly labeled synthetic footage.

Screenshots were saved during analysis, session review, optimal-sector inspection, track search, video synchronization, and narrow-screen checks. The current analysis screenshot is also copied to `evidence/analysis.png`.

## Limits

No actual camera footage was supplied. Long action-camera files, codec-specific seeking, sustained playback drift, and cross-browser file-handle permissions still need verification with that footage. Frame-step buttons use 1/30-second increments.

The browser checks ran in the shared Chromium preview. Safari and Firefox were not tested. The production service worker was built and syntax-checked; an offline HTTPS browser reload was not exercised. Storage-quota and corrupted-video errors have handling, but were not induced in the browser checks.

The RCZ decoder is verified for these version-1 files. Other RaceChrono archive variants may need additional channel mappings. Unknown structurally supported numeric channels are shown as raw values; they are not assigned speculative units.
