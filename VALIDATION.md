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

## Stage 1 Race Engineer validation — 2026-10-16

Stage 1 has implementation paths for the twelve child workstreams, but the release gate is **open**. The automated results below are not a claim that all acceptance criteria, the browser UX or real-agent coaching quality have been accepted. Stage 2 has not been implemented.

Automated checks cover native-rate SI channel normalization, missing/unknown units, zero-valued brake measurements, mapped throttle versus accelerator, wheel identity, constant-radius/straight kinematics, braking ramps at several rates, gaps/edge abstention, immutable snapshot invalidation, known between-lap delta, scoped consent/revocation including pending calls, telemetry/payload bounds, stale/foreign report references and unsupported claim categories. Worker pre-abort, cancellation, timeout and late-result handling are exercised. Project metadata round-trip and source-session deletion/cache ownership are checked.

The local recording evaluation processed eight RCZ/VBO inputs and 53 timed laps. Both VBO recordings acquired timing lines from matching RCZ sessions. Review packets stayed below 64 KiB. No brake-pedal, accelerator-pedal, wheel-lockup or ultimate-grip claims were invented from the supplied channels. The supplied `.hlptrl` file remains unsupported. Recording names, detailed telemetry, fixture locations and result files remain untracked. A camera-specific test is skipped because its separate fixture is absent.

Numerical fixtures cover a closed circle, hairpin, chicane and open straight, using the actual pinned HiGHS WASM runtime in Node. A known scalar QP verifies the 1/2 xᵀQx coefficient convention. Tests check actual curvature improvement, sampled between-knot clearance, periodic/open endpoint behavior, analytic circular speed bounds, braking/acceleration constraints, local reductions and lower-grip sensitivity. The pressure-release test uses a native timeline finer than GPS and checks that the release follows the pressure maximum rather than including the rising ramp.

The optional synthetic benchmark used Node 22.22.1 on Linux x64. Warm-runtime, end-to-end corridor/solve/validation measurements were approximately:

| Nodes | Result                                      | Elapsed | Process RSS afterward |
| ----- | ------------------------------------------- | ------: | --------------------: |
| 250   | Available, validated                        |  0.48 s |               184 MiB |
| 1,000 | Unavailable, solver warning/iteration limit |  9.26 s |               245 MiB |
| 4,000 | Unavailable, solver warning/time limit      | 20.23 s |               246 MiB |

These are whole-process Node RSS figures, not isolated WASM allocations or browser memory measurements. They justify a 250-node default, not 4,000-node support. Hardware details and raw benchmark evidence are retained locally. The WASM asset is 3,531,385 bytes. Production build emits the solver and module-worker chunks. The solver is loaded only for boundary modeling; the Race Engineer screen itself is lazy-loaded.

### Outstanding acceptance checks

The API-key companion path additionally has ten automated tests for shared query contracts, separate API/WebMCP grants, stale/foreign queries, cancellation/revocation, request/tool/response bounds, credential persistence/removal, provider-error redaction and AI evidence references. The fixture-enabled suite reports **240 passed, 2 skipped**. A desktop Chromium run imported a private RCZ and exercised a simulated compatible provider through tool calls, validated cards, follow-up history, memory-only credentials, opt-in persistence/reload, endpoint-change clearing, forgetting and cancellation with a late response. Desktop and 390 px screenshots were inspected; no horizontal overflow or browser runtime exceptions occurred. This was mocked inference, not a real provider/CORS/model-quality acceptance test. Raw browser evidence is untracked.

The October 21 live review addressed overly long automatic regions, unverified cross-recording context pooling and small-sample repeatability statistics; see the update below. Remaining findings include packet exports that can omit contrary measurements, ranker confidence that still needs broader repeatability assessment, and a simplified speed profile that can be materially slower than another feasible solution. Prompting does not resolve these remaining algorithmic limitations.

- Actual ChatGPT built-in browser discovery, approved tool invocation, revocation and an agent-returned evidence-linked review. The browser-use tool was attempted and returned an empty browser inventory; opening the built-in browser reported unavailable. No supported browser/app/account/model version has been verified in this environment.
- Visual, keyboard and responsive checks of the new screen, speed-unit display, chart-focus transitions, production worker/WASM loading and network/privacy behavior in that ChatGPT browser. The Chromium API-key flow check above is separate and does not qualify WebMCP discovery or model inference.
- A maintainer-reviewed coaching-quality assessment, including contradictory evidence and causal claims. Synthetic structure/reference validation does not validate the truth of generated prose.
- Real, permitted boundary data and verified richer CAN layouts beyond the supplied importer's proven mappings. Unsupported variants, unavailable axes and insufficient calibration must continue to abstain. The current profile is a conservative simplified model, with no measured tire-limit or guaranteed lap-time claim.
- Additional browser/device performance qualification and tuning for larger solver problems. The current 1,000/4,000-node cases deliberately return no optimized result.

Run `npm test` and `npm run build`. Add `APEX_FIXTURES` for private recording checks, `APEX_BENCHMARK=1` for the optional numerical benchmark, and `APEX_EVIDENCE` for untracked evidence output. No paid inference is required by tests.

## Live OpenRouter Race Engineer checks — 2026-10-21

Paid inference used only `deepseek/deepseek-v4.1-flash-1017` through OpenRouter, with `reasoning.effort: low`; no alternate model was called. The private test harness checks the exact endpoint/model on every request, imposes provider price and output limits, and reserves a conservative cost bound before dispatch against a $2.50 ceiling (below the authorized $3). Credentials and detailed request/response evidence remain untracked.

Live checks exercised two real recordings and six timed laps, source-unit conversions, reference versus quickest-selected lap identity, evidence-linked reports, chart focus and follow-up questions about brake timing, ABS, unused grip and guaranteed gains. A separate synthetic speed-only, single-lap case returned no invented priority, explained the missing evidence, and rejected imported notes asking for fabricated pressure, ABS and time-gain claims. Answer prose remains an interpretation; these examples do not establish general model truth or coaching safety.

Initial runs exposed overly long merged regions, an exhausted tool loop, output truncation and incorrect lap/numerical wording. Automatic regions are now bounded 400 m review windows; unknown cross-recording context does not qualify for coaching/envelope pooling; interpolated small-sample percentiles no longer conceal variation. OpenRouter reserves the final request for a source check of its own draft using the same model. The output allowance is bounded at 8,192 tokens, including reasoning. Reports expose deterministic source tables, retain an assessment when no priority is supported, and keep earlier chat turns collapsible.

The fixture-enabled suite passes **250 tests, 2 skipped**; without recordings, **230 pass, 17 skipped**. TypeScript and the production build pass. Chromium checks exercise connection setup, tool invocation, key persistence/reload/removal, endpoint-change clearing, cancellation of late responses, safe emphasis/table rendering, escaped model HTML, desktop and 390 px layouts without document overflow. The production preview is rebuilt separately from private fixtures. Remaining WebMCP, richer CAN, boundary-data and broader coaching-quality acceptance items above still apply.

The completed live run made **43 requests** in total, including exploratory runs that exposed failures, using only the requested model at low reasoning. OpenRouter reported **$0.056064207** of usage; the key-usage endpoint independently reported **$0.056064206**. The final end-to-end review and two follow-ups completed in eight requests, including the source checks. The refreshed public preview was checked against the built app, Race Engineer, worker and solver assets by byte equality and SHA-256. Detailed responses, screenshots, service address and spend ledger are retained only in untracked evidence.

## Visual Race Engineer and reasoning controls — 2026-10-21

The Race Engineer now uses one section-card list with a locally drawn GPS image per item, a full-lap locator, reference/comparison speed annotations, recorded window times and one next step. Full prose, limitations and source measurements are under **Why this focus?**. Legacy combined-window reports are split into individual section cards; their shared advice is labeled. The image highlights a recorded section and a sampled speed difference, not an invented braking point, apex, racing line or surveyed track edge. Missing continuous GPS geometry yields an unavailable state rather than an invented illustration. Track coordinates and images remain outside API payloads.

Low, Medium and High reasoning are selectable on the main toolbar. The selected effort reaches both investigation and final source-check requests without changing the model. Changing effort preserves the review and in-memory key. Changing the reference lap on the page invalidates the old report while retaining the connection. Explicitly remembered credentials also remember effort; older saved connections default to Low.

The fixture-enabled suite passes **258 tests, 2 skipped**. New coverage checks single-section grouping from legacy reports, correct lap/section pairing, rejected poor-quality comparisons, unit handling, recorded-coordinate projection, omitted unavailable minimum positions and GPS outage path breaks. Transport tests cover all three effort values on both requests, invalid values and saved preferences. Chromium exercised the full flow with a real recording and simulated API responses, including reference switching, state retention, saved-effort reload, cancellation, key removal, safe text rendering, analyzer navigation and the 390 px layout. These UI checks made **no additional paid inference calls** and do not qualify real High-effort model coaching quality. Screenshots and detailed results remain untracked.

## Whole-session debrief redesign — 2026-10-21

The Race Engineer now starts with an overall session assessment and three views: findings, chronological lap progression, and a small practice plan with success checks. A compact evidence digest screens all eligible selected windows for repeated minimum/exit-speed differences and variation, supplies contrary examples and affected-lap counts, and reports omitted coverage. Generated text distinguishes working hypotheses from measured inputs. Finding drawers retain locally generated GPS maps, native source tables and analyzer navigation. Connection/model details and technical tools are collapsed; reasoning remains directly selectable.

The recording-enabled suite passes **272 tests, 2 skipped**. New checks cover mixed chronology, flagged whole-lap timing versus unaffected windows, recurring support across laps/sections, bounded digest coverage, scoped evidence aliases, foreign/stale references, range titles that include unsupported sections, report/archive persistence and source-session cleanup. OpenRouter's reserved source check sees deterministic draft-validation errors; one targeted repair can use a remaining request within the six-request bound. Failed repairs stop rather than looping. Output is bounded at 16,384 tokens, including reasoning, after live runs exposed truncation with the richer report.

Live checks used only `deepseek/deepseek-v4.1-flash-1017` with Low reasoning. Two real recordings returned whole-session debriefs, with progression, stable sections, local versus broad slowdowns, counterexamples and practice steps. Selected numerical claims were independently checked against the supplied digest: lap deltas, window times, converted speeds, screening counts and repeatability spreads. A synthetic single-lap, speed-only session returned no invented finding, proposed data collection and rejected imported instructions to fabricate brake pressure, ABS and guaranteed gains. The spend ledger, conservative outstanding-request allowance and key-usage check remained below the authorized $3. Detailed responses and usage stay untracked; the temporary test key file was removed. These examples do not prove all generated prose correct or qualify richer CAN coaching.

The native preview browser reported an unsupported host sandbox, so standalone Chromium was used. Mocked-inference checks ran against both development and the served production build, exercising the three views, GPS evidence, safe text/table rendering, saved-report reload without credentials, preserved conversation on save, saved-report context in follow-ups, Low/Medium/High transport, cancellation, stale-scope clearing, credential removal, and desktop/390 px layouts without document overflow. Actual Medium/High model quality was not tested. The persistent preview service was updated and its public HTML, main assets, Race Engineer chunk and worker matched the release build by hash. Published files contain no private recordings or test key. Earlier WebMCP, boundary-data and broader coaching-quality acceptance items still apply.

## Corner cards, top-three passes and G-force coaching — 2026-10-21

**Corners** is the default Race Engineer view. Each selected section restores the map/advice card, shows its three quickest distinct eligible passes by section time, and plots speed, signed longitudinal G and signed lateral G over common reference distance. Selecting a pass changes the map comparison. The next-session step and success check appear first; expanded reasoning contains observations, possible mistakes and limitations. The session debrief remains available in a separate view.

The recording-enabled suite passes **286 tests, 2 skipped**. New checks cover section ranking independent of whole-lap pace, duplicate/invalid/out-of-scope exclusions, fewer than three passes, constant-radius lateral acceleration, signed speed derivatives, outage gaps, true recorded zero, nonzero g-to-SI-to-g conversion, recorded-channel precedence, P95 metadata, aligned profiles, consent and source validation. Corner reports must cite every available top-three pass and cannot cite another section or an explicitly unreliable window. Practice fields reject invented numerical driving targets/tolerances and certain unsupported prescriptions; measured numbers belong in observations, with dashboard speed units.

The ninth shared read-only query, `apex_corner_review`, returns the top passes, review pass if different, G provenance and bounded speed/G profiles. Snapshots add G95 summaries, and the algorithm cache version was advanced. Recorded acceleration channels require confirmed mappings; otherwise acceleration comes from the verified speed derivative and lateral G from speed squared times physical GPS curvature. Source labels distinguish recorded sensors, speed estimates and GPS estimates. P95 is not a peak, and these values do not establish tyre grip, pedal use or exact line. Optimal-lap eligibility was not changed.

Live OpenRouter testing used only the requested DeepSeek model at Low reasoning. An initial answer proposed an unsupported braking location and numerical driving tolerances; the report contract and source-check instructions were tightened. The subsequent answer cited all three ranked passes, compared their time/speed/G differences and counterexamples, and returned a qualitative practice test against the baseline. Its section times, speed conversions, sampled maxima and longitudinal/lateral G95 summaries were checked against the supplied data. This is evidence for the tested example, not proof of every generated causal explanation. Current usage, responses and numerical checks remain untracked and below the authorized budget; the temporary test key was removed.

Standalone Chromium checks exercise the restored map, sorted source times, all three plots, targeted API context, Low/Medium transport, corner switching with retained advice, follow-up context changing with the selected corner, saving/reloading multiple corner reviews without credentials, fewer-pass display, stale-scope clearing, analyzer navigation and desktop/390 px layout without page overflow. The session-debrief regression also passes. A production browser run passed after the service restart, and public HTML/JavaScript/CSS/WASM matched the release build by hash. Private recordings and the API key are absent from published files. Broader model-quality, richer CAN and WebMCP acceptance limits above remain open.

## Automatic AI history and plain-English prompts · 21 October 2026

The recording-enabled suite passes **296 tests, 2 skipped**. New checks cover durable answer storage, report/source validation on restore, exact-snapshot isolation, separate history/cache lifetimes, quota failures preserving the last durable answer, session-deletion cleanup, remembered lap scope, new-lap inclusion and fingerprints changing with laps, sessions, mappings, context and corner edits. Plain-English instructions apply to corner reviews, session reviews and the final same-model source check.

Production Chromium checks use mocked provider replies, with no paid inference. They verify automatic storage of multiple corner reviews and follow-up replies, restore without credentials or API calls, navigation, selected-corner and lap-selection restore, follow-up context after reload, invalidation when a lap is deselected or a same-day session is added, and explicit reruns. A simulated history quota failure keeps the answer visible, removes the saved indicator and successfully retries after storage becomes available. The whole-session regression covers source visuals, safe text/table rendering, saved reports and replies, cancellation, reasoning controls and changed references. Desktop and 390 px checks have no page overflow. These tests verify behavior and prompt delivery, not the quality of newly generated prose; this change adds no live model-quality claim.

Saved answer history contains displayed reports and replies, not provider credentials, tool-call history, raw telemetry or sharing grants. Structured reports also enter project settings; follow-up replies remain local. Histories use exact snapshot keys and are independent of the disposable analysis cache. Changed inputs cannot display an old snapshot's answers, and returning to identical inputs can reuse the matching history.

## OpenRouter alias compatibility · 22 October 2026

The recording-enabled suite passes **310 tests, 2 skipped**. A regression reproduces rejection of a dated GPT-6 Luna response when the requested model is its undated alias. The fix verifies both names against OpenRouter's public canonical model catalog; it retains the selected model and Medium reasoning on both the analysis and final source-check requests. Tests reject unrelated models, incorrect dates, malformed catalogs and paid/free route changes, verify that the catalog request carries neither credentials nor telemetry, and stop before another paid request if scope is revoked during verification. This regression uses mocked inference responses; it does not establish the cause of an unreported user error or claim a completed live inference run.

## Corner/report validation repair · 22 October 2026

The reported three-request failure corresponds to the draft, source check and failed bounded repair; the supplied screenshot shows corner mode. The original rejected response was not available, so its precise failing field cannot be established from that generic message alone. The recording-enabled suite passes **314 tests, 2 skipped**. New regressions allow known corner/lap labels and small repetition counts while rejecting numeric driving targets, decimal repetition counts and unknown lap labels. They cover corner-scoped strict schemas, bounded source enums for larger sessions, unchanged deterministic source rejection, Medium reasoning throughout structured session checking/repair, and the final error including its underlying validation reason. These regressions use mocked inference, not a claim of live Luna output quality.
