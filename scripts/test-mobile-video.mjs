import assert from "node:assert/strict";
import { chromium, devices } from "playwright";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    ...devices["iPhone 13"],
    deviceScaleFactor: 1,
  });
  await page.goto(process.env.APEX_TEST_APP || "http://localhost:5174/");
  await page.evaluate(async () => {
    const moduleReact = await import("/node_modules/.vite/deps/react.js");
    const React = moduleReact.default ?? moduleReact;
    const module = await import("/node_modules/.vite/deps/react-dom_client.js");
    const createRoot = module.createRoot ?? module.default.createRoot;
    const { MobileVideo } = await import("/src/MobileAnalysis.tsx");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d"),
      stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" }),
      chunks = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = i < 15 ? "red" : "blue";
      ctx.fillRect(0, 0, 320, 180);
      await new Promise((r) => setTimeout(r, 55));
    }
    recorder.stop();
    await done;
    stream.getTracks().forEach((t) => t.stop());
    const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
    const binding = {
      session: { sha256: "synthetic", name: "synthetic", size: 0 },
      anchors: [{ videoSeconds: 0, sessionTimestamp: 10000 }],
      clips: [
        {
          sha256: "synthetic-clip",
          name: "synthetic.webm",
          size: 0,
          start: 0,
          duration: 1.6,
        },
      ],
    };
    const box = document.createElement("div");
    box.id = "video-harness";
    box.style.cssText =
      "position:fixed;inset:0;background:black;z-index:99999;display:flex;height:180px";
    document.body.append(box);
    const root = createRoot(box);
    window.renderMobileVideo = (a, b, playing = false, files = true) =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          ...[
            ["A", a],
            ["B", b],
          ].map(([tag, stamp]) =>
            React.createElement(MobileVideo, {
              key: tag,
              media: { tag, stamp, binding },
              files: files ? { "synthetic-clip": url } : {},
              playing,
              rate: 1,
            }),
          ),
        ),
      );
    window.renderMobileVideo(10400, 10900);
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#video-harness video")].length === 2 &&
      [...document.querySelectorAll("#video-harness video")].every(
        (v) => v.readyState >= 2,
      ),
  );
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('[data-video-tag="A"] video').currentTime - 0.4,
      ) < 0.08 &&
      Math.abs(
        document.querySelector('[data-video-tag="B"] video').currentTime - 0.9,
      ) < 0.08,
  );
  await page.evaluate(() => window.renderMobileVideo(10600, 11200));
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('[data-video-tag="A"] video').currentTime - 0.6,
      ) < 0.08 &&
      Math.abs(
        document.querySelector('[data-video-tag="B"] video').currentTime - 1.2,
      ) < 0.08,
  );
  await page.evaluate(() => window.renderMobileVideo(10600, 11200, true));
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#video-harness video")].every(
      (v) => !v.paused,
    ),
  );
  await page.evaluate(() => window.renderMobileVideo(10600, 11200, false));
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#video-harness video")].every(
      (v) => v.paused,
    ),
  );
  await page.evaluate(() => window.renderMobileVideo(14000, 14000));
  await page
    .getByText("A · No synchronized clip here", { exact: true })
    .waitFor();
  assert.equal(await page.locator("#video-harness video").count(), 0);
  await page.evaluate(() =>
    window.renderMobileVideo(10600, 11200, false, false),
  );
  await page.getByText("A · Relink local video", { exact: true }).waitFor();
  console.log(
    JSON.stringify({
      passed: true,
      syntheticClips: true,
      comparisonScrub: true,
      playPause: true,
      gaps: true,
      missingFiles: true,
    }),
  );
} finally {
  await browser.close();
}
