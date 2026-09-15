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
const epoch = require("../../src/shared/epoch.js");
const { nextTask } = require("../helpers/poll.js");

test("finding 9: a repaint that owed a pass during replay's own write actually gets that pass", async () => {
  // The seam is written and never consumed. During a tool write the observer
  // early-returns and only remembers that a pass is owed (noteExternalMutation).
  // If nothing takes that flag, a committed edit a genuine repaint reverted in
  // the same batch is never re-applied until some later unrelated mutation.
  const originalRaf = global.requestAnimationFrame;
  const originalCancel = global.cancelAnimationFrame;
  // A painting page: the deferred follow-up pass runs on the next microtask.
  global.requestAnimationFrame = function (fn) {
    Promise.resolve().then(fn);
    return 1;
  };
  global.cancelAnimationFrame = function () {};

  const ranReasons = [];
  try {
    replay.resetCounters();
    replay.configure({
      root: null,
      items: [],
      cards: null,
      document: null,
      hooks: {
        update_rail: function (ctx, summary) {
          ranReasons.push(summary.reason);
        }
      }
    });

    // The observer saw a repaint it could not attribute to the tool and only
    // remembered that a pass is owed. Nothing in src consumes this today.
    epoch.shared.noteExternalMutation();

    // A pass runs; its end must notice the owed flag and schedule the follow-up.
    replay.runPass(replay.REASON.BOOT);

    // Drain the microtask queue and the one task boundary the deferred pass
    // rides on. nextTask is the harness's sanctioned wait (see helpers/poll.js).
    await nextTask();

    assert.ok(
      ranReasons.indexOf(replay.REASON.MUTATION) !== -1,
      "the owed pass ran, as a MUTATION pass"
    );
    assert.equal(
      epoch.shared.takePendingExternal(),
      false,
      "and the owed flag was consumed, not left set forever"
    );
  } finally {
    replay.configure({ items: null, hooks: null });
    if (originalRaf === undefined) delete global.requestAnimationFrame;
    else global.requestAnimationFrame = originalRaf;
    if (originalCancel === undefined) delete global.cancelAnimationFrame;
    else global.cancelAnimationFrame = originalCancel;
  }
});

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

// The same seam, for an epoch that was NOT one of replay's.
//
// The observer is refused for whichever write epoch is open, and the library
// opens epochs from several places that are not a replay pass: entering and
// leaving an edit session, a format command, an undo, and protect's snapshot
// restore after a repaint. The consumer for the owed flag lived at the end of a
// replay pass, so a repaint colliding with one of those was remembered and then
// never run: the page kept what the repaint wrote and the reviewer's committed
// sentence stayed off it until an unrelated mutation scheduled the next pass.
//
// This stages exactly that: an edit session's epoch is open, the page repaints
// inside it, and no replay pass follows. A pass still has to run.
test("a repaint refused during someone else's write epoch still gets its pass", async () => {
  const originalRaf = global.requestAnimationFrame;
  const originalCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = function (fn) {
    Promise.resolve().then(fn);
    return 1;
  };
  global.cancelAnimationFrame = function () {};

  const ranReasons = [];
  try {
    replay.resetCounters();
    epoch.shared.takePendingExternal();
    replay.configure({
      root: null,
      items: [],
      cards: null,
      document: null,
      hooks: {
        update_rail: function (ctx, summary) {
          ranReasons.push(summary.reason);
        }
      }
    });

    // editing.enter, or a format command, or protect putting a snapshot back.
    // Nothing here is replay, and replay must not have to be the one that
    // notices.
    epoch.shared.write("editing.enter", function () {
      // The page repainted in the same batch. This is what the page observer
      // does: it asks for a pass and is told the tool is mid-write.
      assert.equal(
        replay.schedule(replay.REASON.MUTATION),
        false,
        "the observer is refused while the write epoch is open"
      );
    });

    await nextTask();

    assert.ok(
      ranReasons.indexOf(replay.REASON.MUTATION) !== -1,
      "the pass the repaint was owed ran once the epoch closed"
    );
    assert.equal(
      epoch.shared.takePendingExternal(),
      false,
      "and the owed flag was consumed, not left set forever"
    );
  } finally {
    replay.configure({ items: null, hooks: null });
    if (originalRaf === undefined) delete global.requestAnimationFrame;
    else global.requestAnimationFrame = originalRaf;
    if (originalCancel === undefined) delete global.cancelAnimationFrame;
    else global.cancelAnimationFrame = originalCancel;
  }
});
