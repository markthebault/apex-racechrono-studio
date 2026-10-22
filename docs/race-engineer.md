# Race Engineer — Stage 1

Open **Race Engineer** after importing timed RCZ/VBO sessions. Select the lap to review in Analyze, choose the comparison laps, and inspect the deterministic observations before asking an agent to interpret them. The default scope is the selected layout on the reference recording's UTC day. Cross-day comparisons require an explicit checkbox; different supplied vehicle/setup/tires/condition contexts are rejected rather than pooled.

This is a telemetry-first implementation. Stage 2 image extraction and vision are not included. Harry's LapTimer `.hlptrl` files are not supported by the importer.

## Review and AI workflow

Race Engineer opens with **Corners**: select a corner/section, see its three quickest valid passes and compare the map, speed, longitudinal G and lateral G. Enter your API key and choose **Analyze this corner** for advice based on every available top-three pass. The next-session step and success check appear first; **Why this advice?** expands the all-pass observations, possible mistakes and limitations. Selecting a ranked pass changes the map comparison. **Open this section** opens the existing analyzer. **Session debrief** retains the whole-session findings, progression and practice plan. Advice for all analyzed corners, the session review and follow-up replies save automatically on this device. **Saved on this device** confirms the write has finished; no Save button or repeat API request is needed. Structured reports are also added to the project settings for export. API usage is billed directly by the selected provider; there is no server-side key proxy. Connection/model details stay behind **Connection**.

Keys remain in memory while the panel is open unless **Remember on this browser** is selected. Remembered keys are stored in plaintext local storage, readable by scripts on this origin. **Forget key** removes the saved key. Changing the endpoint/provider clears the key and transient provider conversation so a previous provider's credential is never reused automatically. These connection changes retain saved answers. Credentials and chat history are outside project settings, project/Drive exports and telemetry packets. HTTPS is required except for a loopback provider. Provider/model support for tool calling and browser CORS is required; compatible JSON shape alone does not guarantee it works. OpenAI recommends keeping API keys server-side; this user-owned browser-key mode deliberately accepts that exposure for a local/personal workflow. See [official API authentication guidance](https://developers.openai.com/api/reference/overview).

API turns time out after three minutes at Low reasoning, four at Medium and five at High, with six-request/16-tool-call limits, at most eight calls per response, bounded history/response sizes and a **Stop review** control. No automatic retry or provider fallback occurs. Scope changes, navigation, cancel or revocation stop access. The API-chat grant is independent of external WebMCP consent: using the panel never opens site tools to a browser agent. No recordings, video, precise coordinates or boundary geometry are sent. Context/condition notes are shared as untrusted data. Model prose is interpreted only as text; no HTML, executable actions or model-chosen network URLs are supported.

For external-agent review:

1. Inspect **Data readiness**. GPS speed is sufficient. Imported unknown channels do not acquire engineering semantics automatically.
2. Fill in vehicle, setup, tires and conditions where known. For custom channels, inspect the original identifiers, choose an explicit semantic, unit, scale, offset and sign, and confirm the mapping only after verifying the recording's encoding and any sensor mounting/gravity/bias correction.
3. Inspect up to three supported priorities and the complete corner table. **Source metrics** exposes units, methods, source channels, uncertainty and unavailable reasons. Region JSON can rename, merge, split or adjust ordered windows without changing imported laps or existing sector gates.
4. **Open supporting charts and map** selects the source laps and focuses the corresponding telemetry timestamps on the analyzer's existing reference axis.
5. In a compatible ChatGPT built-in browser, inspect the sharing preview, then approve that immutable analysis snapshot. The nine `apex_*` site tools return summaries, a whole-session digest, top-three corner speed/G profiles, capabilities, section measurements, lap comparisons, envelope bins, modeled-reference status or a bounded telemetry window. Each call validates consent and the snapshot ID. Revocation, navigation or changed analysis invalidates access, including pending calls.
6. Alternatively, download the review packet and use its included prompt with your agent. Downloading is a deliberate local export; it does not enable site tools or send anything to a provider. APEX has no hosted inference proxy, remote MCP service or ChatGPT OAuth flow.
7. Paste/import the agent's report JSON, validate its evidence references and review its prose. Save only after reviewing. Saved reports travel in project archives; sharing permissions do not. A changed snapshot makes a historical report stale.

The built-in browser has its own storage: import the project there and approve the analysis there. Site-tool support, models, account access, workspace policy and limits vary; see the [current official OpenAI documentation](https://learn.chatgpt.com/docs/webmcp). Registration feature-detects `document.modelContext.registerTool` on the top-level document. No iframe/declarative API is assumed.

The initial release supports only the `telemetry-comparison` report category. Other claim categories, foreign evidence IDs and incompatible snapshots are rejected. This structural validation does not establish that an AI explanation is true. Free text is rendered as text, not HTML. The review prompt treats imported notes as untrusted data.

## Measurement policy

- Raw channel data remains unchanged. Speed normalizes to m/s, acceleration to m/s², pressure to bar; display speed follows km/h or mph. Throttle angle, accelerator pedal, brake pressure/position/switch and individual wheel identities remain distinct.
- Derived acceleration uses centered native-speed local linear regression over 0.6 s, with at least three points and at least 0.2 s of support on each side. Coarse sampling above 500 ms and unsupported gaps/edges return unavailable values. Measured acceleration remains separate.
- Geometry uses physical GPS arc length retained as `Trace.rawDistance`; aligned `Trace.distance` remains the existing chart reference progress. Curvature uses a local metric three-point circle over approximately ±12 m, rejects GPS gaps/jumps and stationary windows, and never uses aligned reference progress as physical arc length.
- Corner regions are shared by all laps in a snapshot. The detector groups nearby turning regions into complexes; manual corrections are expected for ambiguous layouts. Minimum speed does not establish a geometric apex; speed-derived deceleration is not measured pedal application.
- Window entry/minimum/exit speed and elapsed time use consistent reference distances. Native brake pressure/position is not normalized across laps. A valid zero brake channel yields zero recorded actuation; it never triggers a pedal inference from speed. The initial pressure-release metric is a 90%-to-10% decrease after the window maximum and requires a verified channel at 10 Hz or better; it does not diagnose trail braking, ABS or wheel lockup.
- Priorities compare recorded non-overlapping corner windows. Time differences remain observed differences; potential gains are nullable and are not manufactured. Supporting and contrary windows remain referenced. Rank also accounts for supporting-lap count and contrary results. No automatic lap-validity edits occur.
- Envelope estimates use one-second blocks, 10 m/s bins and a 90th percentile, requiring at least five supporting blocks from two distinct laps **per axis**. With four supporting laps, the last is held out from fitting and longitudinal disagreement is reported. Confidence remains low/medium, never a tire-grip guarantee. Left/right axes have separate support. The simplified combined-grip ellipse is a modeling assumption, not a fitted tire model.
- Invalid/interrupted/ambiguously aligned laps are excluded from coaching or envelope fitting, separately from existing best-sector eligibility. GPS gaps invalidate affected measurement windows. Existing interrupted/outage laps still contribute their valid sectors to the optimal lap; only sectors overlapping gaps over two seconds are skipped under the existing policy. Any numerical best-sector composite must retain its sector count.

## Local track boundaries

Boundary data is separate from catalog outlines and recorded GPS. Select an appropriately licensed file; permission metadata does not grant rights the user does not have. Boundaries and derived geometry are local-only in this release, including assets marked redistributable. They are omitted from portable projects, Drive exports, review packets and site-tool responses. The geometry cache is distinct from context/envelope/profile caches.

The version-1 interchange format is deliberately narrow: local metric x/y coordinates, a declared geographic origin `[latitude, longitude]`, layout ID, direction, explicit open/closed topology, source/date/accuracy/license/permission and a reference spine. The spine resolves correspondence; independent left/right vertex indices are never paired. Supply left/right relative to travel direction. Edge order and unequal edge sampling are allowed. Unsupported formats, wrong layouts, crossings, duplicates, missing permissions, implausible widths and disconnected/reversed corridors return an explanation.

A small synthetic open-corridor example:

```json
{
  "format": "apex-boundaries",
  "version": 1,
  "layoutId": "1",
  "direction": "eastbound",
  "topology": "open",
  "coordinates": "local-metric-xy",
  "units": "m",
  "origin": [0, 0],
  "spine": [
    [0, 0],
    [100, 0],
    [200, 0]
  ],
  "left": [
    [0, 6],
    [100, 6],
    [200, 6]
  ],
  "right": [
    [0, -6],
    [100, -6],
    [200, -6]
  ],
  "source": "Synthetic example",
  "date": "2026-01-01",
  "accuracyM": 0,
  "license": "CC0",
  "redistribution": "permitted",
  "permittedUse": true
}
```

For closed loops omit the repeated final vertex. The source geometry is preserved separately from sampled model nodes. Vehicle width starts with a displayed 1.8 m conservative assumption; adjust it and the edge clearance for the intended car before interpreting a result.

Valid input automatically schedules local worker computation. The QP uses first-order curvature linearization about the supplied metric spine, `k = cross(P', P'') / |P'|³`, including the denominator derivative. It minimizes the integrated squared linearized curvature, with `Q = 2 JᵀWJ` and `c = 2 JᵀWk₀`, a common 10⁶ objective scale and a small 10⁻³ diagonal regularizer. The implementation is independent TypeScript; no TUM code is copied or translated.

Offsets stay inside normal cross-section bounds adjusted for vehicle width, edge angle and clearance. Open endpoints and neighboring nodes are fixed to preserve entry/exit tangents. Closed loops use periodic indices. Output is a piecewise-linear modeled minimum-curvature line, not a spline, a minimum-time solution or a guaranteed safe line. Every segment is checked at intervals of at most 0.5 m against the original edges and corridor; a bounded global backtracking step checks feasibility and actual curvature improvement, with its accepted step retained in diagnostics. This is not independent vertex clipping. If no step passes, no optimized line is returned. This sampled clearance check is not a continuous certified collision proof.

HiGHS/highs-js 1.15.3 is pinned, MIT-licensed and lazy-loaded with its 3.53 MB WASM asset in a module Web Worker. An inactive row avoids the empty-row QP behavior found during the Node/WASM circle check. Solver warnings, non-optimal status, a 20 s solve limit or excessive iterations produce an unavailable result. Default resolution is 250 nodes; larger jobs are experimental and may abstain. Node benchmarks are not browser qualification.

Once geometry and sufficiently supported continuous envelope axes exist, the speed profile runs automatically. It conservatively takes the minimum supported per-bin summaries and rejects profiles leaving the observed speed coverage. Explicit user-supplied limits are a distinct alternative, with source text. Open sections additionally need entry/finish speeds. The forward/backward iteration enforces a friction ellipse and checks each segment and closed seam. Output contains speed, longitudinal/lateral demand, cumulative time, active constraints and assumptions. Optional `reductions` entries use modeled-line `startM`, `endM`, and a factor in `(0, 1]` to conservatively reduce local speed/grip/acceleration bounds. A failed speed profile leaves the validated geometry available. Changing conditions/limits invalidates the profile without rebuilding geometry.

## Persistence and operations

Settings add a validated optional `engineer` object to existing version-1 projects. No database schema migration or new source-session store is needed. Mappings, context, corner edits and reviewed reports persist with existing settings. Old projects without the object still load. Sharing permission is ephemeral and stripped from imports. Caches are disposable, bounded to 12 entries, algorithm/input keyed, and quota failures do not discard source data. Session removal clears its context/mapping/corner/report references, saved answer histories and owned analysis caches; shared geometry survives. Answer history is stored separately from the disposable analysis cache in IndexedDB, keyed by the exact analysis snapshot. Analysis-cache eviction cannot discard paid answers. Follow-up replies stay in this browser and are not included in project exports; structured reports are included. Storage failures show a warning and a retry action rather than claiming the answer was saved.

Workers reject pre-aborted, cancelled, timed-out and superseded jobs, terminate and remove listeners. Engineer operations have a two-minute outer timeout, with the QP's shorter internal limit. Late results are ignored. Production emits worker chunks and the solver asset; it does not require a compute server.

Run standard checks with `npm test` and `npm run build`. Private tests read `APEX_FIXTURES` and skip when absent. `APEX_EVIDENCE` optionally writes private results into an untracked destination. `APEX_BENCHMARK=1` additionally exercises 250/1,000/4,000 solver nodes. See [validation status](../VALIDATION.md) for the distinction between automated coverage and outstanding live-browser checks.

## OpenRouter review controls

New connections start with OpenRouter and `deepseek/deepseek-v4.1-flash-1017`; enter your own key to begin. The visible **Reasoning effort** selector offers Low, Medium and High (Low by default). OpenRouter requests use the selected effort, require parameter support, and keep the exact selected model throughout the tool loop. Every request has a 16,384-token output allowance. The sixth and final request disables tools so the model can finish its assessment. There are no automatic HTTP retries or alternate-model fallbacks. If a checked report fails source/shape validation, one targeted format repair may use a remaining request within the same six-request limit; a second failure stops the turn. Provider-reported cost is shown for the open panel; missing usage is labeled unavailable, and stopped requests may still be billed.

A structured review may include a short summary even when no priority is supported. Evidence links validate references, not the truth of an explanation. Generated distance windows are limited to 400 m and labeled **Review window**; these may divide a bend or contain multiple bends. They do not identify surveyed corners or geometric apexes. Inspect the map and adjust the windows before drawing technique conclusions. Manual region edits retain their chosen bounds.

Separate recordings with incomplete vehicle, setup, tires or condition context remain visible in the measurements, but do not contribute to ranked coaching comparisons or envelope fitting alongside the reference recording. Populate matching, known context to enable that pooling. These coaching rules do not change the optimal lap's sector eligibility.

Small-sample medians and percentiles use linear interpolation between sorted observations. This matters for repeatability: a three-lap selection must not hide its slowest lap merely by rounding the 90th-percentile index down. Review history collapses earlier turns, and follow-up text supports safe emphasis and tables without interpreting HTML.

OpenRouter reserves room within the six-request turn limit for a final check of the draft against the source evidence, using the same selected model and reasoning effort. This checks lap identity, numerical comparisons, conversions, unsupported causes and missing channels before displaying the answer. The unchecked draft is removed from chat history. This is another model request, included in the displayed usage; it reduces errors but does not prove the answer true.

## Whole-session coaching and source visuals

The session digest supplies chronological lap timing, a compact all-section evidence matrix, and deterministic screening leads for minimum-speed differences, exit-speed differences and section-time variation. Speed comparisons use common windows and similar entry speeds; these are leads for the model to investigate, not input-error diagnoses. It receives affected-lap counts and contrary examples so repeated sections on one unusual lap are not silently described as an established habit. Rows omitted by the 32 KiB digest bound are counted explicitly; section/telemetry tools remain available for follow-up investigation. This digest does not change the existing local window ranking or optimal lap.

The model is asked to assess recurring working hypotheses, strengths, consistency and progression, then propose a few useful experiments with observable success checks. Categories are optional: sparse data must produce fewer findings rather than invented mistakes. Pace progression uses recording order and excludes flagged total lap times; unaffected section windows from GPS-gap laps remain usable. A first-to-last difference is distinguished from steady improvement. Other recordings remain visible, and context restrictions still apply.

New reports optionally add a `debrief` object with a headline, assessment, up to six typed findings and three practice steps. Compact evidence/lap aliases are normalized to full snapshot-bound IDs before display or storage. Recurring findings require eligible measured sources spanning multiple laps and either multiple sections or three laps in one section. Progress findings require two clean selected laps in one recording. Section-range titles must cite each included section, so a non-contiguous selection cannot silently become a continuous range. Unknown sources and stale snapshots are rejected. These checks validate source structure, not the truth of generated prose. Legacy section reports remain readable and are labeled as earlier section reviews.

A finding’s evidence drawer offers one GPS example at a time, with a selector when several sections are cited. Orange identifies the reviewed section and reference speeds; cyan numbers belong to the displayed comparison lap. The table distinguishes cited sources from the review lap included for map context. Numbered markers identify reference entry, the native minimum-speed sample where its position is available, and exit. The highlighted metric is the largest absolute difference among those three available sampled speeds: a cue to inspect data, not a braking point, apex, surveyed track edge or racing line. GPS outages and invalid jumps break the path. Missing continuous GPS means no invented track picture. Coordinates and SVG images stay local. This is not video/vision analysis.

Choosing a different review lap recomputes section boundaries and clears stale chat while retaining the open panel’s in-memory key. **Laps & context** contains scope, reference selection and advanced tools. Changing reasoning retains the report, conversation and key, and applies to the next turn and its final source check. Explicitly remembered connections retain the effort choice. Reviews and follow-up replies reopen automatically without saving the API key or contacting a provider. Reference-lap and lap-selection preferences are remembered locally; new laps enter the analysis by default. Sessions, selected laps, validity flags, reference, context, channel mappings, section boundaries and modeled-reference status determine the snapshot. Changed inputs cannot reuse an old answer; returning to identical inputs can reopen its matching history. The active view and corner are restored too. A reopened report and recent replies for the selected corner/session are included only when the user explicitly sends a new question. Tool messages, raw telemetry, credentials and sharing grants are not stored in answer history.

## Top-three corner coaching and G forces

Each common section is ranked by its own elapsed time, independently of total lap pace. The three quickest distinct quality-eligible passes are used; fewer available passes remain visibly fewer. Unaffected windows on a GPS-gap lap may qualify, while invalid windows and unverified cross-recording context do not. These coaching filters do not affect optimal-lap eligibility.

The read-only `apex_corner_review` query supplies all top-three measurements, the review pass when different, and aligned speed/signed G traces at 72 distance samples. Mapped recorded longitudinal/lateral channels take precedence, including true zero. Without them, longitudinal acceleration is estimated from the verified speed channel with the existing centered 0.6-second regression; lateral acceleration is estimated as speed squared times signed physical GPS curvature. Traces use a 500 ms interpolation limit and preserve missing samples as gaps. Summaries divide by standard gravity and use a 95th percentile: positive deceleration magnitude, positive acceleration magnitude and absolute lateral magnitude. They are not absolute or simultaneous axis peaks.

Sources are labeled beside the pass list and charts. Recorded axes require verified orientation/calibration; estimates are affected by GPS noise, grade and banking. Neither establishes pedal use, exact racing line, ABS or unused tyre grip. A model must compare all available top-three passes, consider counterexamples and separate a one-off slow lap from a repeated pattern. Automatic sections remain review windows until their boundaries are verified.

Reports optionally contain `cornerReviews`, preserved with existing session reports and normalized source IDs. Validation requires every available top-three source, rejects cross-corner and explicitly unreliable sources, and keeps numerical facts in observation/explanation fields. Practice advice/checks cannot invent numerical driving targets or tolerances; output uses dashboard speed units and g. A final same-model source check and bounded format repair remain available. These checks constrain structure and certain unsupported prescriptions; they do not prove every generated explanation true. Follow-up questions rebuild their context when the selected corner changes, and saving preserves advice for other corners.

## Plain-English coaching

Corner reviews, session reviews and the final source check share a plain-English writing instruction. Answers should use short sentences, explain necessary technical terms, address the driver directly, and give one clear practice step with a way to check it. Measured facts remain separate from possible causes. Shared limitations belong in the assessment or limitations field instead of being repeated in every paragraph. These writing instructions retain the existing source, unit, uncertainty and unsupported-advice checks; they do not prove a generated explanation true.

## OpenRouter model aliases

Requests keep the exact model name and reasoning effort chosen in Connection. If OpenRouter returns a different response model name, the app checks its public model catalog once during that turn. A selected alias and its catalog-listed dated deployment are accepted as the same model, including compact and hyphenated date formats. A shared name prefix alone is insufficient. Different models, unlisted deployments, unverifiable responses and changed paid/free routing tags stop the review. This is identity verification, not a model fallback or another inference request. The catalog lookup sends no API key or telemetry and is bounded by the review timeout and a response-size limit.

## Structured review generation and validation errors

Fresh OpenRouter corner and session reviews send a strict JSON response schema on the initial request, final source check and bounded repair. It fixes the snapshot and selected corner, requires the report fields and constrains source choices when the vocabulary fits provider enum limits. Larger scopes retain deterministic source validation without oversized enum schemas. Follow-up questions remain plain text and do not request a report schema. Source eligibility, coverage, repeated-pattern support and prose checks still run after generation.

Practice instructions may name the known corner or selected laps and request small repetition counts, such as “3 clean passes”. Other numeric practice targets, arbitrary tolerances, unsupported driving prescriptions and raw SI speed prose remain rejected. These checks are not proof that a generated explanation is true. When the final repair still fails, the UI shows the actual local validation reason and confirms that no new advice was saved; it no longer gives an unexplained suggestion to narrow the session.
