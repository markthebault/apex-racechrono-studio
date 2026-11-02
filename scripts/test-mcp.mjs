import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const app = process.env.APEX_TEST_APP || "http://localhost:5175/";
const fixtures = process.env.APEX_FIXTURES;
if (!fixtures) {
  console.log("SKIP: APEX_FIXTURES required");
  process.exit(0);
}
const names = (await readdir(fixtures).catch(() => []))
  .filter((n) => n.endsWith(".rcz"))
  .sort();
if (!names.length) {
  console.log("SKIP: fixture recordings missing");
  process.exit(0);
}
const client = new Client({ name: "apex-browser-test", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["mcp/server.mjs"],
  env: { ...process.env, APEX_MCP_APP: app },
  stderr: "pipe",
});
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" }),
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 180000,
  });
  if (r.isError) throw Error(r.content[0].text);
  return r;
};
const json = async (name, args = {}) =>
  JSON.parse((await call(name, args)).content[0].text);
try {
  await client.connect(transport);
  const connection = await json("apex_connection");
  await page.goto(connection.pairingUrl);
  await page
    .getByRole("button", { name: "Connect agent", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Agent connected", exact: true })
    .waitFor();
  assert(await page.locator(".agent-pill.is-connected").count());
  const definitions = await client.listTools();
  assert(definitions.tools.some((t) => t.name === "apex_video_frames"));
  let denied = await client.callTool({
    name: "apex_import_session",
    arguments: { path: resolve(fixtures, names[0]) },
  });
  assert(denied.isError);
  await page.getByLabel("Allow navigation and session import").check();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  for (const name of names)
    await json("apex_import_session", { path: resolve(fixtures, name) });
  await page.waitForTimeout(1000);
  let state = await json("apex_state");
  assert.equal(state.recordings.length, names.length);
  const ranked = state.recordings
    .flatMap((s) => s.laps.map((l) => ({ ...l, session: s.name })))
    .filter((l) => !l.issues.length)
    .sort((a, b) => a.durationMs - b.durationMs);
  assert(ranked.length >= 2);
  await json("apex_view", {
    lapId: ranked[0].id,
    comparisonLapId: ranked[1].id,
    tab: "Analyze",
    range: [100, 400],
    cursor: 200,
  });
  await page.waitForTimeout(500);
  state = await json("apex_state");
  assert.equal(state.lapId, ranked[0].id);
  assert.deepEqual(state.range, [100, 400]);
  assert.equal(state.cursor, 200);
  const prep = await json("apex_prepare_analysis", {
    lapIds: ranked.map((l) => l.id),
    referenceId: ranked[0].id,
  });
  const summary = await json("apex_summary", { snapshotId: prep.snapshotId });
  const debrief = await json("apex_debrief", { snapshotId: prep.snapshotId });
  const capabilities = await json("apex_capabilities", {
    snapshotId: prep.snapshotId,
  });
  const telemetry = await json("apex_telemetry", {
    snapshotId: prep.snapshotId,
    lapId: ranked[0].id,
    channel: "speed",
    start: 100,
    end: 400,
    points: 100,
  });
  assert.equal(telemetry.values.length, 100);
  const corner = summary.corners[0];
  const review = corner
    ? await json("apex_corner_review", {
        snapshotId: prep.snapshotId,
        cornerId: corner.id,
      })
    : null;
  const stale = await client.callTool({
    name: "apex_summary",
    arguments: { snapshotId: "wrong" },
  });
  assert(stale.isError);
  const videoDenied = await client.callTool({
    name: "apex_video_frames",
    arguments: { lapId: ranked[0].id, times: [10] },
  });
  assert(videoDenied.isError);
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/mcp-demo.json",
    JSON.stringify(
      { ranked, state, summary, debrief, capabilities, review },
      null,
      2,
    ),
  );
  // Exercise the actual browser decoder with a generated two-second clip.
  const videoTest = await page.evaluate(async () => {
    const { captureFrames } = await import("/src/agent/video.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const finished = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = i < 12 ? "red" : "blue";
      ctx.fillRect(0, 0, 320, 180);
      await new Promise((r) => setTimeout(r, 85));
    }
    recorder.stop();
    await finished;
    stream.getTracks().forEach((t) => t.stop());
    const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
    const session = { laps: [{ id: "test", start: 10000, end: 12000 }] };
    const binding = {
      anchors: [{ videoSeconds: 0, sessionTimestamp: 10000 }],
      clips: [
        { sha256: "clip", name: "synthetic.webm", start: 0, duration: 2 },
      ],
    };
    try {
      const result = await captureFrames(session, "test", [0.3, 1.5], binding, {
        clip: url,
      });
      const colors = await Promise.all(
        result.frames.map(async (f) => {
          const img = new Image();
          img.src = "data:image/jpeg;base64," + f.data;
          await img.decode();
          ctx.drawImage(img, 0, 0);
          return Array.from(ctx.getImageData(20, 20, 1, 1).data);
        }),
      );
      return { frames: result.frames.map(({ data, ...f }) => f), colors };
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  assert.equal(videoTest.frames.length, 2);
  assert(videoTest.colors[0][0] > 200);
  assert(videoTest.colors[1][2] > 200);
  await page
    .getByRole("button", { name: "Agent connected", exact: true })
    .click();
  await page.getByLabel("Share linked video frames").check();
  const missingVideo = await client.callTool({
    name: "apex_video_frames",
    arguments: { lapId: ranked[0].id, times: [10] },
  });
  assert(missingVideo.isError);
  assert.match(missingVideo.content[0].text, /video_unavailable/);
  await page
    .getByRole("button", { name: "Disconnect agent", exact: true })
    .click();
  await page.waitForTimeout(100);
  assert.equal((await json("apex_connection")).connected, false);
  assert(await page.locator(".agent-pill.is-off").count());
  await page
    .getByRole("button", { name: "Connect agent", exact: true })
    .click();
  await page.locator(".agent-pill.is-connected").waitFor();
  await client.close();
  await page.locator(".agent-pill.is-waiting").waitFor();
  assert.match(
    await page.locator(".agent-pill").innerText(),
    /MCP enabled · Waiting/,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      recordings: state.recordings.length,
      laps: ranked.length,
      snapshotId: prep.snapshotId,
      fastest: ranked[0],
      tools: definitions.tools.length,
    }),
  );
} finally {
  await browser.close();
  await client.close();
}
