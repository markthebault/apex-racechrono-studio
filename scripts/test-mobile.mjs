import assert from "node:assert/strict";
import {
  readdir,
  mkdir,
  writeFile,
  copyFile,
  readFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, webkit, devices } from "playwright";
const app = process.env.APEX_TEST_APP || "http://localhost:5174/";
const fixtures = process.env.APEX_FIXTURES;
if (!fixtures) {
  console.log("SKIP: APEX_FIXTURES required");
  process.exit(0);
}
const paths = (await readdir(fixtures).catch(() => []))
  .filter((n) => n.endsWith(".rcz"))
  .map((n) => resolve(fixtures, n));
if (!paths.length) {
  console.log("SKIP: recordings missing");
  process.exit(0);
}
const out = resolve(process.env.APEX_EVIDENCE || "evidence/mobile-analysis");
await mkdir(out, { recursive: true });
const engine = process.env.APEX_MOBILE_ENGINE || "chromium";
const browser =
  engine === "webkit"
    ? await webkit.launch({ headless: true })
    : await chromium.launch({
        channel: "chrome",
        headless: true,
        args: ["--no-sandbox"],
      });
const problems = [];
const report = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function prepared(context) {
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(app);
  if (engine !== "webkit")
    await page
      .locator('input[type="file"][multiple]')
      .first()
      .setInputFiles(paths);
  await page.locator(".mobile-analysis").waitFor();
  await page.locator(".ma-chart-stack canvas").first().waitFor();
  if (process.env.APEX_MOBILE_DEBUG)
    await page.evaluate(() => {
      window.mobileEvents = [];
      for (const event of [
        "click",
        "pointerdown",
        "pointerup",
        "pointercancel",
      ])
        document.addEventListener(event, (e) =>
          window.mobileEvents.push([
            event,
            e.target.tagName,
            e.target.textContent?.slice(0, 30),
            e.clientX,
            e.clientY,
          ]),
        );
    });

  await page.waitForFunction(
    () => !document.querySelector(".content > .notice"),
  );
  return page;
}
async function snapshot(page, name) {
  await page.screenshot({ path: resolve(out, `${name}.png`) });
}
const state = async (page) =>
  page.locator(".mobile-analysis").evaluate((el) => ({
    cursor: +el.dataset.cursor,
    range: el.dataset.range.split(",").map(Number),
    mode: el.dataset.interaction,
  }));
async function swipe(page, from, to, steps = 18) {
  if (engine === "webkit") {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps });
    await page.mouse.up();
    await wait(150);
    return;
  }

  const cdp = await page.context().newCDPSession(page);
  const point = (x, y) => ({ x, y, id: 1, radiusX: 5, radiusY: 5, force: 1 });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(from.x, from.y)],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        point(
          from.x + ((to.x - from.x) * i) / steps,
          from.y + ((to.y - from.y) * i) / steps,
        ),
      ],
    });
    await wait(18);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await wait(150);
}
async function chartSwipe(page, mode, fromFraction, toFraction) {
  await page.getByRole("button", { name: mode, exact: true }).tap();
  await page.waitForFunction(
    (mode) =>
      document
        .querySelector(".mobile-analysis")
        ?.getAttribute("data-interaction") === mode,
    mode === "Zoom" ? "range" : mode.toLowerCase(),
  );
  const chart = page.locator(".ma-chart-stack canvas").first();
  await chart.scrollIntoViewIfNeeded();
  const r = await chart.boundingBox();
  await swipe(
    page,
    { x: r.x + 48 + (r.width - 63) * fromFraction, y: r.y + r.height * 0.4 },
    { x: r.x + 48 + (r.width - 63) * toFraction, y: r.y + r.height * 0.4 },
  );
}
async function bounds(page) {
  return page.evaluate(() => {
    const rect = (s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    return {
      width: innerWidth,
      height: innerHeight,
      scroll: document.documentElement.scrollWidth,
      body: document.documentElement.scrollHeight,
      map: rect(".ma-map-box"),
      charts: rect(".ma-chart-stack"),
      laps: rect(".ma-lapbar"),
      transport: rect(".ma-transport"),
    };
  });
}
let saved;
let webkitSeed;
try {
  if (engine === "webkit") {
    // Linux WebKit on this host rejects even a new Blob in IndexedDB. Seed
    // decoded real-session data to exercise analysis separately from file storage.
    const seedBrowser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--no-sandbox"],
    });
    const context = await seedBrowser.newContext({ ...devices["iPhone 13"] });
    const page = await context.newPage();
    await page.goto(app);
    await page
      .locator('input[type="file"][multiple]')
      .first()
      .setInputFiles(paths);
    await page.locator(".mobile-analysis").waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".content > .notice"),
    );
    await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("apex-studio", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction("sessions", "readwrite");
        const store = tx.objectStore("sessions");
        const req = store.getAll();
        req.onsuccess = () => {
          for (const record of req.result) {
            delete record.file;
            store.put(record);
          }
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });
    webkitSeed = await context.storageState({ indexedDB: true });
    await seedBrowser.close();
  }

  for (const [name, device, size] of [
    ["phone", devices["iPhone 13"], { width: 390, height: 844 }],
    ["small-phone", devices["iPhone SE"], { width: 375, height: 667 }],
    ["tablet-portrait", devices["iPad Pro 11"], { width: 834, height: 1194 }],
    ["tablet-landscape", devices["iPad Pro 11"], { width: 1194, height: 834 }],
    ["phone-landscape", devices["iPhone 13"], { width: 844, height: 390 }],
  ]) {
    if (process.env.APEX_MOBILE_CASE && process.env.APEX_MOBILE_CASE !== name)
      continue;
    console.log(`Testing ${name}`);
    const context = await browser.newContext({
      ...device,
      ...(webkitSeed ? { storageState: webkitSeed } : {}),
      viewport: size,
      deviceScaleFactor: 1,
    });
    const page = await prepared(context);
    const geometry = await bounds(page);
    assert(
      geometry.scroll <= size.width + 1,
      `${name}: horizontal page overflow`,
    );
    assert(
      geometry.body <= size.height + 2,
      `${name}: page should fit viewport`,
    );
    assert(
      geometry.map.height >= 80 && geometry.charts.height >= 90,
      `${name}: panes visible`,
    );
    assert(
      geometry.transport.bottom <= size.height + 1,
      `${name}: transport visible`,
    );
    if (name.includes("landscape"))
      assert(
        geometry.charts.x > geometry.map.x + geometry.map.width,
        `${name}: side-by-side panes`,
      );
    else
      assert(
        geometry.charts.y > geometry.map.y + geometry.map.height,
        `${name}: stacked panes`,
      );
    const cb = await page
      .locator(".ma-chart-stack canvas")
      .first()
      .boundingBox();
    await page.touchscreen.tap(cb.x + cb.width * 0.5, cb.y + cb.height * 0.5);
    await wait(80);
    assert((await state(page)).cursor > 0, `${name}: touch tap moves cursor`);
    const played = await state(page);
    await page
      .getByRole("button", { name: "Play playback", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Pause playback", exact: true })
      .waitFor();
    await wait(300);
    assert(
      (await state(page)).cursor > played.cursor,
      `${name}: playback advances`,
    );
    await page
      .getByRole("button", { name: "Pause playback", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Play playback", exact: true })
      .waitFor();
    const before = await state(page);
    await chartSwipe(page, "Scrub", 0.15, 0.72);
    const scrubbed = await state(page);
    assert(
      Math.abs(scrubbed.cursor - before.cursor) > 50,
      `${name}: touch scrubs cursor`,
    );
    assert.deepEqual(
      scrubbed.range,
      before.range,
      `${name}: scrub must not zoom`,
    );
    await chartSwipe(page, "Zoom", 0.25, 0.7);
    const zoomed = await state(page);
    assert(
      zoomed.range[1] - zoomed.range[0] < before.range[1] - before.range[0],
      `${name}: deliberate zoom`,
    );
    await chartSwipe(page, "Pan", 0.6, 0.35);
    const panned = await state(page);
    assert(
      Math.abs(
        panned.range[1] - panned.range[0] - (zoomed.range[1] - zoomed.range[0]),
      ) < 0.1,
      `${name}: pan keeps scale`,
    );
    assert(
      Math.abs(panned.range[0] - zoomed.range[0]) > 5,
      `${name}: pan moves range`,
    );
    assert.equal(
      await page.locator(".map-legend").count(),
      0,
      `${name}: legend collapsed`,
    );
    await page.getByRole("button", { name: "Layers", exact: true }).tap();
    await page
      .getByRole("button", { name: "Speed colours", exact: true })
      .tap();
    await page.getByRole("button", { name: "Layers", exact: true }).tap();
    await page.getByRole("button", { name: "Choose lap B", exact: true }).tap();
    await page.getByRole("dialog", { name: "Select lap B" }).waitFor();
    if (name === "phone") await snapshot(page, "phone-lap-picker");
    await page
      .getByRole("dialog", { name: "Select lap B" })
      .locator(".ma-lap-option")
      .nth(2)
      .tap();
    assert.equal(await page.locator("dialog[open]").count(), 0);
    await page.getByLabel("Focus turn", { exact: true }).selectOption("T3");
    await chartSwipe(page, "Scrub", 0.35, 0.55);
    assert.equal(
      await page.getByLabel("Focus turn", { exact: true }).inputValue(),
      "T3",
      "Scrubbing retains the selected turn",
    );
    await page.getByRole("button", { name: "Scrub", exact: true }).tap();
    await page.reload();
    await page.locator('.mobile-analysis[data-interaction="scrub"]').waitFor();
    assert.equal(
      await page.getByLabel("Focus turn", { exact: true }).inputValue(),
      "T3",
    );
    await snapshot(page, name);
    if (name === "phone") {
      // Extra channels scroll inside telemetry; a vertical swipe must not zoom.
      await page
        .getByRole("button", { name: "Choose telemetry channels" })
        .tap();
      const checks = page.locator(".ma-channel-option input:not(:checked)");
      for (let i = 0; i < 3 && (await checks.count()); i++)
        await checks.first().check();
      await page.getByRole("button", { name: "Done", exact: true }).tap();
      const chart = page.locator(".ma-chart-stack canvas").first(),
        r = await chart.boundingBox();
      const start = await state(page);
      if (engine !== "webkit") {
        await swipe(
          page,
          { x: r.x + r.width * 0.65, y: r.y + r.height * 0.8 },
          { x: r.x + r.width * 0.65, y: r.y - 100 },
        );
        const after = await state(page);
        assert.deepEqual(
          after.range,
          start.range,
          "Vertical swipe must not zoom",
        );
        assert.equal(
          after.cursor,
          start.cursor,
          "Vertical swipe must not move cursor",
        );
        assert(
          (await page
            .locator(".ma-chart-stack")
            .evaluate((el) => el.scrollTop)) > 0,
          "Channels should scroll vertically",
        );
      }
      const divider = page.getByRole("separator", {
        name: "Map and telemetry split",
      });
      const old = +(await divider.getAttribute("aria-valuenow"));
      const dr = await divider.boundingBox();
      await swipe(
        page,
        { x: dr.x + dr.width / 2, y: dr.y + dr.height / 2 },
        { x: dr.x + dr.width / 2, y: dr.y + 60 },
      );
      assert.notEqual(+(await divider.getAttribute("aria-valuenow")), old);
      await page.reload();
      await page.locator(".mobile-analysis").waitFor();
      assert.notEqual(
        +(await divider.getAttribute("aria-valuenow")),
        old,
        "Split persists",
      );
      const beforeResize = await state(page);
      await page.setViewportSize({ width: 390, height: 744 });
      await wait(200);
      assert.deepEqual(
        (await state(page)).range,
        beforeResize.range,
        "Dynamic viewport height preserves the range",
      );
      assert(
        (await bounds(page)).transport.bottom <= 745,
        "Safari toolbar-sized viewport fits",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await wait(200);
      await page
        .getByRole("button", { name: "Analysis options", exact: true })
        .tap();
      await page
        .getByRole("button", { name: "Open full analysis tools", exact: true })
        .tap();
      await page
        .getByRole("button", { name: "3D elevation", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Touch workspace", exact: true })
        .tap();
      await page.locator(".mobile-analysis").waitFor();
      assert.equal(
        await page.getByLabel("Focus turn", { exact: true }).inputValue(),
        "T3",
      );
      // Preserve a ready real-session workspace for the walkthrough.
      saved = await context.storageState({ indexedDB: true });
    }
    report.push({
      name,
      viewport: size,
      engine,
      originalFileImport: engine !== "webkit",
      touchTap: true,
      nativeTouchDrag: engine !== "webkit",
      scrub: true,
      zoom: true,
      pan: true,
      fit: true,
    });
    await context.close();
  }
  assert.deepEqual(problems, []);
  await writeFile(resolve(out, "checks.json"), JSON.stringify(report, null, 2));
  if (process.env.APEX_RECORD_MOBILE) {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      storageState: saved,
      recordVideo: { dir: out, size: { width: 390, height: 844 } },
    });
    const page = await context.newPage();
    await page.goto(app);
    await page.locator(".mobile-analysis").waitFor();
    await page.getByRole("button", { name: "Reset telemetry zoom" }).tap();
    await page.getByRole("button", { name: "Choose telemetry channels" }).tap();
    // Use available real telemetry, without adding invented driving channels.
    const labels = page.locator(".ma-channel-option");
    const wanted = new Set([
      "GPS speed",
      "Longitudinal acceleration · calculated",
      "Altitude",
    ]);
    for (let i = 0; i < (await labels.count()); i++) {
      if (wanted.has((await labels.nth(i).innerText()).trim()))
        await labels.nth(i).locator("input").check();
    }
    for (let i = 0; i < (await labels.count()); i++) {
      const row = labels.nth(i),
        check = row.locator("input");
      if (
        !wanted.has((await row.innerText()).trim()) &&
        (await check.isChecked())
      )
        await check.uncheck();
    }
    await page.getByRole("button", { name: "Done", exact: true }).tap();
    await page.getByRole("separator").focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    // Captions annotate this recording only, and are not part of the product.
    const caption = async (text) => {
      await page.evaluate((text) => {
        let e = document.getElementById("walkthrough-caption");
        if (!e) {
          e = document.createElement("div");
          e.id = "walkthrough-caption";
          Object.assign(e.style, {
            position: "fixed",
            top: "0px",
            left: "8px",
            right: "8px",
            zIndex: "9999",
            background: "#102932ee",
            color: "white",
            padding: "10px",
            borderRadius: "8px",
            font: "12px system-ui",
            pointerEvents: "none",
            textAlign: "center",
          });
          document.body.append(e);
        }
        e.textContent = text;
      }, text);
      await wait(1200);
    };
    await caption("Apex mobile • track and telemetry stay together");
    await wait(1000);
    await caption("Scrub: drag a trace to move the cars — no accidental zoom");
    await chartSwipe(page, "Scrub", 0.1, 0.75);
    await chartSwipe(page, "Scrub", 0.75, 0.35);
    await wait(700);
    await caption("Compare laps without scrolling back to the top");
    await page.getByRole("button", { name: "Choose lap B", exact: true }).tap();
    await wait(1300);
    await page
      .locator("dialog[open] .ma-lap-option")
      .filter({ hasNotText: "⚠" })
      .filter({ has: page.locator("b") })
      .filter({ hasText: /^Lap / })
      .first()
      .tap();
    await wait(700);
    await caption("Choose a numbered turn and inspect both laps");
    await page.getByLabel("Focus turn", { exact: true }).selectOption("T3");
    await wait(1000);
    await page.getByRole("button", { name: "Follow car", exact: true }).tap();
    await chartSwipe(page, "Scrub", 0.2, 0.8);
    await wait(800);
    await caption("Zoom is explicit. Pan moves the window at the same scale.");
    await chartSwipe(page, "Zoom", 0.25, 0.75);
    await wait(700);
    await chartSwipe(page, "Pan", 0.6, 0.3);
    await wait(700);
    await caption("Play both laps together, or scrub to any position");
    await page
      .getByRole("button", { name: "Play playback", exact: true })
      .tap();
    await wait(1700);
    await page
      .getByRole("button", { name: "Pause playback", exact: true })
      .tap();
    await caption("Layers and legends stay out of the way until needed");
    await page.getByRole("button", { name: "Layers", exact: true }).tap();
    await wait(1300);
    await page.getByRole("button", { name: "Layers", exact: true }).tap();
    await caption("Resize the map / telemetry split with the divider");
    const r = await page.getByRole("separator").boundingBox();
    await swipe(
      page,
      { x: r.x + r.width / 2, y: r.y + r.height / 2 },
      { x: r.x + r.width / 2, y: r.y - 55 },
    );
    await wait(1000);
    await caption("Channels and view preferences are remembered");
    await page.getByRole("button", { name: "Choose telemetry channels" }).tap();
    await wait(1600);
    await page.getByRole("button", { name: "Done", exact: true }).tap();
    await page.getByRole("button", { name: "Scrub", exact: true }).tap();
    await caption("Local preview • not deployed");
    await wait(1600);
    await page.evaluate(() =>
      document.getElementById("walkthrough-caption")?.remove(),
    );
    await snapshot(page, "phone-final");
    const video = page.video();
    await context.close();
    await copyFile(await video.path(), resolve(out, "mobile-walkthrough.webm"));
  }
  console.log(
    JSON.stringify({
      passed: true,
      viewports: report.length,
      output: out,
      video: !!process.env.APEX_RECORD_MOBILE,
    }),
  );
} catch (e) {
  for (const c of browser.contexts())
    for (const p of c.pages()) {
      await p.screenshot({ path: resolve(out, "failure.png") }).catch(() => {});
      await writeFile(
        resolve(out, "failure.txt"),
        await p.locator("body").innerText(),
      ).catch(() => {});
    }
  if (process.env.APEX_MOBILE_DEBUG)
    for (const c of browser.contexts())
      for (const p of c.pages())
        console.log(
          JSON.stringify(
            await p.evaluate(() => ({
              events: window.mobileEvents?.slice(-60),
              mode: document.querySelector(".mobile-analysis")?.dataset
                .interaction,
            })),
            null,
            2,
          ),
        );
  throw e;
} finally {
  await browser.close();
}
