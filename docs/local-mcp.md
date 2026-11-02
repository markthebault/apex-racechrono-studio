# Local MCP agent

Apex remains a static app. A Node.js helper runs alongside your agent and connects to one explicitly paired browser tab over loopback WebSocket. No hosted inference or relay is involved. Use Node.js 22+.

From a checkout, run `npm ci`, then configure your MCP client to start `node` with `mcp/server.mjs` as its argument and the checkout as its working directory. Alternatively, supply the absolute path to that script. `npm run mcp` also starts it. Standard output is exclusively MCP; diagnostics use standard error.

1. Ask the agent to call `apex_connection` and open the returned pairing URL in your browser.
2. Apex opens **Local MCP agent**. Press **Connect agent** to share workspace metadata and requested analysis. Enable navigation/import or video frames separately as needed.
3. The agent refreshes its tool list after pairing, reads `apex_state` and `apex_guide`, and queries the selected data.
4. **Disconnect agent** revokes access. Pairing tokens are generated per helper process and are not persisted by Apex. Restarting the helper requires a new pairing link.

For local development, run `npm run dev -- --port 5174`. Set `APEX_MCP_APP` to that development URL in the MCP process environment. If that port is occupied, use the actual URL Vite reports. `APEX_MCP_PORT` changes the helper's default port (7318); `APEX_MCP_ORIGINS` adds an explicit comma-separated origin allowlist for other deployments. These settings belong in untracked local configuration. The helper always binds to 127.0.0.1. The browser and helper must be on the same computer. Remote agents require a separately designed secure connection.

Hosted HTTPS pages need browser permission to access loopback services. Start with Chrome or Edge; support depends on the browser's local network policy. Safari is not validated. If connection fails, check site permissions, the configured app origin, and that the helper is running. Never expose the helper on a public interface.

## Tools

- `apex_connection`: pairing URL and connected status; available before pairing.
- `apex_import_session`: read a local `.rcz`/`.vbo` file (maximum 8 MiB) and import it into the paired tab, with control permission. Larger files can be imported through the UI. This helper provides no arbitrary file-writing or JavaScript-execution tool.
- `apex_state`: workspace, lap A/B, visible chart channels, units, range, cursor, hover, playback, recording/lap inventory, video availability, permissions and view revision.
- `apex_view`: navigate, select comparison laps, set distance range/cursor. Optional `revision` refuses stale views. Coordinates are meters of reference progress. View changes do not edit recordings. Read state after applying; ranges clamp to lap length.
- `apex_guide`: workflow and interpretation limitations.
- `apex_prepare_analysis`: choose explicit lap IDs and a recorded reference. Returns the snapshot ID required by all nine existing analysis tools (`summary`, `debrief`, `capabilities`, `corner_review`, `corners`, `comparison`, `envelope`, `modeled`, `telemetry`, each prefixed `apex_`). Analysis is independent of which panel is mounted. Changing source recordings or engineer settings invalidates it. Preparing a new analysis disposes the previous one.
- `apex_video_frames`: up to six JPEG images, at specified lap-relative seconds, from already linked and synchronized local video. Includes clip times, session timestamps, resolution and limitations. Uses a separate decoder so playback is preserved; maximum width 1280 pixels. No video is uploaded until an approved request. Missing clips, absent synchronization, invalid ranges and decode failures return errors.

Commands are serialized per connection. Do not blindly retry an action after a disconnect or timeout: it may already have completed. Read state first. Video access and the connection are checked again before returning asynchronous results.

Video evidence can support observations about visible kerbs, apex timing, traffic and relative position. Camera perspective, hidden edges, synchronization error and lack of calibration limit conclusions. A frame does not establish metric track-edge clearance or an optimal line; compare sequences across laps and state uncertainty. GPS does not establish pedal inputs. Channel provenance and coverage must be checked before interpreting recorded throttle or RPM. Automatic review windows are not surveyed corners.

## Validation

`npm test` runs the existing unit suite. `npm run build` checks TypeScript and produces the static app. With a dev server running, set `APEX_FIXTURES` to your demo recording folder and run `npm run test:mcp`. Optionally set `APEX_TEST_APP` and `CHROME_PATH`. The browser test imports real recordings through a real stdio MCP client and local WebSocket, exercises scope checks, analysis, navigation, permission denial, disconnect and generated-video decoding. It skips when `APEX_FIXTURES` is absent. Detailed results are written to ignored `evidence/` files. It does not invoke a separately billed AI provider.

Only `dist/` is deployed. Demo recordings live outside the public assets and production build.
