// A ONE-FILE STUB of 3C's pinned export API, so 3D's spec can exercise the
// Edits tab's list-export button before src/layer/export.js exists.
//
// REPLACED AT THE PHASE 3 STITCH. 3C is building the real module in its own
// clone right now with this API:
//
//   exportRecords(records, options) -> human-readable text via the frozen
//                                      review_format.renderText
//   copyReview()   the clipboard action
//   exportReview() the download action
//
// The stub implements exportRecords ONLY, and it implements it by calling the
// real frozen formatter, so the text the button produces here is the text the
// real module will produce. What it does not have is the clipboard grant and
// the download path, which are 3C's and are what 3C's own done-bar tests.
//
// It is installed as a Playwright init script, which runs BEFORE the bundle: the
// bundle's wrapper does `root.LAHE = root.LAHE || {}`, so a namespace seeded
// here survives the bundle loading on top of it.
//
// Owner: 3D, and on the Phase 4B cleanup batch (see 3d_builder_notes.md).

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const REVIEW_FORMAT = path.join(REPO_ROOT, "src", "shared", "review_format.js");
const RECORD = path.join(REPO_ROOT, "src", "shared", "record.js");
const NORMALIZE = path.join(REPO_ROOT, "src", "shared", "normalize.js");
const MARKERS = path.join(REPO_ROOT, "src", "shared", "markers.js");

// The stub's own body, evaluated in the page. It is a string because it runs in
// the browser and this file runs in Node.
const STUB = `(function () {
  window.LAHE = window.LAHE || {};
  var calls = [];
  window.__laheExportStub = {
    calls: function () { return calls.slice(); },
    lastText: function () { return calls.length ? calls[calls.length - 1].text : null; },
    lastRecords: function () {
      return calls.length ? calls[calls.length - 1].records : null;
    }
  };
  window.LAHE.export = {
    STUB: true,
    exportRecords: function (records, options) {
      var opts = options || {};
      var text = window.LAHE.review_format.renderText({
        id: opts.review || "review-stub",
        items: records
      });
      calls.push({
        text: text,
        options: opts,
        records: (records || []).map(function (r) {
          return { id: r.id, kind: r.kind, before: r.before, after: r.after };
        })
      });
      return text;
    },
    copyReview: function () {
      throw new Error("export stub: copyReview is 3C's, and 3D does not call it");
    },
    exportReview: function () {
      throw new Error("export stub: exportReview is 3C's, and 3D does not call it");
    }
  };
})();`;

/**
 * Put the stub on the page before the bundle loads.
 *
 * The four shared modules the formatter needs are loaded first, in their own
 * dependency order, because the stub calls the REAL frozen formatter rather
 * than inventing a second one.
 *
 * @param {import('@playwright/test').Page} page
 */
async function installExportStub(page) {
  for (const file of [MARKERS, NORMALIZE, RECORD, REVIEW_FORMAT]) {
    await page.addInitScript({ content: fs.readFileSync(file, "utf8") });
  }
  await page.addInitScript({ content: STUB });
}

module.exports = { installExportStub };
