// AC4, nothing is taken back. A 4A EVALUATOR PROBE, not a checked-in acceptance
// spec: ranked test 39 names AC1, AC2 and AC3 as the scripted walks, and this
// file exists so the evaluator drove AC4's five stressors themselves rather than
// citing five different specs that each drive one. It is on 4B's cleanup list.
//
// The criterion's three evaluator-observable measures, and only those three:
//
//   1. item count identical
//   2. every item's text byte-identical against the prepared strings
//   3. no item changed state
//
// The caret is deliberately NOT scored here: it is an automated artifact and it
// lives in ranked tests 1 and 2.
//
// The prepared strings are AC1's file, read off disk, because "byte-identical
// against the prepared strings" is a comparison against something held in the
// hand rather than against what the page happens to say.
//
// The five stressors, in one session, measured after each:
//
//   a. a browser reload
//   b. kill -9 of the helper (and a restart on the same port and state dir)
//   c. a suspended helper: SIGSTOP, a measure, SIGCONT
//   d. the page re-rendering the block being typed in
//   e. a navigation with an edit open
//   f. backgrounding, driven as a visibilitychange, which is the plan's stated
//      stand-in for browser suspension and is labelled as one rather than
//      relabelled as machine sleep

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  placeCaret,
  startService,
  SERVICE_ENTRY
} = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "ac4-nothing-taken-back";
const PREPARED_FILE = path.join(__dirname, "..", "fixtures", "ac1-prepared-strings.txt");

const FIX_TARGETS = ["p.lede", "section.focus p:nth-of-type(1)", "section.focus p:nth-of-type(2)"];

function readPrepared() {
  return fs
    .readFileSync(PREPARED_FILE, "utf8")
    .split("\n")
    .map((line) => /^STRING (\d+) \(([^)]+)\): (.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ kind: m[2].split(",")[0].trim(), text: m[3] }));
}

async function enterEdit(page, selector) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing(), undefined, {
    message: "Cmd-Shift-E on " + selector
  });
}

async function replaceSentence(page, selector, text) {
  await enterEdit(page, selector);
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
    message: "Esc to commit on " + selector
  });
  return page.evaluate((sel) => window.__lahe.itemForElement(sel), selector);
}

async function commentOnElement(page, selector, text) {
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => window.__lahe.pickMode() === true, undefined, { message: "element-pick mode" });
  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(12, box.height / 2));
  await pollPage(page, () => window.__lahe.pickMode() === false, undefined, { message: "the element to be picked" });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

async function untetheredNote(page, text) {
  await page.evaluate(() => window.__lahe.handle.tab().focusNote());
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/** The three measures, over the five prepared records only, by id. */
function measure(page, ids) {
  return page.evaluate(function (wanted) {
    // allItems: nothing being taken back is a claim about the REVIEW, and one of
    // the stressors is a navigation to another page, where the rail correctly
    // shows none of these (record.samePage). Scoping the measure to the page
    // would score the navigation stressor against a filter rather than against
    // durability.
    var found = window.__lahe.allItems().filter(function (item) {
      return wanted.indexOf(item.id) !== -1;
    });
    return {
      count: found.length,
      texts: found
        .map(function (item) {
          return item.kind === "edit" ? item.after : item.note;
        })
        .sort(),
      states: found
        .map(function (item) {
          return item.id + "=" + item.state;
        })
        .sort()
    };
  }, ids);
}

test.describe("AC4: nothing is taken back", () => {
  test("count, text and state hold across a reload, a kill -9, a suspend, a re-render, a navigation and a backgrounding", async ({
    page
  }) => {
    const prepared = readPrepared();
    const expectedTexts = prepared.map((p) => p.text).slice().sort();

    const app = await startAppServer();
    let helper = await startService({
      entry: SERVICE_ENTRY,
      args: ["--port", "0"],
      reviews: [REVIEW],
      allowedOrigins: [app.origin]
    });
    const port = helper.port;
    const stateDir = helper.stateDir;
    const token = helper.tokenFor(REVIEW);
    const results = [];

    try {
      app.useLayer({ review: REVIEW, token: token, helper: helper.url });
      await page.goto(app.urlFor("/?morph=hooked&poll=250"));
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot"
      });
      await page.evaluate(() => window.__app.morph.stop());

      // --- the five prepared records ------------------------------------------
      const fixes = prepared.filter((p) => p.kind === "fix");
      const comment = prepared.filter((p) => p.kind === "comment")[0];
      const note = prepared.filter((p) => /note$/.test(p.kind))[0];

      for (let i = 0; i < fixes.length; i += 1) {
        await replaceSentence(page, FIX_TARGETS[i], fixes[i].text);
      }
      await commentOnElement(page, "#log-session", comment.text);
      await untetheredNote(page, note.text);

      const ids = await page.evaluate(() => window.__lahe.items().map((i) => i.id));
      expect(ids, "five prepared records").toHaveLength(5);

      const baseline = await measure(page, ids);
      expect(baseline.count).toBe(5);
      expect(
        Buffer.compare(
          Buffer.from(baseline.texts.join("\n"), "utf8"),
          Buffer.from(expectedTexts.join("\n"), "utf8")
        ),
        "the five records are the prepared strings, byte for byte"
      ).toBe(0);
      results.push({ after: "the reviewer's own five records", measure: baseline });

      const check = async (label) => {
        const now = await measure(page, ids);
        expect(now.count, label + ": item count").toBe(baseline.count);
        expect(
          Buffer.compare(
            Buffer.from(now.texts.join("\n"), "utf8"),
            Buffer.from(expectedTexts.join("\n"), "utf8")
          ),
          label + ": every item byte-identical against the prepared strings"
        ).toBe(0);
        expect(now.states, label + ": no item changed state").toEqual(baseline.states);
        results.push({ after: label, measure: now });
      };

      // Everything has reached the helper before the stressors start, so a
      // stressor is not being scored against a backlog that never left.
      await pollPage(page, () => window.__lahe.status() === "stored", undefined, {
        message: "the helper to acknowledge everything the browser holds"
      });

      // --- a. a browser reload -------------------------------------------------
      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      await page.evaluate(() => window.__app.morph.stop());
      await check("a browser reload");

      // --- b. kill -9 ----------------------------------------------------------
      await helper.kill9();
      expect(helper.alive()).toBe(false);
      await check("a kill -9 of the helper");

      helper = await startService({
        entry: SERVICE_ENTRY,
        args: ["--port", String(port)],
        stateDir: stateDir,
        reviews: [REVIEW],
        allowedOrigins: [app.origin]
      });
      await check("the helper coming back");

      // --- c. a suspended helper ------------------------------------------------
      await helper.suspend();
      await check("a suspended helper (SIGSTOP)");
      await helper.resume();
      await check("the helper resumed (SIGCONT)");

      // --- d. the page re-rendering the block being typed in --------------------
      const region = "#feed-coach-note";
      await enterEdit(page, region);
      const base = await page.evaluate((sel) => document.querySelector(sel).textContent, region);
      await placeCaret(page, { selector: region, offset: base.length });
      await page.keyboard.type(" Typed while the page rewrites this block.", { delay: 10 });
      await page.evaluate(() => window.__app.morph.pollNow());
      await page.evaluate(() => window.__app.morph.pollNow());
      await check("the page re-rendering the block being typed in");
      await page.keyboard.press("Escape");
      await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
        message: "Esc to commit the sixth record, which is not one of the five"
      });
      await check("committing that sixth record");

      // --- e. a navigation with an edit open ------------------------------------
      await enterEdit(page, "h1");
      await page.keyboard.type(" for the quarter");
      await Promise.all([
        page.waitForURL(/\/clients/),
        page.locator("nav.app-nav a", { hasText: "Clients" }).click()
      ]);
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot on the second screen"
      });
      await check("a navigation with an edit open");

      // --- f. backgrounding -----------------------------------------------------
      await page.evaluate(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pagehide"));
      });
      await check("backgrounding the page (visibilitychange, the stated stand-in)");

      // And the helper's own file agrees at the end of all of it.
      const projected = await pollUntil(
        () => {
          const file = path.join(stateDir, "reviews", REVIEW, "review.json");
          if (!fs.existsSync(file)) return null;
          const got = JSON.parse(fs.readFileSync(file, "utf8"));
          const items = got.pages.reduce((out, p) => out.concat(p.items), []);
          const mine = items.filter((i) => ids.indexOf(i.id) !== -1);
          return mine.length === 5 ? mine : null;
        },
        { message: "all five prepared records to be in the file the agent reads at the end" }
      );
      const inFile = projected
        .map((item) => (item.kind === "edit" ? item.after_full : item.note))
        .slice()
        .sort();
      expect(
        Buffer.compare(
          Buffer.from(inFile.join("\n"), "utf8"),
          Buffer.from(expectedTexts.join("\n"), "utf8")
        ),
        "the helper's file holds the prepared strings unchanged after every stressor"
      ).toBe(0);

      // eslint-disable-next-line no-console
      console.log("AC4 MEASURES\n" + JSON.stringify(results, null, 2));
    } finally {
      if (helper.alive()) await helper.kill9();
      await app.close();
    }
  });
});
