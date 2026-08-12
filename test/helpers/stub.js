// THE SWAP POINT.
//
// Everything in this file talks to the stub review layer in
// test/fixtures/assets/harness-stub.js. Nothing else in test/helpers/ knows the
// stub exists. When the real layer lands, this is the file to rewrite, and the
// rewrite should be small: point each function at the real layer's equivalent.
//
// What each function needs from the real layer:
//
//   enableEditing(page, selector)
//     The real layer decides for itself which regions are editable, so this
//     probably becomes "turn the editing toggle on" (D13) or disappears
//     entirely once the layer marks regions on load. Until then it is how a test
//     says "this paragraph is a region and it can be typed into".
//
//   commitRegion(page, region)
//     The real layer commits on blur (D3). A test can just blur. This exists so
//     a test can commit deterministically without depending on focus order, and
//     it should become a call to whatever the layer exposes for the same, or a
//     blur plus a wait on a counter.
//
//   configureStub(page, patch)
//     STUB ONLY, and it has no real-layer equivalent by design. It switches off
//     the behaviors under test (protection, idempotence, the caret shield) so
//     the harness self-tests can watch the assertions fail. When the real layer
//     lands, the negative self-tests either keep using a fixture page that loads
//     the stub, or get rewritten as one-line deliberate reverts in the layer, as
//     the plan requires of every builder. Do not delete the negative tests; an
//     assertion nobody has watched fail is theatre.
//
//   replayNow(page)
//     The real layer schedules replay from a MutationObserver behind a write
//     epoch. Expose a synchronous test hook for it, or replace this with
//     "trigger a repaint and wait for the replayPasses counter".
//
//   layerRecords(page)
//     The real layer's item store. Expect a different shape; the helpers do not
//     read fields off it, only tests do.

"use strict";

async function stubCall(page, method, arg) {
  return page.evaluate(
    function (args) {
      const stub = window.__lahe && window.__lahe.stub;
      if (!stub) {
        throw new Error(
          "window.__lahe.stub is missing. Either this page does not load " +
            "/assets/harness-stub.js, or the real layer has landed and " +
            "test/helpers/stub.js has not been rewritten yet. See the header of that file."
        );
      }
      return stub[args.method](args.arg);
    },
    { method: method, arg: arg }
  );
}

/**
 * Make a region editable and wire up its record capture.
 * @param {import('@playwright/test').Page} page
 * @param {string} [region] the data-region value. Omit for every region.
 * @returns {Promise<string[]>} the regions now editable
 */
async function enableEditing(page, region) {
  return stubCall(page, "enableEditing", region);
}

/**
 * Commit the region's edit to a record, the way blur does.
 * @returns {Promise<object|null>} the record
 */
async function commitRegion(page, region) {
  return stubCall(page, "commit", region);
}

/**
 * STUB ONLY. Switch a behavior off so a negative test can watch an assertion
 * fail. See the header for what happens to this when the real layer lands.
 * @param {{protectOnEdit?: boolean, idempotent?: boolean, respectCaret?: boolean}} patch
 */
async function configureStub(page, patch) {
  return stubCall(page, "configure", patch);
}

/** Run one replay pass synchronously and return the new pass number. */
async function replayNow(page) {
  return page.evaluate(function () {
    if (!window.__lahe || typeof window.__lahe.replayNow !== "function") {
      throw new Error("window.__lahe.replayNow is missing. See test/helpers/stub.js.");
    }
    return window.__lahe.replayNow();
  });
}

/** Run N replay passes with nothing else happening in between. */
async function replayTimes(page, times) {
  const passes = [];
  for (let i = 0; i < times; i += 1) {
    passes.push(await replayNow(page));
  }
  return passes;
}

/** The layer's records, for a test that wants to assert on them. */
async function layerRecords(page) {
  return stubCall(page, "records", undefined);
}

/**
 * A region's plain text, straight off the DOM. Not normalized: the caret
 * assertion needs the exact string, and normalizing here would hide the failure
 * where a repaint collapsed the reviewer's spacing.
 */
async function regionText(page, selector) {
  return page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("regionText: no element matches " + sel);
    return el.textContent;
  }, selector);
}

module.exports = {
  enableEditing,
  commitRegion,
  configureStub,
  replayNow,
  replayTimes,
  layerRecords,
  regionText
};
