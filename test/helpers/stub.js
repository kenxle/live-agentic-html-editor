// THE SWAP POINT.
//
// Everything in this file talks to the stub review layer in
// test/fixtures/assets/harness-stub.js. Nothing else in test/helpers/ knows the
// stub exists. When the real library lands, this is the file to rewrite, and the
// rewrite should be small: point each function at the real library's equivalent.
//
// The vocabulary is 0A-kernel's, not the harness's. Each function below names
// the module it stands in for:
//
//   editBlock(page, region)              GESTURE.EDIT_BLOCK (src/shared/gestures.js)
//     Cmd-Shift-E on the block under the cursor. Edit state is per block and
//     entered deliberately (D3), so there is no page-wide "make everything
//     editable" any more: a test names the block it means. The real library
//     enters this from the keystroke, so this becomes "press Cmd-Shift-E with
//     the caret in that block".
//
//   commitEdit(page, region)             GESTURE.COMMIT_EDIT
//     Esc, or a click outside. The real library commits on both, so a test can
//     just press Esc. This exists so a test can commit deterministically without
//     depending on focus order, and it should become a call to whatever the
//     library exposes for the same.
//
//   markReadyItem(page, region)          GESTURE.MARK_READY
//     Cmd-Enter on a comment box (R7: the reviewer decides when it is ready).
//     Separate from committing an edit because they are different gestures on
//     different surfaces, and only one of them lifts protection.
//
//   protectBlock / releaseBlock          protect.mark / protect.release (src/layer/protect.js)
//     Layers one and two on their own, without going through edit state, so a
//     protection test can exercise one layer at a time.
//
//   layerItems(page) / itemFor(page, region)   the store (src/layer/store.js)
//     Items in record shape (src/shared/record.js): id, rev, kind, state,
//     before, after, after_history, region, the page fields. Expect the real
//     store to be keyed by review id; the helpers do not read fields off an
//     item, only tests do.
//
//   configureStub(page, patch)
//     STUB ONLY, and it has no real-library equivalent by design. It switches
//     off the behaviors under test (each protection layer separately,
//     idempotence, the caret shield, commit-on-blur) so the harness self-tests
//     can watch the assertions fail. When the real library lands, the negative
//     self-tests either keep using a fixture page that loads the stub, or get
//     rewritten as the one-line deliberate revert the plan requires of every
//     builder. Do not delete the negative tests; an assertion nobody has watched
//     fail is theatre.
//
//   replayNow(page)
//     The real library schedules replay from a MutationObserver behind a write
//     epoch. Expose a synchronous test hook for it, or replace this with
//     "trigger a repaint and wait for the replayPasses counter".

"use strict";

async function stubCall(page, method, arg) {
  return page.evaluate(
    function (args) {
      const stub = window.__lahe && window.__lahe.stub;
      if (!stub) {
        throw new Error(
          "window.__lahe.stub is missing. Either this page does not load " +
            "/assets/harness-stub.js, or the real library has landed and " +
            "test/helpers/stub.js has not been rewritten yet. See the header of that file."
        );
      }
      if (typeof stub[args.method] !== "function") {
        throw new Error(
          "window.__lahe.stub." +
            args.method +
            " is not a function. The stub's surface is the kernel's vocabulary: " +
            Object.keys(stub).join(", ")
        );
      }
      return stub[args.method](args.arg);
    },
    { method: method, arg: arg }
  );
}

/**
 * Enter edit state on ONE block, the way Cmd-Shift-E does.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} region the data-region value
 * @returns {Promise<object>} the item, in record shape
 */
async function editBlock(page, region) {
  return stubCall(page, "editBlock", region);
}

/**
 * Commit the open edit, the way Esc or a click outside does. Protection lifts
 * and the item moves to ready.
 * @returns {Promise<object|null>} the item
 */
async function commitEdit(page, region) {
  return stubCall(page, "commitEdit", region);
}

/** Mark an item ready, the way Cmd-Enter on a comment box does. */
async function markReadyItem(page, region) {
  return stubCall(page, "markReady", region);
}

/** Open a comment on a passage, so a test has a non-edit item to work with. */
async function commentOn(page, region, note) {
  return page.evaluate(
    function (args) {
      return window.__lahe.stub.comment(args.region, args.note);
    },
    { region: region, note: note }
  );
}

/** protect.mark: layers one and two, without entering edit state. */
async function protectBlock(page, region) {
  return stubCall(page, "protect", region);
}

/** protect.release. */
async function releaseBlock(page, region) {
  return stubCall(page, "release", region);
}

/** protect.isProtected, for the block a test names. */
async function isBlockProtected(page, region) {
  return stubCall(page, "isProtected", region);
}

/**
 * STUB ONLY. Switch a behavior off so a negative test can watch an assertion
 * fail. See the header for what happens to this when the real library lands.
 * An unknown knob name throws rather than being ignored.
 *
 * @param {{cooperativeSkip?: boolean, veto?: boolean, snapshotRestore?: boolean,
 *          idempotent?: boolean, respectCaret?: boolean, commitOnBlur?: boolean}} patch
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

/** Every item the library is holding, in record shape. */
async function layerItems(page) {
  return stubCall(page, "items", undefined);
}

/** One region's item, or null. */
async function itemFor(page, region) {
  return stubCall(page, "item", region);
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
  editBlock,
  commitEdit,
  markReadyItem,
  commentOn,
  protectBlock,
  releaseBlock,
  isBlockProtected,
  configureStub,
  replayNow,
  replayTimes,
  layerItems,
  itemFor,
  regionText
};
