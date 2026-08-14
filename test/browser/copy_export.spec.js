// Ranked test 34: Copy and Export, read through the real controls.
//
// The plan's done bar for 3C, word for word:
//
//   "the same records export to byte-identical human-readable bytes with the
//    helper running and with it stopped, both non-empty, differing only in
//    scope and the slice label; the slice label is present in the no-helper
//    case and absent in the full case; and the test reads the export through
//    the real control (a Playwright clipboard permission grant for copy, a
//    download path for export) rather than by calling the formatter directly."
//
// So nothing in this file calls review_format.renderText, and nothing calls
// LAHE.exporter's own functions to produce the text under assertion. The text
// comes out of the operating system's clipboard and out of a downloaded file,
// both of them produced by real mouse clicks on the real controls in the rail's
// closed shadow root: the head's "More actions" button, then the item chosen out
// of the menu it opens. The only thing imported from the library is the slice
// label's wording, which is the string the test has to look FOR.
//
// R10 is what this protects: with nothing running there is still a way to take
// the work elsewhere. R11 is the other half: what comes out with nothing
// running is labeled as this page's slice, never passed off as the whole
// review.
//
// Everything under it is real, in the CP2 walk's sense:
//
//   REAL  the application: 0C's node app on its own origin, its own pages
//   REAL  the arrival: one script tag, src/layer/index.js booting itself
//   REAL  the helper and the token: 1A minted both
//   REAL  the records: made by the reviewer's own gestures through 1D and 2A,
//         on TWO pages of the application, so "the whole review" is a claim
//         about something with more than one page in it
//   REAL  the stop: kill -9, the way a laptop lid does it
//
// THE CLIPBOARD AND THE THREE LANES. A clipboard-read permission grant is a
// Chromium capability in Playwright; Firefox and WebKit have no equivalent
// grant, and asking for one throws. So the copy half runs on Chromium and the
// download half runs on all three, which means every lane still reads an export
// through a real control end to end. Said out loud here rather than left as a
// silently skipped assertion.

"use strict";

const fs = require("node:fs");

const { test, expect, pollPage, pollUntil, placeCaret, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

// The label's wording lives in the library. The test imports the constant
// rather than restating it, because a test that restates a sentence passes
// while the reviewer reads a different one.
const exporter = require("../../src/layer/export.js");

const REVIEW = "copy-export-review";
const EPHEMERAL_PORT = ["--port", "0"];

// The reviewer's own words, on two pages.
const SAID = {
  home: "Say which client to text first, and say it here.",
  comment: "This number needs a unit. Nine what?",
  clients: "The notes column is doing two jobs. Split it."
};

const REGION = {
  lede: "p.lede",
  fix: "section.focus p:nth-of-type(1)"
};

// --- the reviewer's gestures, all real ---------------------------------------

async function enterEdit(page, selector) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing(), undefined, {
    message: "Cmd-Shift-E to put the block under the caret into edit state"
  });
}

async function typeAtEnd(page, selector, text) {
  const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await placeCaret(page, { selector: selector, offset: length });
  await page.keyboard.type(text, { delay: 10 });
}

async function editAndCommit(page, selector, text) {
  await enterEdit(page, selector);
  await typeAtEnd(page, selector, text);
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
    message: "Esc to commit the edit and give the block back to the page"
  });
}

async function commentOnSelection(page, selector, text) {
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("nothing matched " + sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

// --- the real controls -------------------------------------------------------

/**
 * Choose one of the review's actions out of the rail's header menu.
 *
 * Copy and Export are not standing buttons any more: they live behind the head's
 * "More actions" button, beside the collapse arrow (D10, revised). The rail's
 * root is closed, so no selector from outside can reach either control; the rail
 * reports its own geometry and the test clicks a REAL mouse at it, which is the
 * whole of the path the reviewer's own click takes.
 */
async function chooseFromRailMenu(page, label) {
  const opened = await pollUntil(
    async () => {
      const info = await page.evaluate(() => window.__lahe.rail.menuInfo());
      if (!info.present) throw new Error("the rail is not mounted, so it has no menu");
      if (info.open) return info;
      const at = info.rect;
      await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
      return null;
    },
    { message: "the rail's header menu to open on a real click" }
  );
  const item = opened.items.filter((one) => one.label === label)[0];
  if (!item) {
    throw new Error(
      "no menu item labelled " + label + ". The menu holds: " + opened.items.map((one) => one.label).join(", ")
    );
  }
  await page.mouse.click(item.rect.x + item.rect.width / 2, item.rect.y + item.rect.height / 2);
  return true;
}

const SENTINEL = "clipboard has not been written yet";

/** Choose Copy review and read what actually landed on the system clipboard. */
async function copyThroughTheButton(page) {
  await page.evaluate((text) => navigator.clipboard.writeText(text), SENTINEL);
  await chooseFromRailMenu(page, "Copy review");
  return pollUntil(
    async () => {
      const got = await page.evaluate(() => navigator.clipboard.readText());
      return got && got !== SENTINEL ? got : null;
    },
    {
      message: "Copy review to put the review on the clipboard",
      describe: async () => ({ last: await page.evaluate(() => window.__lahe.exporter.last()) })
    }
  );
}

/** Choose Export review and read the file the browser actually downloaded. */
async function exportThroughTheButton(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    chooseFromRailMenu(page, "Export review")
  ]);
  const path = await download.path();
  return { text: fs.readFileSync(path, "utf8"), filename: download.suggestedFilename() };
}

test.describe("Copy and Export: the same review, with the helper and without it", () => {
  test("the same records export to the same bytes running and stopped, and only the stopped one carries the slice label", async ({
    page,
    browserName
  }) => {
    // Chromium is the only lane where Playwright can grant clipboard-read. The
    // download half runs everywhere, so no lane skips the whole test.
    const clipboardLane = browserName === "chromium";
    if (clipboardLane) {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    }

    const appServer = await startAppServer();
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [appServer.origin]
    });
    const token = helper.tokenFor(REVIEW);
    expect(token, "the helper minted a per-review token").toBeTruthy();

    try {
      appServer.useLayer({ review: REVIEW, token: token, helper: helper.url });

      // The real application, with its own morph engine loaded, but with the
      // timer stopped: this test is about what comes out of the rail, and a page
      // rewriting itself four times a second only adds noise to that. Records
      // surviving a morph is CP2's claim and it is tested there.
      await page.goto(appServer.urlFor("/?morph=hooked"));
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot from its script tag"
      });
      await page.evaluate(() => window.__app.morph.stop());

      // --- the reviewer's work, on two pages of one review -------------------

      await commentOnSelection(page, REGION.lede, SAID.comment);
      await editAndCommit(page, REGION.fix, " " + SAID.home);

      await page.goto(appServer.urlFor("/clients?morph=hooked"));
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot on the second page"
      });
      await commentOnSelection(page, "h1", SAID.clients);

      const ids = await page.evaluate(() => window.__lahe.items().map((item) => item.id));
      expect(ids, "three records: two comments and an edit, across two pages").toHaveLength(3);

      // The helper really is up and really has been talked to. Without this,
      // "the full export" could be the no-helper path passing under a name.
      await pollPage(page, () => window.__lahe.status() === "stored", undefined, {
        message: "the helper to acknowledge everything this browser holds"
      });
      expect(helper.alive()).toBe(true);

      // --- with the helper running ------------------------------------------

      const fullDownload = await exportThroughTheButton(page);
      const fullCopy = clipboardLane ? await copyThroughTheButton(page) : null;

      expect(fullDownload.text.length, "the export is not empty").toBeGreaterThan(0);
      expect(fullDownload.filename).toMatch(/\.txt$/);
      if (clipboardLane) {
        expect(
          Buffer.compare(Buffer.from(fullCopy, "utf8"), Buffer.from(fullDownload.text, "utf8")),
          "Copy and Export produce the same bytes"
        ).toBe(0);
      }

      // It really is the reviewer's review: their words, from both pages.
      expect(fullDownload.text).toContain(SAID.comment);
      expect(fullDownload.text).toContain(SAID.home);
      expect(fullDownload.text).toContain(SAID.clients);
      expect(fullDownload.text.match(/^Page: /gm), "both pages are in the whole review").toHaveLength(2);

      // And it is NOT labeled a slice, because the helper is right there.
      expect(fullDownload.text, "nothing claims this is only one page's slice").not.toContain(exporter.SLICE_LABEL);

      // --- nothing running ---------------------------------------------------
      //
      // kill -9, the way a laptop lid does it. The helper is gone before the
      // next click, and the next click still has to work.

      await helper.kill9();
      expect(helper.alive()).toBe(false);

      const sliceDownload = await exportThroughTheButton(page);
      const sliceCopy = clipboardLane ? await copyThroughTheButton(page) : null;

      expect(sliceDownload.text.length, "the export with nothing running is not empty either").toBeGreaterThan(0);
      if (clipboardLane) {
        expect(
          Buffer.compare(Buffer.from(sliceCopy, "utf8"), Buffer.from(sliceDownload.text, "utf8")),
          "Copy and Export still agree with nothing running"
        ).toBe(0);
      }

      // The slice label is there, and it is the ONLY difference. Byte for byte.
      expect(sliceDownload.text, "with nothing running the export says what it is").toContain(exporter.SLICE_LABEL);
      const withoutLabel = sliceDownload.text.slice((exporter.SLICE_LABEL + "\n\n").length);
      expect(
        Buffer.compare(Buffer.from(withoutLabel, "utf8"), Buffer.from(fullDownload.text, "utf8")),
        "the same records, the same bytes, differing only in the slice label"
      ).toBe(0);

      // The reviewer's work is all still in it. A labeled export that lost half
      // the review would satisfy the comparison above and fail the reviewer.
      expect(sliceDownload.text).toContain(SAID.comment);
      expect(sliceDownload.text).toContain(SAID.home);
      expect(sliceDownload.text).toContain(SAID.clients);

      // Nothing pretended to succeed and nothing failed silently: the rail's own
      // record of the last two actions says both wrote something.
      const last = await page.evaluate(() => window.__lahe.exporter.last());
      expect(last.ok, "the export reported its own result honestly").toBe(true);
      expect(last.scope).toBe("slice");
    } finally {
      await appServer.close();
      await helper.kill9();
    }
  });
});
