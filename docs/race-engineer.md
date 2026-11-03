# Race Engineer — Stage 1

Open **Race Engineer** after importing timed RCZ/VBO sessions. Select the lap to review in Analyze, choose the comparison laps, and inspect the deterministic observations before asking an agent to interpret them. The default scope is the selected layout on the reference recording's UTC day. Cross-day comparisons require an explicit checkbox; different supplied vehicle/setup/tires/condition contexts are rejected rather than pooled.

This is a telemetry-first implementation. Optional synchronized video frame extraction is available through MCP; camera perspective and calibration limit visual interpretation. Harry's LapTimer `.hlptrl` files are not supported by the importer.

## Turns or sections

Use **Turn analysis / Section analysis** at the top of Race Engineer.

- **Turn analysis** reviews the same **T1, T2, …** detected bends shown in Analyze. Each turn gets its own top-three pass ranking, map, speed/G traces and AI review. It uses Analyze's reference lap so the numbers match; change the Analyze reference to change that catalogue. These are automatic GPS labels, not official circuit numbers or verified apexes.
- **Section analysis** keeps the broader comparison windows, which can contain several bends. Choose a review lap and edit section boundaries under **Laps & context**. Section edits are retained when switching back from turns.

In individual reviews, the full-track map shows clickable **T1, T2…** labels in turn mode and **S1, S2…** labels in section mode. Click a highlighted track segment or its label to select the review below. The selected region is orange. The dropdown and previous/next buttons stay synchronized; map labels also work with Tab, Enter and Space.

Your menu view, individual-review/session-debrief choice, selected turn or section, comparison pass and advanced-panel visibility are remembered in this browser's local storage. Region selections are kept separately per reference lap and analysis mode; a missing region/pass falls back to an available choice. Analyze also remembers its selected turn and 2D/3D view. Refreshing or switching workspace tabs restores these choices. Live MCP connections, pairing tokens and video file access are not restored by these preferences.

The switch applies to both individual reviews and session debriefs. It rebuilds evidence and clears pending agent requests. Advice is saved separately for each snapshot, so a section report cannot appear as advice for T1. New workspaces start with turn analysis; the selected mode is saved with project settings.

MCP exposes `reviewMode` and `reviewRegions` in `apex_engineer_context`. In turn mode the region IDs are the same T IDs as `apex_turns`; in section mode `numberedTurns.sections` maps review windows to T IDs. Use the current snapshot ID for every query and report.

## Review with your MCP agent

Race Engineer uses your local MCP agent for AI advice. Apex has no LLM credential form and makes no direct inference requests. Previously remembered provider credentials are removed when Race Engineer opens; saved structured reports remain available.

1. [Connect your local agent](local-mcp.md#connect-in-three-steps). Look for the green **Agent connected** pill, also shown inside Race Engineer.
2. Select a corner and choose **Copy corner review request**, or open **Session debrief** and choose **Copy session review request**.
3. Paste that request into your agent’s chat. The agent reads `apex_engineer_context`, queries the exact current review snapshot, and returns its report through `apex_engineer_report`.
4. Advice appears in the corner/session view and saves with your project settings on this device. No manual JSON paste or API key is needed. Follow-up questions use the same copy-and-send workflow.

MCP tools do not start a model conversation automatically. A copied request remains pending until your agent handles it; the UI does not pretend a model is already running. The external agent controls its model, credentials, billing and conversation history. Text in reports is rendered as text, never executable HTML. Clipboard failure leaves a selectable request in Apex.

The mounted Race Engineer review has its own snapshot ID, which includes its modeled-state settings. `apex_engineer_context` supplies this exact ID, pending request ID, selected laps, review instructions and report schema. Do not use `apex_prepare_analysis` to create a different snapshot for that request. Submitted reports must match the current request and snapshot, cite valid evidence and include every available top-three pass for a corner. A replayed, stale or invalid report is refused. Navigation away or scope changes invalidate the mounted review. Changing only saved reports does not reset it. Advice for other corners and the session is preserved when a new report is merged.

Corner maps, pass rankings and speed/G traces work locally without an agent. Video stills are available separately through the local MCP bridge when linked, synchronized and explicitly approved. No video accompanies the demo sessions.

Advanced tools retain portable packet export and manual report import. The previous browser-specific WebMCP approval workflow is no longer part of this tab. The MCP connection is the access control for external analysis requests; disconnecting stops new tool access. No arbitrary JavaScript or file-write tool is exposed.

## Measurement policy

- Raw channel data remains unchanged. Speed normalizes to m/s, acceleration to m/s², pressure to bar; display speed follows km/h or mph. Throttle angle, accelerator pedal, brake pressure/position/switch and individual wheel identities remain distinct.
- Derived acceleration uses centered native-speed local linear regression over 0.6 s, with at least three points and at least 0.2 s of support on each side. Coarse sampling above 500 ms and unsupported gaps/edges return unavailable values. Measured acceleration remains separate.
- Geometry uses physical GPS arc length retained as `Trace.rawDistance`; aligned `Trace.distance` remains the existing chart reference progress. Curvature uses a local metric three-point circle over approximately ±12 m, rejects GPS gaps/jumps and stationary windows, and never uses aligned reference progress as physical arc length.
- Review regions are shared by all laps in a snapshot. Turn mode uses the Analyze bend detector; section mode groups nearby turning regions into broader complexes and supports manual boundary corrections. Minimum speed does not establish a geometric apex; speed-derived deceleration is not measured pedal application.
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

## Interpretation and saved advice

A structured review may include a short summary even when no pattern is supported. Evidence references validate scope, not the truth of an explanation. In section mode, automatically detected review windows are at most 400 m and may divide a bend or contain several bends. Turn mode uses individual detected bends, without that window length limit. Inspect the map before drawing technique conclusions.

Separate recordings with incomplete vehicle, setup, tires or condition context remain visible in measurements but do not contribute to ranked coaching or envelope fitting alongside the reference recording. Matching, known context enables pooling. Coaching filters do not change optimal-lap sector eligibility.

Structured reports save with the existing project settings and reappear for matching snapshots. Corner advice merges by section so another review does not discard previous corners or the session debrief. The external agent owns its conversation history. Old plaintext provider credentials are removed when the tab opens; no credential or provider history is needed to reopen saved reports.

## Top-three corner coaching and G forces

Each common section is ranked by its own elapsed time, independently of total lap pace. The three quickest distinct quality-eligible passes are used; fewer available passes remain visibly fewer. Unaffected windows on a GPS-gap lap may qualify, while invalid windows and unverified cross-recording context do not. These coaching filters do not affect optimal-lap eligibility.

The read-only `apex_corner_review` query supplies all top-three measurements, the review pass when different, and aligned speed/signed G traces at 72 distance samples. Mapped recorded longitudinal/lateral channels take precedence, including true zero. Without them, longitudinal acceleration is estimated from the verified speed channel with the existing centered 0.6-second regression; lateral acceleration is estimated as speed squared times signed physical GPS curvature. Traces use a 500 ms interpolation limit and preserve missing samples as gaps. Summaries divide by standard gravity and use a 95th percentile: positive deceleration magnitude, positive acceleration magnitude and absolute lateral magnitude. They are not absolute or simultaneous axis peaks.

Sources are labeled beside the pass list and charts. Recorded axes require verified orientation/calibration; estimates are affected by GPS noise, grade and banking. Neither establishes pedal use, exact racing line, ABS or unused tyre grip. A model must compare all available top-three passes, consider counterexamples and separate a one-off slow lap from a repeated pattern. Automatic sections remain review windows until their boundaries are verified.

Reports optionally contain `cornerReviews`, preserved with existing session reports and normalized source IDs. Validation requires every available top-three source, rejects cross-corner and explicitly unreliable sources, and keeps numerical facts in observation/explanation fields. Practice advice/checks cannot invent numerical driving targets or tolerances; output uses dashboard speed units and g. The external agent can revise a rejected report and submit it again. These checks constrain structure and certain unsupported prescriptions; they do not prove every generated explanation true. Follow-up questions rebuild their context when the selected corner changes, and saving preserves advice for other corners.

## Plain-English coaching

Corner and session review requests share a plain-English writing instruction. Answers should use short sentences, explain necessary technical terms, address the driver directly, and give one clear practice step with a way to check it. Measured facts remain separate from possible causes. Shared limitations belong in the assessment or limitations field instead of being repeated in every paragraph. These writing instructions retain the existing source, unit, uncertainty and unsupported-advice checks; they do not prove a generated explanation true.

## Report schema and validation

`apex_engineer_context` provides the report schema for the requested session or corner. Source eligibility, all-pass coverage, units, repeated-pattern support and coaching prose checks run locally when `apex_engineer_report` returns advice. Rejections return an actionable error to the agent and do not save the invalid report. Schema/reference validation does not prove the explanation true.

Practice instructions may name known corners or laps and request small repetition counts such as “3 clean passes”. Invented numerical driving targets, arbitrary tolerances, unsupported driving prescriptions and raw SI speed prose remain rejected. Keep measured numbers in observations and compare practice against the measured baseline.

## Numbered turns in Analyze

Analyze detects GPS bends on its reference lap and labels them **T1, T2, …** in driving order. The 2D and 3D map and turn picker share these IDs; selecting a turn focuses its distance range and moves the cursor to its representative bend point. Sector gates remain separate. Turn labels sit halfway through the accumulated direction change, which keeps a brief curvature peak on entry from pulling the marker away from the body of the bend. This representative point is not a surveyed geometric apex.

Turn IDs are local to the reference lap and can change when the reference or track scope changes. They are not official circuit numbers, surveyed corners or verified geometric apexes. Gentle, noisy or closely connected bends may be omitted or grouped. Detection does not change timing gates, theoretical-lap sectors or coaching eligibility.

Race Engineer offers a Turn / Section analysis switch. Turn analysis uses these same T IDs and the Analyze reference lap. Section analysis retains its broader windows and shows the overlapping Analyze turn labels. MCP `apex_turns` returns the reference ID, distance bounds, direction and current selection; `apex_state` includes the same catalogue. `apex_view` accepts `turnId` to focus a turn (use a separate command when changing laps). `apex_engineer_context` maps its review sections onto the Analyze reference before returning their overlapping turn IDs; incompatible alignment returns no section mapping.
