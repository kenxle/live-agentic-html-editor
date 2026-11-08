/*
read-when: Changing which page mutations schedule a replay pass, or when hovering a live chart makes a reviewed page slow.
*/

// A live chart on a reviewed page (board row LAHE-mousemove-rereads-page-text).
//
// Plotly rewrites its svg on every hover. The page observer used to schedule a
// whole replay pass for each rewrite, and with one element comment on the
// chart and two committed edits on a long page, the browser hung while the
// reviewer moved the mouse. The fixture, test/fixtures/live-chart.html, is
// that shape: a long page and an unnamed svg that throws away and redraws its
// hover layer on every mouse move.
//
// What this file pins, on the real boot (rail and all, sync held back):
//
//   - thirty redraws inside the svg do not run thirty passes; one quiet pass
//     follows once the svg stops changing
//   - a real text change outside the svg still runs a pass straight away, in
//     the middle of a redraw burst, and replay writes the committed edit back
//   - a comment on the svg that went lost while a hover label was drawn is
//     found again once the svg settles, so held mutations are not dropped
//
// Every wait is a counter or a condition. Nothing asserts a wall-clock time:
// the first test counts passes, and the second asks whether the edit came back
// before the redraw burst ended.

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { test, expect, pollPage, readCounter, waitForCounter } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const REVIEW = "rev_live_chart";
// Deep and long enough that a pass has real work in it, small enough to boot
// fast. The measured page (measure.js in the feature folder) is larger.
const FIXTURE = "live-chart.html?sections=40&depth=8";

// The bundle from source, in the manifest's order. Builders never commit dist/,
// so reading dist/ here would test whoever last ran the build script.
const BUNDLE = manifest
  .builtFiles()
  .map(function (entry) {
    return "/* ---- " + entry.path + " ---- */\n" + fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8");
  })
  .join("\n");

async function bootLayer(page) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(function (review) {
    window.LAHE.layer.boot({ review: review, token: "", helper: "http://127.0.0.1:1", startSync: false });
  }, REVIEW);
}

function caretIn(page, selector, atEnd) {
  return page.evaluate(
    function (args) {
      var el = document.querySelector(args.sel);
      var node = el.firstChild;
      var range = document.createRange();
      range.setStart(node, args.end ? node.nodeValue.length : 0);
      range.collapse(true);
      var s = window.getSelection();
      s.removeAllRanges();
      s.addRange(range);
    },
    { sel: selector, end: atEnd }
  );
}

async function commitEdit(page, selector, suffix) {
  await caretIn(page, selector, false);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, {
    message: "Cmd-Shift-E to put " + selector + " into edit state"
  });
  await caretIn(page, selector, true);
  await page.keyboard.type(suffix, { delay: 5 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "Esc to commit the edit" });
}

// An element comment on the svg, minted on the drawing as it loaded: the mouse
// does not draw the hover layer while the reviewer picks.
async function commentOnChart(page) {
  await page.evaluate(function () {
    window.__chart.followMouse = false;
    window.getSelection().removeAllRanges();
  });
  const svg = page.locator("#chart-wrap svg");
  await svg.scrollIntoViewIfNeeded();
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.type("This chart needs a y-axis label");
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(page, () => window.__lahe.items().some((i) => i.kind === "comment"), undefined, {
    message: "the comment on the chart to be saved"
  });
  await page.mouse.move(2, 2);
}

function chartComment(page) {
  return page.evaluate(function () {
    var item = window.__lahe.items().filter((i) => i.kind === "comment")[0];
    return item ? { probe_kind: item.region.ref.probe_kind, lost: item.region.lost } : null;
  });
}

test.describe("a live chart on a reviewed page", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "live-chart" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);
    await commentOnChart(page);
    await commitEdit(page, "#todo-1", " (edit one)");
    await commitEdit(page, "#todo-2", " (edit two)");
    const items = await page.evaluate(() => window.__lahe.items().map((i) => i.kind + ":" + i.state));
    expect(items.sort()).toEqual(["comment:ready", "edit:ready", "edit:ready"]);
    expect((await chartComment(page)).probe_kind).toBe("element");
    // The boot's settling window closed, so nothing below is a deferred verdict.
    await pollPage(page, () => window.LAHE.replay.isSettling() === false, undefined, {
      message: "the settling window after boot to close",
      timeoutMs: 10000
    });
  });

  test("thirty redraws inside the commented svg do not run thirty replay passes", async ({ page }) => {
    const counts = await page.evaluate(async function () {
      var before = window.__lahe.counters.replayPasses;
      var redraws = await window.__chart.redrawFrames(30);
      // Read in the same turn the last redraw finished in, so the quiet pass
      // that follows cannot have run yet.
      return { before: before, after: window.__lahe.counters.replayPasses, redraws: redraws };
    });
    expect(counts.redraws).toBeGreaterThanOrEqual(30);
    // Before the gate this was one pass per redraw. Two allows for a pass the
    // edits above had already scheduled and for the maximum wait on a slow
    // machine; neither is one per redraw.
    expect(counts.after - counts.before).toBeLessThanOrEqual(2);

    // One quiet pass follows once the svg stops changing.
    await waitForCounter(page, "replayPasses", counts.after + 1);
  });

  test("a real text change outside the svg runs a pass at once, in the middle of a redraw burst", async ({ page }) => {
    const writtenBefore = await readCounter(page, "regionsWritten");
    const result = await page.evaluate(async function () {
      var chart = window.__chart;
      var el = document.getElementById("todo-1");
      var revertedAt = -1;
      var backAt = -1;
      var watch = new MutationObserver(function () {
        if (revertedAt >= 0 && backAt < 0 && el.textContent.indexOf("(edit one)") !== -1) backAt = chart.redraws;
      });
      watch.observe(el, { childList: true, characterData: true, subtree: true });
      var burst = chart.redrawFrames(60);
      // A few frames in, the page's own re-render puts the paragraph back to
      // what its source says, which is what a framework does to an edit.
      await new Promise(function (resolve) {
        function wait() {
          if (chart.redraws >= 5) resolve();
          else requestAnimationFrame(wait);
        }
        requestAnimationFrame(wait);
      });
      chart.revertItem("todo-1");
      revertedAt = chart.redraws;
      var total = await burst;
      watch.disconnect();
      return { revertedAt: revertedAt, backAt: backAt, total: total, text: el.textContent };
    });
    // Replay wrote the edit back while the svg was still redrawing, not after
    // a quiet window: a held pass would only have come after the last redraw.
    expect(result.backAt).toBeGreaterThanOrEqual(result.revertedAt);
    expect(result.backAt).toBeLessThan(result.total);
    expect(result.text).toContain("(edit one)");
    expect(await readCounter(page, "regionsWritten")).toBeGreaterThan(writtenBefore);
  });

  test("a comment on the svg that went lost under a hover label is found again once the svg settles", async ({ page }) => {
    // The same review, reloaded with a hover label drawn at load and left
    // there, so the drawing no longer matches the one the comment was minted
    // on and nothing holds the old element.
    await page.goto(server.urlFor(FIXTURE + "&hover=stuck"));
    await bootLayer(page);
    await pollPage(
      page,
      function () {
        var item = window.__lahe.items().filter((i) => i.kind === "comment")[0];
        return !!item && !!item.region.lost;
      },
      undefined,
      { message: "the settle recheck to report the chart comment lost", timeoutMs: 10000 }
    );
    expect(await page.locator("#todo-1").textContent()).toContain("(edit one)");

    // Replay's own counter: the boot handle does not publish this one.
    const lostCleared = () => page.evaluate(() => window.LAHE.replay.counters.regionsLostCleared);
    const clearedBefore = await lostCleared();
    // The hover label goes: a change inside the svg only, which puts the
    // drawing back to the one the comment was minted on.
    await page.evaluate(() => window.__chart.clearHover());
    await pollPage(
      page,
      function () {
        var item = window.__lahe.items().filter((i) => i.kind === "comment")[0];
        return !!item && !item.region.lost;
      },
      undefined,
      { message: "a pass after the svg settled to find the chart comment again" }
    );
    expect(await lostCleared()).toBeGreaterThan(clearedBefore);
  });
});
