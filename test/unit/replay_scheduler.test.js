// Replay's scheduler: a deferred pass must not depend on the page painting.
//
// Owner: CP2-mid. 2B found this the hard way and wrote it up as an open
// question: replay.schedule defers through requestAnimationFrame, and a browser
// that is not painting the page throttles rAF to nothing, so the pass simply
// never runs. On a backgrounded tab that means a committed edit is never
// re-applied and a folded reply is never shown; in the harness it meant a
// counter wait hanging for thirty seconds on a page where the library was
// working perfectly.
//
// The answer is in replay's own scheduler: the frame is raced against a timer,
// and whichever arrives first runs the pass and cancels the other. This test is
// the frame never arriving, which is the case no browser test can stage
// reliably: it installs a requestAnimationFrame that accepts the callback and
// never calls it.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const replay = require("../../src/layer/replay.js");

test("a deferred pass still runs when the frame never comes", async () => {
  const originalRaf = global.requestAnimationFrame;
  const originalCancel = global.cancelAnimationFrame;

  // A page that is not painting. The callback is accepted and dropped, which is
  // exactly what a throttled rAF does.
  global.requestAnimationFrame = function () {
    return 1;
  };
  global.cancelAnimationFrame = function () {};

  let resolveRan = null;
  const ran = new Promise(function (resolve) {
    resolveRan = resolve;
  });

  const passesBefore = replay.counters.passes;

  try {
    replay.configure({
      root: null,
      items: [],
      cards: null,
      document: null,
      hooks: {
        // Any step replay does not own is a fine witness: it runs once per pass
        // and the pass counter is asserted alongside it.
        update_rail: function (ctx, summary) {
          resolveRan(summary.reason);
        }
      }
    });

    const scheduled = replay.schedule(replay.REASON.MUTATION);
    assert.equal(scheduled, true, "the pass was accepted");

    const reason = await ran;
    assert.equal(reason, replay.REASON.MUTATION, "the pass that ran is the one that was scheduled");
    assert.equal(replay.counters.passes, passesBefore + 1, "exactly one pass ran, not two");
  } finally {
    replay.configure({ items: null, hooks: null });
    if (originalRaf === undefined) delete global.requestAnimationFrame;
    else global.requestAnimationFrame = originalRaf;
    if (originalCancel === undefined) delete global.cancelAnimationFrame;
    else global.cancelAnimationFrame = originalCancel;
  }
});

test("the frame wins when there is one, and the pass still runs exactly once", async () => {
  const originalRaf = global.requestAnimationFrame;
  const originalCancel = global.cancelAnimationFrame;

  let cancelled = 0;
  global.requestAnimationFrame = function (fn) {
    // A painting page: the frame arrives on the next turn of the loop, long
    // before the fallback timer.
    Promise.resolve().then(fn);
    return 7;
  };
  global.cancelAnimationFrame = function () {
    cancelled += 1;
  };

  let resolveRan = null;
  const ran = new Promise(function (resolve) {
    resolveRan = resolve;
  });
  const passesBefore = replay.counters.passes;

  try {
    replay.configure({
      root: null,
      items: [],
      cards: null,
      document: null,
      hooks: {
        update_rail: function () {
          resolveRan(true);
        }
      }
    });

    replay.schedule(replay.REASON.REMOUNT);
    await ran;
    assert.equal(replay.counters.passes, passesBefore + 1, "one pass, not one per timer");
    assert.equal(cancelled, 1, "the losing frame was cancelled rather than left to fire");
  } finally {
    replay.configure({ items: null, hooks: null });
    if (originalRaf === undefined) delete global.requestAnimationFrame;
    else global.requestAnimationFrame = originalRaf;
    if (originalCancel === undefined) delete global.cancelAnimationFrame;
    else global.cancelAnimationFrame = originalCancel;
  }
});
