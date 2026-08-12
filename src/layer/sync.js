// The sync client.
//
// Owner: Task 1B-ii. STUB: real signatures, real classification of a failure,
// no network yet.
//
// The one thing this file must get right and the tool being replaced does not:
// A CSP REFUSAL LOOKS IDENTICAL TO THE SERVICE BEING DOWN. Both surface as a
// rejected fetch with an opaque error. The design calls service-down harmless
// and calls a CSP refusal a thing the reviewer has to fix, so telling them
// apart is not a nicety. classify() below is where that happens, and 1B-ii
// fills in the detection (a SecurityPolicyViolation event on the document
// naming connect-src, versus a plain network error), not the policy.
//
// Retries forever, never blocks. Send is never gated on this succeeding: the
// browser copy is the other durable store and Copy and Export work with nothing
// running.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.sync = factory(root.LAHE.protocol, root.LAHE.failures);
  } else {
    module.exports = factory(require("../shared/protocol.js"), require("../shared/failures.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (protocol, failures) {
  "use strict";

  var STATE = {
    IDLE: "idle",
    IN_FLIGHT: "in_flight",
    RETRYING: "retrying",
    REFUSED: "refused" // policy refusal or a second 401. Stops retrying
  };

  // Backoff for the service being down. Capped, and it never gives up, because
  // the promise is that a stopped service costs nothing and sync drains when it
  // returns.
  var BACKOFF_MS = [250, 500, 1000, 2000, 5000, 10000, 30000];

  function createSync() {
    var state = STATE.IDLE;
    var queue = [];
    var session = null;
    var remintAttempts = 0;

    // Queues events. Never blocks and never throws on a transport problem: the
    // caller already wrote to browser storage before calling here.
    function enqueue(events) {
      if (!Array.isArray(events)) throw new TypeError("sync.enqueue expects an array of events");
      queue = queue.concat(events);
      return queue.length;
    }

    // STUB: 1B-ii implements the POST. Flushes everything queued, in order,
    // idempotent by event id so a re-send after a failure cannot double-count.
    function flush() {
      return Promise.resolve({ sent: 0, remaining: queue.length, isStub: true });
    }

    // D7: send flushes anything in flight FIRST, so the sentence typed a moment
    // before pressing send is in the batch (R5).
    function send() {
      return flush().then(function () {
        return { send_id: null, isStub: true };
      });
    }

    // The session exchange (D9). STUB: 1B-ii implements it against
    // protocol.route("session.mint").
    function mintSession() {
      remintAttempts += 1;
      return Promise.resolve({ session: null, isStub: true });
    }

    // What the layer does on a 401 mid-session, from protocol.SESSION.ON_401:
    // re-mint once, and a second refusal becomes a persistent failure rather
    // than a silent retry loop.
    function onUnauthorized() {
      if (remintAttempts < protocol.SESSION.ON_401.remint_attempts) {
        return mintSession();
      }
      state = STATE.REFUSED;
      return Promise.resolve({ failure: failures.failure("SYNC_UNAUTHORIZED", null), stopped: true });
    }

    // Turns a transport error into one of the two states the rail knows how to
    // report. STUB for the detection, real for the policy: anything the caller
    // flags as a policy violation is a policy refusal, everything else is the
    // service being down.
    function classify(error, hints) {
      var h = hints || {};
      if (h.cspViolation === true) return failures.failure("SYNC_POLICY_REFUSED", h.detail || null);
      if (h.status === 401 || h.status === 403) {
        return failures.failure(h.status === 403 ? "SYNC_ORIGIN_NOT_ALLOWED" : "SYNC_UNAUTHORIZED", h.detail || null);
      }
      return failures.failure("SYNC_SERVICE_DOWN", (error && error.message) || null);
    }

    function status() {
      return { state: state, queued: queue.length, session: session, remintAttempts: remintAttempts };
    }

    return {
      STATE: STATE,
      BACKOFF_MS: BACKOFF_MS,
      enqueue: enqueue,
      flush: flush,
      send: send,
      mintSession: mintSession,
      onUnauthorized: onUnauthorized,
      classify: classify,
      status: status
    };
  }

  return { STATE: STATE, BACKOFF_MS: BACKOFF_MS, createSync: createSync, shared: createSync(), isStub: true };
});
