# Local MCP agent

Apex remains a static app. A Node.js helper runs alongside your agent and connects to one explicitly paired browser tab over loopback WebSocket. No hosted inference or relay is involved. Use Node.js 22+.

## Simple connection

Open **Connect AI agent**. The **Simple** tab opens by default: choose **Copy setup prompt** and paste it into your local coding agent. The prompt points to the public helper script, tells the agent to use existing Apex MCP tools or run its own MCP client/helper, create a real pairing link, and verify both `apex_connection` and `apex_state` before reporting success. It does not ask you to install an extension or manually change global MCP settings.

Open the pairing link in this browser profile on the same computer as the helper, press **Connect agent**, and approve device access if requested. The prompt does not contain your pairing token. The green pill confirms a live connection. **Advanced** retains the manual guide, command/configuration, port/token fields, and optional navigation/video permissions.

The agent needs local execution tools or an existing usable Apex MCP connection. A chat-only client cannot acquire access to your computer just by receiving a prompt. If those tools are unavailable, use a compatible local agent or the manual setup below. Closing the local MCP client/helper ends its connection.

## Connect in three steps

### 1. Add Apex to your agent

Install [Node.js 22 or newer](https://nodejs.org/). You do not need to download Apex’s source code.

In your AI app’s **MCP settings**, use **npm** as the command and these arguments:

```json
{
  "mcpServers": {
    "apex": {
      "command": "npm",
      "args": [
        "exec",
        "--yes",
        "--package=github:markthebault/apex-racechrono-studio",
        "--",
        "apex-mcp"
      ]
    }
  }
}
```

Your agent downloads the helper from Apex’s public GitHub repository and starts it automatically. Restart the agent or refresh its MCP tools after adding it. The first download may take longer; allow at least a minute for startup in clients that support a startup-timeout setting. Internet access is needed to install the helper.

The equivalent terminal command is:

```sh
npm exec --yes --package=github:markthebault/apex-racechrono-studio -- apex-mcp
```

The terminal command starts an MCP stdio server, so it normally waits for an agent rather than showing an interactive interface. For a persistent installation, you can use `npm install --global github:markthebault/apex-racechrono-studio` and configure **apex-mcp** as the command. This installs from GitHub; it is not a package published to the npm registry. For a fixed version, append `#<commit-or-tag>` to the GitHub package reference.

### 2. Open your pairing link

Tell your agent:

> Connect to Apex using apex_connection and give me the pairing link.

Open that link in Chrome or Edge **on the same computer as the agent**. Apex fills in the connection details for you.

### 3. Connect and look for green

Press **Connect agent** in Apex. If your browser asks to access apps on this device, choose **Allow**.

- **Orange — MCP enabled · Waiting:** Apex is trying to reach your agent. Keep the agent app running.
- **Green — Agent connected:** the connection succeeded. Your agent can now inspect the workspace and query your data.
- **Gray — Connect AI agent:** MCP is off.

Navigation/import and video frames are optional checkboxes. Enable only the access you want. To stop sharing, click the status pill, then **Disconnect agent**.

## Use Race Engineer without API keys

Open **Race Engineer**, select a corner or **Session debrief**, and copy the review request into your connected agent’s chat. The agent reads the current review through `apex_engineer_context`, then sends advice back with `apex_engineer_report`. Advice appears in Apex and is saved locally. Asking a question creates a request to send; it does not automatically start an AI turn. Your agent manages its own model/account.

Try asking:

> Explain the difference between the two laps I’m looking at. Start with my current selection.

With video linked and frame sharing enabled:

> Show frames before, during and after this corner. Describe what you can see and what remains uncertain.

**Still orange?** Check that the agent’s Apex MCP server is running and your browser allows device access. Ask the agent for a fresh pairing link if the helper restarted. Each helper process gets a new token; an older link will no longer work.

## Local development and troubleshooting

Contributors can still run `npm ci` in a checkout and configure `node` with the full path to `mcp/server.mjs`. `npm run mcp` also starts the helper from a checkout.


For local development, run `npm run dev -- --port 5174`. Set `APEX_MCP_APP` to that development URL in the MCP process environment. If that port is occupied, use the actual URL Vite reports. `APEX_MCP_PORT` changes the helper's default port (7318); `APEX_MCP_ORIGINS` adds an explicit comma-separated origin allowlist for other deployments. These settings belong in untracked local configuration. The helper always binds to 127.0.0.1. The browser and helper must be on the same computer. Remote agents require a separately designed secure connection.

Hosted HTTPS pages need browser permission to access loopback services. Start with Chrome or Edge; support depends on the browser's local network policy. Safari is not validated. If connection fails, check site permissions, the configured app origin, and that the helper is running. Never expose the helper on a public interface.

## Tools

- `apex_turns`: numbered detected bends (T1, T2…), reference ID, direction, distance bounds and selection, matching Analyze. These are automatic GPS labels, not official circuit numbering. `apex_view` accepts a `turnId` to focus one; use a separate call when changing laps.
- `apex_engineer_context`: current Race Engineer snapshot, selected `reviewMode` (turns or sections), `reviewRegions`, pending user request, expected report schema and links to Analyze turn IDs. Turn mode uses T1, T2… directly; section mode maps broader windows to turns. The tab must be open and ready.
- `apex_engineer_report`: return a report for that exact request and snapshot, validate its sources, merge existing advice and save it in Apex. Invalid, stale or replayed reports are refused.
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

To verify the public installer, set `APEX_MCP_PACKAGE` to a GitHub package reference (optionally pinned to a commit/tag), then run `npm run test:mcp-install`. It downloads and starts the public package through `npm exec` and checks the MCP handshake and pairing tool. Leave the variable unset to skip the network install. A fresh npm cache can be selected with npm’s standard `npm_config_cache` setting.
