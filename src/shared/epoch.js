// The write epoch: how replay's own mutations stop retriggering the observer
// that schedules replay.
//
// Owner: Task 0a (shared kernel). Imported by: replay (2B), the edit recorder
// (2A-i), the rail (1B-i), remount (2C).
//
// The problem. Replay writes a region. The MutationObserver watching the page
// sees that write and schedules another replay pass. That pass writes again (or
// at best compares and skips), which the observer sees, and the loop runs until
// something else stops it. On a page that also repaints on a timer, the two
// interleave and the reviewer's caret is inside it.
//
// The rule, in three parts. All three are needed; the first two alone lose
// mutations and the third alone is a race.
//
//   1. EVERY mutation the tool makes to the reviewed DOM happens inside
//      epoch.write(reason, fn). No exceptions, including a one-line
//      textContent assignment, including the rail attaching a highlight.
//
//   2. epoch.write increments a depth counter synchronously, runs fn, and then
//      schedules the decrement in a MICROTASK rather than decrementing
//      synchronously. This is the part that is easy to get wrong. A
//      MutationObserver's callback is a microtask queued at the moment of the
//      first mutation, which happens inside fn. A microtask queued after that
//      point therefore runs after the observer callback. So the observer sees
//      depth > 0 for exactly the batch containing the tool's own writes, and
//      not for anything after.
//
//   3. The observer callback calls isWriting() first and returns without
//      scheduling when it is true. It still records that something happened,
//      because a repaint from the page can land in the same batch as a tool
//      write, and dropping it silently is how a genuine repaint goes unnoticed.
//      shouldScheduleReplay() is the seam: Task 2B fills in the classification
//      of which records were the tool's and which were not.
//
// The counter also exposes a monotonic epoch number. Replay stamps the epoch it
// last ran at, so a pass that wakes with no new epoch and no external mutation
// can no-op without touching the DOM at all.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;

  function createEpoch(options) {
    var opts = options || {};
    // Injectable so tests can drive the deferral deterministically.
    var defer =
      opts.defer ||
      (typeof queueMicrotask === "function"
        ? queueMicrotask
        : function (fn) {
            Promise.resolve().then(fn);
          });

    var depth = 0;
    var current = 0;
    var pendingExternal = false;
    var reasons = [];

    function isWriting() {
      return depth > 0;
    }

    function epoch() {
      return current;
    }

    // Runs fn with the epoch open. Returns whatever fn returns. Rethrows after
    // closing the epoch: an exception inside a tool write must not leave the
    // depth pinned above zero forever, which would mute the observer for the
    // rest of the session.
    function write(reason, fn) {
      if (typeof reason !== "string" || !reason) {
        throw new TypeError("epoch.write: reason must be a non-empty string naming the caller");
      }
      if (typeof fn !== "function") {
        throw new TypeError("epoch.write: fn must be a function");
      }
      depth += 1;
      reasons.push(reason);
      var out;
      try {
        out = fn();
      } finally {
        current += 1;
        defer(close);
      }
      return out;
    }

    function close() {
      if (depth > 0) depth -= 1;
      if (depth === 0) reasons.length = 0;
    }

    // Called by the observer when it early-returns during a tool write but saw
    // records it could not attribute to the tool. Task 2B decides attribution;
    // this only remembers that a pass is owed.
    function noteExternalMutation() {
      pendingExternal = true;
    }

    function takePendingExternal() {
      var was = pendingExternal;
      pendingExternal = false;
      return was;
    }

    function currentReasons() {
      return reasons.slice();
    }

    return {
      write: write,
      isWriting: isWriting,
      epoch: epoch,
      noteExternalMutation: noteExternalMutation,
      takePendingExternal: takePendingExternal,
      currentReasons: currentReasons
    };
  }

  // One epoch per page. The layer imports this instance; nothing creates a
  // second one outside a test.
  var shared = createEpoch();

  var api = {
    createEpoch: createEpoch,
    shared: shared,
    write: function (reason, fn) {
      return shared.write(reason, fn);
    },
    isWriting: function () {
      return shared.isWriting();
    },
    epoch: function () {
      return shared.epoch();
    }
  };

  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.epoch = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
