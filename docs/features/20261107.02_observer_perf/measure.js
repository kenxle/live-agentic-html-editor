/*
 * read-when: Timing what hovering a live chart costs the review layer, before and after a change to the page observer or the replay pass.
 */

// Adapted from the Seneschal session's repro2.js (board row
// LAHE-mousemove-rereads-page-text). That script timed a real review of a copy
// of the knowledge tree page; this one is self-contained, so it runs from a
// clone: the fixture test/fixtures/live-chart.html (a long page plus an
// unnamed svg that redraws its hover layer on every mouse move), the layer
// built from this checkout's src/ in memory, and the real boot with sync held
// back, so no helper is started.
//
// It makes what the repro made: one element comment on the chart's svg and
// two committed edits. Then it hovers the chart 30 times, the way repro2 did,
// and reports:
//
//   - how many replay passes the hovers caused
//   - the time the CPU profiler saw inside runPass during the hovers
//   - the longest gaps between animation frames
//   - what one replay pass costs on this page, timed directly
//
// Usage: node docs/features/20261107.02_observer_perf/measure.js [sections] [depth] [bars]
// The defaults (300 sections, each 20 divs deep, a 600-bar drawing) make a
// page of about the size and depth of the knowledge tree page that hung.
// Prints one JSON line last, so a doc can quote it.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { startStaticServer } = require("../../../test/helpers/servers.js");
const manifest = require("../../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SECTIONS = Number(process.argv[2] || 300);
const DEPTH = Number(process.argv[3] || 20);
const BARS = Number(process.argv[4] || 600);
const HOVERS = 30;

function bundle() {
  return manifest
    .builtFiles()
    .map((entry) => "/* ---- " + entry.path + " ---- */\n" + fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8"))
    .join("\n");
}

async function poll(page, fn, arg, what, timeoutMs = 15000) {
  const started = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for " + what);
    await page.waitForTimeout(25);
  }
}

async function caretIn(page, selector, atEnd) {
  await page.evaluate(
    ({ sel, end }) => {
      const el = document.querySelector(sel);
      const text = el.firstChild;
      const range = document.createRange();
      range.setStart(text, end ? text.nodeValue.length : 0);
      range.collapse(true);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    },
    { sel: selector, end: atEnd }
  );
}

async function commitEdit(page, selector, suffix) {
  await caretIn(page, selector, false);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await poll(page, () => window.__lahe.editState().open === true, null, "edit state to open");
  await caretIn(page, selector, true);
  await page.keyboard.type(suffix, { delay: 5 });
  await page.keyboard.press("Escape");
  await poll(page, () => window.__lahe.isEditing() === false, null, "the edit to commit");
}

async function quiet(page) {
  // The page has settled when no pass has run for half a second and the
  // settling window after boot is closed.
  let last = -1;
  for (let i = 0; i < 200; i += 1) {
    const now = await page.evaluate(() => ({ passes: window.__lahe.counters.replayPasses, settling: window.LAHE.replay.isSettling() }));
    if (now.passes === last && !now.settling) return now.passes;
    last = now.passes;
    await page.waitForTimeout(500);
  }
  throw new Error("the page never went quiet");
}

function inclusiveMs(profile, functionName) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
  let total = 0;
  for (let k = 0; k < profile.samples.length; k += 1) {
    const d = profile.timeDeltas[k] || 0;
    for (let id = profile.samples[k]; id; id = parent.get(id)) {
      if (byId.get(id).callFrame.functionName === functionName) {
        total += d;
        break;
      }
    }
  }
  return Math.round(total / 1000);
}

(async () => {
  const server = await startStaticServer({ label: "live-chart-measure" });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(server.urlFor("live-chart.html") + "?sections=" + SECTIONS + "&depth=" + DEPTH + "&bars=" + BARS);
    await page.addScriptTag({ content: bundle() });
    await page.evaluate(() => {
      window.LAHE.layer.boot({ review: "rev_live_chart", token: "", helper: "http://127.0.0.1:1", startSync: false });
    });
    const elements = await page.evaluate(() => document.body.querySelectorAll("*").length);

    // One element comment on the svg, minted on the drawing as it loaded.
    await page.evaluate(() => {
      window.__chart.followMouse = false;
      window.getSelection().removeAllRanges();
    });
    const svg = page.locator("#chart-wrap svg");
    await svg.scrollIntoViewIfNeeded();
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    const box = await svg.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.type("measure: comment on the chart");
    await page.keyboard.press("ControlOrMeta+Enter");
    await poll(page, () => window.__lahe.items().length === 1, null, "the comment to be saved");

    // Two committed edits.
    await commitEdit(page, "#todo-1", " (measure edit 1)");
    await commitEdit(page, "#todo-2", " (measure edit 2)");
    const items = await page.evaluate(() =>
      window.__lahe.items().map((i) => ({ kind: i.kind, state: i.state, probe_kind: i.region && i.region.ref && i.region.ref.probe_kind }))
    );

    await page.mouse.move(5, 5);
    await page.evaluate(() => {
      window.__chart.clearHover();
      window.__chart.followMouse = true;
    });
    await quiet(page);

    // One pass, timed directly, five times.
    const passMs = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < 5; i += 1) {
        const t = performance.now();
        window.LAHE.replay.runPass("manual");
        out.push(performance.now() - t);
      }
      out.sort((a, b) => a - b);
      return out[2];
    });
    await quiet(page);

    // The hovers, as repro2 did them.
    await svg.scrollIntoViewIfNeeded();
    const hoverBox = await svg.boundingBox();
    await page.evaluate(() => {
      window.__f = [];
      const t = (ts) => {
        window.__f.push(ts);
        requestAnimationFrame(t);
      };
      requestAnimationFrame(t);
    });
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
    await cdp.send("Profiler.start");
    const before = await page.evaluate(() => ({ passes: window.__lahe.counters.replayPasses, redraws: window.__chart.redraws }));
    const t1 = Date.now();
    for (let i = 0; i < HOVERS; i += 1) {
      await page.mouse.move(hoverBox.x + 10 + ((i * 17) % (hoverBox.width - 20)), hoverBox.y + 10 + ((i * 31) % (hoverBox.height - 20)));
      await page.waitForTimeout(30);
    }
    const hoverMs = Date.now() - t1;
    const during = await page.evaluate(() => ({ passes: window.__lahe.counters.replayPasses, redraws: window.__chart.redraws }));
    const { profile } = await cdp.send("Profiler.stop");
    // The trailing pass, if any, after the hovering stops.
    await page.mouse.move(5, 5);
    const settled = await quiet(page);
    const frames = await page.evaluate(() => window.__f);
    const gaps = [];
    for (let k = 1; k < frames.length; k += 1) gaps.push(frames[k] - frames[k - 1]);
    gaps.sort((a, b) => b - a);

    const result = {
      sections: SECTIONS,
      depth: DEPTH,
      bars: BARS,
      elements: elements,
      items: items,
      one_pass_ms: Math.round(passMs * 10) / 10,
      hovers: HOVERS,
      hover_redraws: during.redraws - before.redraws,
      passes_during_hovers: during.passes - before.passes,
      passes_after_hovers: settled - during.passes,
      run_pass_ms_during_hovers: inclusiveMs(profile, "runPass"),
      hover_wall_ms: hoverMs,
      longest_frame_gaps_ms: gaps.slice(0, 5).map(Math.round),
      errors: errors.slice(0, 3)
    };
    console.log("page: " + elements + " elements, items " + JSON.stringify(items));
    console.log("one replay pass: " + result.one_pass_ms + " ms");
    console.log(
      HOVERS + " hovers (" + result.hover_redraws + " redraws): " + result.passes_during_hovers + " passes during, " +
        result.passes_after_hovers + " after; runPass " + result.run_pass_ms_during_hovers + " ms; wall " + hoverMs +
        " ms; longest frame gaps " + result.longest_frame_gaps_ms.join(",")
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
    await server.close();
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
