# Phone and tablet analysis

Analyze uses a compact workspace on narrow screens and devices with a coarse primary pointer. Portrait screens keep the map above telemetry; landscape screens use two panes side by side. Desktop analysis keeps its existing charts and tools. The menu icon shares one row with the A/B lap selectors; compact playback and timeline controls sit above telemetry alongside Full and Channels.

- Tap **A** or **B** to choose a lap in a searchable sheet. Mobile compares A/B; additional desktop comparisons remain saved. The theoretical composite option always includes its sector count.
- Tap or drag horizontally with **one finger** across a trace to move the shared playhead, cars and synchronized video. It does not change the zoom window.
- Use **two fingers** to slide the timeline or pinch to zoom, anchored at the midpoint between your fingers. Both gestures work together and across channel rows. Lifting one finger after a pinch keeps the playhead still until both fingers lift. There are no gesture modes to switch. **Full** resets the window; Analysis options includes alternative zoom buttons for accessibility.
- Swipe vertically over telemetry to scroll extra channels. The map and lap selectors stay visible. **Channels** chooses up to eight available signals, with independent mobile preferences.
- Drag the divider to resize the panes. The divider also supports arrow keys. The split and channel choices are remembered locally.
- **Layers** reveals map legends, turn labels and color options. **Follow car** keeps the current position centered; dragging the map stops following.
- The turn selector uses the same catalogue as Analyze and MCP. GPS quality warnings remain visible for flagged laps. UI telemetry colors, comparison alignment, speed units and snapshot rules are unchanged.
- **Video** reveals linked local clips above the map. Videos follow the selected position and comparison alignment, with sound initially off. Missing clips and gaps are indicated explicitly. Link/synchronize clips in **Video sync**. No recording is uploaded by this UI.
- Analysis options include playback speed, alignment, units, agent connection and links to the existing video setup and legal pages. **Open full analysis tools** retains access to 3D, additional laps, overlays and the other existing analysis controls; **Touch workspace** returns to the compact layout. MCP state identifies the touch layout, visible channel list, comparison IDs and gesture mode.

## Local verification

Run `npm test` and `npm run build`. For browser checks, point `APEX_TEST_APP` at the local development server and `APEX_FIXTURES` at a private directory of RCZ recordings, then run:

```sh
npm run test:mobile
npm run test:mobile-video
```

`APEX_EVIDENCE` chooses an ignored output directory for screenshots and the test report. `APEX_RECORD_MOBILE=1` records an annotated WebM walkthrough. `APEX_MOBILE_ENGINE=webkit` repeats analysis checks with Playwright WebKit. `APEX_MOBILE_CASE` can select a single viewport from the suite. Missing real recordings skip fixture-dependent checks.

Chromium checks use touch-enabled phone/tablet contexts and native emulated touch gestures, including vertical channel scrolling, playback, two-finger pinch/pan, mixed gestures, cancellation, lap switching, resizing and refresh persistence. WebKit checks use touch taps, pointer drags and synthetic multi-touch events; synthetic events exercise the gesture handlers but do not verify native Safari gesture arbitration. On the current Linux test host, WebKit rejects even a newly constructed Blob in IndexedDB, independently of Apex. The WebKit suite therefore seeds decoded real-session data without the original file blob; it does not validate native file import. Physical iPhone/iPad Safari validation is still required before release.

The video integration check uses an explicitly synthetic generated clip to verify A/B positions, play/pause, missing-file and clip-gap states. It makes no visual driving-line claim. Fixtures, recordings, videos and browser evidence remain private and excluded from the published build.
