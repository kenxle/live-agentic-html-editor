// The sync client, and the reply poll loop.
//
// Owner: 1B. 3A (agent loop) reads replies through this file rather than
// editing it, which is why the poll loop is built here in Phase 1 against
// protocol.js's reply shapes.
//
// Five promises, and each one is a line of code below rather than a paragraph:
//
//  1. POST PER EVENT, on protocol.js's flush policy: browser storage every
//     keystroke (store.js's job), the helper debounced at 750ms of typing idle,
//     and immediately on blur, ready, navigation and unload.
//  2. RE-POST ANYTHING UNACKNOWLEDGED, on reconnect and on the next load. The
//     queue is in browser storage, not in a JS array, so a reload and a kill -9
//     lose nothing.
//  3. RETRY FOREVER, capped backoff, never give up. A stopped helper costs the
//     reviewer nothing and the backlog drains when it returns.
//  4. NEVER BLOCK THE REVIEWER. Nothing here is awaited on the typing path, and
//     every request carries a deadline: A SUSPENDED HELPER ACCEPTS THE SOCKET
//     AND NEVER ANSWERS, which a client written only against a dead helper
//     hangs on forever.
//  5. TELL A CSP REFUSAL FROM A HELPER THAT IS DOWN. Both surface as a rejected
//     fetch with a deliberately opaque error, and they need opposite fixes:
//     one is "start the helper", the other is "this page's policy refuses the
//     connection". The detection is a real SecurityPolicyViolation event on the
//     document naming connect-src, not a guess from the error text.
//  6. TELL AN UNREGISTERED ORIGIN FROM A HELPER THAT IS DOWN, for the same
//     reason: a refused preflight and a dead helper both surface as a plain
//     network error, and one of them is fixed by `lahe add --origin`. After a
//     network-level failure the client asks health (unauthenticated, so no
//     preflight); if health answers, the helper is up and the origin is the
//     problem, and the chip says so with this page's origin in it.
//
// THE SECOND WINDOW, and the case nothing can cover. Shared storage is refused
// by store.js's Web Lock, which works with the helper down. Separate storage
// can only be refused by the helper's session. Separate storage AND no helper
// is refused by nothing, and that is said on the status line as a named limit
// (D5) rather than quietly claimed as covered.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.sync = factory(root.LAHE.protocol, root.LAHE.failures, root.LAHE.record, root.LAHE.overlay);
  } else {
    module.exports = factory(
      require("../shared/protocol.js"),
      require("../shared/failures.js"),
      require("../shared/record.js"),
      require("./overlay.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (protocol, failures, record, overlay) {
  "use strict";

  var STATE = {
    IDLE: "idle",
    IN_FLIGHT: "in_flight",
    RETRYING: "retrying",
    REFUSED: "refused" // a policy refusal. Stops posting; the queue is kept
  };

  // Backoff for the helper being down. Capped, and it never gives up, because
  // the promise is that a stopped helper costs nothing and sync drains when it
  // returns.
  var BACKOFF_MS = [250, 500, 1000, 2000, 5000, 10000, 30000];

  // Every request carries this deadline. It is the difference between a dead
  // helper and a suspended one: a dead helper refuses the connection at once, a
  // suspended one accepts it and answers nothing, and only a deadline turns the
  // second into a status line the reviewer can read.
  var REQUEST_TIMEOUT_MS = 2000;

  // The library's own poll of the helper. Deliberately NOT protocol.REPLY_POLL
  // .INTERVAL_MS: that 250ms is the helper watching reply FILES on local disk,
  // and reusing it here would mean four HTTP requests a second from every open
  // page for no gain. The cursor is protocol.REPLY_CURSOR_FIELD, a seq, never a
  // timestamp.
  var POLL_INTERVAL_MS = 1000;

  // -------------------------------------------------------------------------
  // R36: the page updates itself as the agent lands changes
  // -------------------------------------------------------------------------
  //
  // D7 grounded R36 but assumed the serving environment supplies the refresh: a
  // dev server hot-reloads and the agent's landed change arrives as a repaint.
  // A built static page behind a plain http server refreshes nothing, ever, so
  // for the commonest case R36 was unmet and the reviewer had to be told to
  // press reload. The reply poll already runs every second and now carries the
  // reviewed file's mtime, so the trigger is free: a DIFFERENT non-null value
  // from the one this page last saw means the file was rebuilt under it.
  //
  // This does not fight a framework that hot-reloads on its own. The comparison
  // is against the mtime this page last SAW, so a page its own dev server
  // already repainted still holds the old value here and gets exactly one
  // reload, and after any reload the fresh page starts from the current mtime
  // and is quiet again. Reloading a page that repainted itself costs the
  // reviewer nothing anyway: the replay pass is what makes a reload safe.
  //
  // Two waits, both here rather than at the call sites:
  //
  //  1. DEBOUNCE. A rebuild writes the file more than once, so a change starts a
  //     timer rather than a reload, and further changes inside the window just
  //     update the target. One rebuild is one reload.
  //  2. NEVER MID-WORK. An open edit session or a comment being typed defers the
  //     reload (isBusy), and it fires on the first poll after they are done. A
  //     page that swaps under a half-typed sentence is the one failure this
  //     feature could introduce.
  var RELOAD_DEBOUNCE_MS = 1500;

  // The pause between saying "Page updated. Reloading..." and doing it, so the
  // sentence is on screen before the page goes away.
  var RELOAD_NOTICE_MS = 250;

  /**
   * Which failure a refused or failed request really is.
   *
   * Pure, and separate from the client, so the decision can be tested without a
   * browser: it is the difference between a chip that says "start the helper"
   * and one that says "register this origin", and getting it wrong sends a
   * reviewer after the wrong fix for the whole session.
   *
   * @param {{cspRefused?: boolean, status?: number, healthAnswered?: boolean}} facts
   *   `healthAnswered` is the second question the client asks after a
   *   network-level failure: the helper's health route is unauthenticated and
   *   unpreflighted, so an origin no review registered can still reach it. True
   *   means the helper is up and the origin is what is being refused.
   * @returns {string} a failure code from src/shared/failures.js
   */
  function decideFailureCode(facts) {
    var f = facts || {};
    if (f.cspRefused) return "CSP_REFUSED";
    if (f.status === 401) return "SYNC_UNAUTHORIZED";
    if (f.status === 403) return "SYNC_ORIGIN_NOT_ALLOWED";
    if (f.healthAnswered === true) return "SYNC_ORIGIN_NOT_ALLOWED";
    return "HELPER_UNREACHABLE";
  }

  function createSync(options) {
    var opts = options || {};
    var review = opts.review || null;
    var token = opts.token || "";
    var helperOrigin = opts.helperOrigin || protocol.DEFAULT_HELPER_ORIGIN;
    var store = opts.store || null;
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    var fetchImpl = opts.fetch || (typeof fetch === "function" ? fetch.bind(typeof globalThis !== "undefined" ? globalThis : null) : null);
    var onStatus = opts.onStatus || function () {};
    var onFailure = opts.onFailure || function () {};
    // The mirror of onFailure: a standing failure whose condition ENDED. The
    // rail clears that chip (clear, not dismiss, so the next real failure still
    // gets one). Raised with a failure code, the same vocabulary onFailure uses.
    var onRecovered = opts.onRecovered || function () {};
    var onReplies = opts.onReplies || function () {};
    var onLimit = opts.onLimit || function () {};
    // R36's reload. isBusy answers "is the reviewer mid-work right now?" (boot
    // wires it to the edit session and the open comment boxes); onPageChanged is
    // the moment before the reload, where the rail says so in plain words.
    var isBusy = opts.isBusy || function () { return false; };
    var onPageChanged = opts.onPageChanged || function () {};
    var reloadDebounceMs = typeof opts.reloadDebounceMs === "number" ? opts.reloadDebounceMs : RELOAD_DEBOUNCE_MS;
    var reloadNoticeMs = typeof opts.reloadNoticeMs === "number" ? opts.reloadNoticeMs : RELOAD_NOTICE_MS;
    // The window-session state machine (D5, findings 1/2/3/12, NEW-2). onRefused
    // fires when this window loses the claim (client lock or helper); the boot
    // layer goes READ-ONLY and shows the refusal panel. onHeld fires only on the
    // TRANSITION out of read-only into holder (a takeover), so boot re-installs
    // the edit and comment handlers it tore down.
    var onRefused = opts.onRefused || function () {};
    var onHeld = opts.onHeld || function () {};

    var state = STATE.IDLE;
    var status = null;
    var started = false;
    var cspRefused = false;
    var lastFailure = null;
    // Whether the helper has answered THIS page. null until it has been heard
    // from either way, and it is learnable without a POST: a page with nothing
    // queued never posts, and before this it read "kept in this browser, it will
    // be stored when the helper is back" forever with a healthy helper.
    var helperReachable = null;
    var backoffIndex = 0;
    var debounceTimer = null;
    var retryTimer = null;
    var pollTimer = null;
    // The window session. readOnly gates every write (finding 1); sessionSecret
    // is what proves this window is the holder on a heartbeat (finding 3); the
    // two timers are the holder's heartbeat (finding 2) and the refused window's
    // liveness poll (NEW-2), both stopped in sync.stop (finding 13).
    var readOnly = false;
    var sessionSecret = null;
    var heartbeatTimer = null;
    var livenessTimer = null;
    var heartbeatMs = 10000;
    var flushing = false;
    var deliveredOnce = false;
    // True from pagehide/beforeunload until this document is shown again. A post
    // the browser cancels because the document is going away is NOT the helper
    // being unreachable: the record is already in browser storage and it
    // re-posts on the next load. Calling that abort a failure raised a permanent
    // "the local helper is not reachable" chip on every page after a
    // commit-then-click-a-link, with the helper up the whole time (walkers,
    // 2026-08-14).
    var unloading = false;
    var cursor = 0;
    // R36. The mtime this page last saw, the armed-but-not-yet-fired reload, and
    // its debounce timer.
    var targetMtime = null;
    var reloadPending = false;
    var reloadTimer = null;
    var reloadsFired = 0;
    // Every time the debounce window closed and the reload was DECIDED, whether
    // it went ahead or was deferred for a busy reviewer. It is what a test waits
    // on to assert that a reload did not happen, instead of sleeping and hoping.
    var reloadChecks = 0;
    var repliesSeen = [];
    var seenItems = Object.create(null);
    var lock = { checked: false, acquired: null, holder: null, reason: null, unchecked: false };
    var counters = { posts: 0, postsFailed: 0, polls: 0, acknowledged: 0, timeouts: 0 };

    function requireReview() {
      if (!review) throw new Error("sync: a review id is required; browser storage and the wire are both keyed by it");
      return review;
    }

    // -------------------------------------------------------------------------
    // The status line (R12)
    // -------------------------------------------------------------------------
    //
    // Three states, and the transitions are what a test asserts. STORED means
    // the helper has acknowledged everything this browser holds: while anything
    // is still queued, the honest word is kept-locally, whatever the last
    // request happened to return.

    function setStatus(next) {
      if (next === status) return status;
      status = next;
      onStatus(status);
      return status;
    }

    function recomputeStatus() {
      var pending = store ? store.pendingEvents(requireReview()).length : 0;
      // Anything the helper refused, could not take, or never answered means
      // the reviewer's typing is living in this browser and nowhere else.
      if (lastFailure || cspRefused) return setStatus(overlay.STATUS.KEPT_LOCALLY);
      if (pending === 0 && (deliveredOnce || helperReachable === true)) {
        // Nothing is queued and the helper is there. Everything durable IS
        // stored, whether this page ever had anything of its own to post.
        if (repliesSeen.length > 0) return setStatus(overlay.STATUS.AGENT_CONNECTED);
        return setStatus(overlay.STATUS.STORED);
      }
      // Queued and in flight with nothing wrong: HOLD the current reading
      // rather than flickering between every keystroke and its acknowledgement.
      // Before there is any reading to hold, the true one is that the work is in
      // this browser and the helper has not confirmed it YET. It does not claim
      // an outage: nothing has failed, so saying the helper is away would be an
      // invention (walkers, 2026-08-14).
      if (status === null) return setStatus(overlay.STATUS.KEPT_UNCONFIRMED);
      return status;
    }

    function raise(failure) {
      lastFailure = failure;
      var code = failures.canonical(failure.code);
      if (code === "HELPER_UNREACHABLE") helperReachable = false;
      if (code === "SYNC_ORIGIN_NOT_ALLOWED" || code === "SYNC_UNAUTHORIZED") {
        // The helper ANSWERED and refused us, so it is not unreachable. Clear
        // that chip here rather than at one call site, or the page wears both
        // and the wrong one last (review, 2026-08-17).
        onRecovered("HELPER_UNREACHABLE");
        // These two are standing conditions, not occurrences. Re-raising the
        // one already standing would grow a ×N counter that counts our own
        // retries, so a repeat is dropped and the chip stays as it is.
        if (accessRefused === code) return failure;
        accessRefused = code;
      }
      onFailure(failure);
      return failure;
    }

    /**
     * The helper answered something. Any acknowledged exchange counts: a reply
     * poll, a granted claim, a heartbeat. It feeds the status line and it ENDS
     * the standing unreachable chip, which is a condition rather than an
     * occurrence and so has to be cleared by the thing that ended it.
     */
    function markReachable() {
      var was = helperReachable;
      helperReachable = true;
      lastFailure = null;
      if (was !== true) onRecovered("HELPER_UNREACHABLE");
      // Every call site of markReachable is an AUTHENTICATED exchange the
      // helper accepted (an append, a reply poll, a claim); the health probe
      // never calls it. So an unregistered origin and a refused token are both
      // over the moment this runs, and their standing chips end here too.
      // Without this, registering the origin fixed the review while the chip
      // kept saying it was broken (Ken, live, 2026-08-17).
      //
      // Only on the STATE CHANGE, though. A healthy page polls every second,
      // and clearing a chip that was never raised still wrote browser storage
      // and rebuilt the whole chip list, which destroyed and recreated any
      // other standing chip's buttons once a second: the "Copy for your agent"
      // button lost its "Copied" confirmation, and a click that straddled a
      // rebuild landed on a detached node (review, 2026-08-17).
      if (accessRefused) {
        accessRefused = null;
        onRecovered("SYNC_ORIGIN_NOT_ALLOWED");
        onRecovered("SYNC_UNAUTHORIZED");
      }
      originDiagnosed = false;
      recomputeStatus();
      return helperReachable;
    }

    // -------------------------------------------------------------------------
    // Minting events
    // -------------------------------------------------------------------------

    function eventTypeFor(item) {
      if (item[record.FIELD.STATE] === record.STATE.READY) return protocol.EVENT.ITEM_READY;
      if (!seenItems[item[record.FIELD.ID]]) return protocol.EVENT.ITEM_CREATED;
      return protocol.EVENT.ITEM_CONTENT;
    }

    function eventFor(item) {
      var type = eventTypeFor(item);
      seenItems[item[record.FIELD.ID]] = true;
      return protocol.newEvent({
        event: type,
        event_id: record.randomId("evt"),
        review: requireReview(),
        item: item[record.FIELD.ID],
        rev: item[record.FIELD.REV],
        page_path: item[record.FIELD.PAGE_PATH],
        page_title: item[record.FIELD.PAGE_TITLE],
        page_seq: item[record.FIELD.PAGE_SEQ],
        source_hint: item[record.FIELD.SOURCE_HINT],
        payload: {
          // Drafts flow to the helper marked draft, and never appear as
          // actionable in what the agent reads (D5, R7).
          draft: record.isDraft(item),
          // Finding 18: an item.content event only wakes `lahe wait` when it
          // carries lost:true (protocol.countsAsNew). replay's markLost stamps
          // region.lost on the record; lift it to the event so an anchor going
          // lost is not a dead capability at the wait watermark. newEvent spreads
          // these payload keys onto the top-level event countsAsNew reads.
          lost: !!(item[record.FIELD.REGION] && item[record.FIELD.REGION].lost),
          record: item
        }
      });
    }

    /**
     * The typing path. SYNCHRONOUS and non-blocking: the event is queued in
     * browser storage in this task, and the network happens later or never.
     *
     * @param {Object} item the record as stored
     * @param {{immediate?: string}} [options] one of protocol.FLUSH.IMMEDIATE_ON
     */
    function recordItem(item, options) {
      // A refused window is READ-ONLY (finding 1): it writes nothing to the
      // shared bucket, so it cannot clobber the holder's work last-keystroke-
      // wins. Boot also tears down the edit/comment handlers, so in practice
      // nothing calls this; the guard is the belt to that suspenders.
      if (readOnly) return null;
      var opts2 = options || {};
      var event = eventFor(item);
      store.queueEvent(requireReview(), event);
      if (opts2.immediate) {
        if (protocol.FLUSH.IMMEDIATE_ON.indexOf(opts2.immediate) === -1) {
          throw new Error(
            "sync.recordItem: immediate must be one of " + protocol.FLUSH.IMMEDIATE_ON.join(", ") + ", got " + opts2.immediate
          );
        }
        scheduleFlush(0);
      } else {
        scheduleFlush(protocol.FLUSH.HELPER_DEBOUNCE_MS);
      }
      recomputeStatus();
      return event;
    }

    // -------------------------------------------------------------------------
    // Posting
    // -------------------------------------------------------------------------

    function url(routeName, query) {
      var base = helperOrigin + protocol.route(routeName).path;
      if (!query) return base;
      var parts = Object.keys(query).map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(query[key]);
      });
      return base + "?" + parts.join("&");
    }

    function headersFor(routeName) {
      var out = {};
      out[protocol.HEADER.CLIENT] = protocol.CLIENT_LAYER;
      out[protocol.HEADER.TOKEN] = token;
      if (protocol.route(routeName).mutating) out[protocol.HEADER.CONTENT_TYPE] = protocol.JSON_CONTENT_TYPE;
      return out;
    }

    // One request, with a deadline. Resolves to {ok, status, body} or
    // {ok:false, error}. It never throws: a transport problem is a state the
    // rail reports, not an exception the typing path has to catch.
    function request(routeName, init) {
      if (!fetchImpl) return Promise.resolve({ ok: false, error: new Error("no fetch in this environment") });
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var timedOut = false;
      var timer = null;
      if (controller) {
        // harness-allow-timer: the request deadline. A suspended helper accepts
        // the socket and answers nothing, so without this the reviewer's page
        // waits forever on a helper that is never coming back this second.
        timer = setTimeout(function () {
          timedOut = true;
          counters.timeouts += 1;
          controller.abort();
        }, REQUEST_TIMEOUT_MS);
      }
      var config = Object.assign({}, init, { headers: headersFor(routeName) });
      if (controller) config.signal = controller.signal;

      return fetchImpl(url(routeName, init && init.query), config)
        .then(function (response) {
          if (timer) clearTimeout(timer);
          return response
            .json()
            .catch(function () {
              return null;
            })
            .then(function (body) {
              return { ok: response.ok, status: response.status, body: body };
            });
        })
        .catch(function (error) {
          if (timer) clearTimeout(timer);
          return { ok: false, error: error, timedOut: timedOut };
        });
    }

    /**
     * Drain the outbox. Never throws, never blocks a caller who does not await
     * it, and idempotent: the helper acknowledges by event_id, so a re-post
     * after a timeout cannot double-count.
     */
    function flush(flushOptions) {
      var fo = flushOptions || {};
      if (flushing) return Promise.resolve({ sent: 0, remaining: pendingCount(), busy: true });
      if (cspRefused) return Promise.resolve({ sent: 0, remaining: pendingCount(), refused: true });

      var events = store.pendingEvents(requireReview());
      if (!events.length) {
        recomputeStatus();
        return Promise.resolve({ sent: 0, remaining: 0 });
      }

      var body = JSON.stringify({ review: requireReview(), events: events });

      // The unload path. Keepalive carries the headers D11 requires, which
      // sendBeacon cannot; oversize is a delay, never a loss, because the
      // events are already in browser storage.
      if (fo.unload && !protocol.fitsKeepalive(body)) {
        return Promise.resolve({ sent: 0, remaining: events.length, oversize: true });
      }

      flushing = true;
      state = STATE.IN_FLIGHT;
      counters.posts += 1;

      var init = { method: "POST", body: body };
      if (fo.unload) init.keepalive = true;

      return request("events.append", init).then(function (result) {
        flushing = false;
        if (result.ok) {
          var accepted = (result.body && result.body.accepted) || [];
          store.acknowledge(requireReview(), accepted);
          // Finding 10: beside dropping the accepted events from the outbox,
          // stamp the item acknowledged when the helper named the event carrying
          // its current rev, so merge.js can let the store win at equal rev. The
          // event carries its item id and rev; markAcknowledged guards the rev.
          if (typeof store.markAcknowledged === "function" && accepted.length) {
            var acceptedIds = Object.create(null);
            accepted.forEach(function (id) {
              acceptedIds[id] = true;
            });
            events.forEach(function (ev) {
              if (!acceptedIds[ev.event_id]) return;
              var itemId = ev[protocol.EVENT_FIELD.ITEM];
              var rev = ev[protocol.EVENT_FIELD.REV];
              if (itemId && typeof rev === "number") {
                store.markAcknowledged(requireReview(), itemId, rev);
              }
            });
          }
          deliveredOnce = true;
          counters.acknowledged += accepted.length;
          markReachable();
          backoffIndex = 0;
          state = STATE.IDLE;
          if (typeof (result.body && result.body.seq) === "number" && cursor === 0) {
            cursor = result.body.seq;
          }
          recomputeStatus();
          var remaining = pendingCount();
          if (remaining > 0 && !fo.unload) scheduleFlush(0);
          return { sent: accepted.length, remaining: remaining };
        }

        // The document went away mid-request. Nothing failed and nothing is
        // lost, so nothing is said: the events are in browser storage and the
        // next load posts them.
        if (abortedByTeardown(result)) {
          state = STATE.IDLE;
          recomputeStatus();
          return { sent: 0, remaining: pendingCount(), aborted: true };
        }

        counters.postsFailed += 1;
        state = STATE.RETRYING;
        raise(classify(result.error, { status: result.status, detail: describe(result) }));
        // A failure with no status at all is a network-level one, which is what
        // a refused preflight looks like. Ask the second question.
        if (result.status === undefined) diagnoseUnreachable();
        recomputeStatus();
        if (!fo.unload) scheduleRetry();
        return { sent: 0, remaining: pendingCount(), failed: true };
      });
    }

    /**
     * True when this request died because the page is being torn down, rather
     * than because anything is wrong with the helper. Two shapes:
     *
     *   - the document is unloading (pagehide/beforeunload has fired), so every
     *     in-flight request is cancelled by the browser
     *   - an AbortError this client did not ask for: our own deadline sets
     *     timedOut, and a timeout IS a real failure, so it is excluded here
     *
     * Either way the queue is untouched and the next load re-posts it.
     */
    function abortedByTeardown(result) {
      if (result.timedOut) return false;
      if (unloading) return true;
      var error = result.error;
      return !!error && error.name === "AbortError";
    }

    function describe(result) {
      if (result.timedOut) return "the helper accepted the connection and did not answer within " + REQUEST_TIMEOUT_MS + "ms";
      if (result.error) return result.error.message || String(result.error);
      if (result.body && result.body.error) return result.body.error.message || result.body.error.code;
      return result.status ? "HTTP " + result.status : null;
    }

    function pendingCount() {
      return store ? store.pendingEvents(requireReview()).length : 0;
    }

    function scheduleFlush(delayMs) {
      if (debounceTimer) clearTimeout(debounceTimer);
      // harness-allow-timer: protocol.FLUSH's 750ms typing-idle debounce. This
      // is the ONLY debounce in the design and it is on the post to the helper,
      // never on the write to browser storage.
      debounceTimer = setTimeout(function () {
        debounceTimer = null;
        flush();
      }, delayMs);
    }

    function scheduleRetry() {
      if (retryTimer) return;
      var wait = BACKOFF_MS[Math.min(backoffIndex, BACKOFF_MS.length - 1)];
      backoffIndex += 1;
      // harness-allow-timer: the capped retry backoff. It never gives up, which
      // is the promise that a stopped helper costs the reviewer nothing.
      retryTimer = setTimeout(function () {
        retryTimer = null;
        flush();
      }, wait);
    }

    // -------------------------------------------------------------------------
    // The reply poll loop (3A reads this; it never edits this file)
    // -------------------------------------------------------------------------
    //
    // The cursor is a seq from the log (protocol.REPLY_CURSOR_FIELD), never a
    // timestamp: two events in one millisecond are ordinary and a clock that
    // steps backwards silently skips work.

    function poll() {
      counters.polls += 1;
      return request("replies.poll", { method: "GET", query: { review: requireReview(), since: cursor } }).then(
        function (result) {
          if (!result.ok) {
            // A poll the navigation cancelled says nothing about the helper.
            if (abortedByTeardown(result)) return { events: [] };
            raise(classify(result.error, { status: result.status, detail: describe(result) }));
            if (result.status === undefined) {
              // Returned rather than fired and forgotten, so one awaited poll
              // is one settled diagnosis and a test can assert the chips.
              return diagnoseUnreachable().then(function () {
                recomputeStatus();
                return { events: [] };
              });
            }
            recomputeStatus();
            return { events: [] };
          }
          // The helper answered. That is proof it is there, and it is the ONLY
          // proof a page with an empty outbox can have: it never posts.
          markReachable();
          var events = (result.body && result.body.events) || [];
          if (typeof (result.body && result.body.seq) === "number") cursor = result.body.seq;
          noteTargetMtime(result.body && result.body.target_mtime);
          if (events.length) {
            repliesSeen = repliesSeen.concat(events);
            onReplies(events);
          }
          recomputeStatus();
          return { events: events, seq: cursor };
        }
      );
    }

    /**
     * The reviewed file's mtime, as this poll reported it (R36).
     *
     * The FIRST value seen is just the baseline: this page is already showing
     * that version of the file, so it arms nothing. Any later value that differs
     * means the agent rebuilt the page underneath the reviewer.
     *
     * A null answers nothing at all: the review has no recorded path, or the
     * file is momentarily absent because a build is writing it. Treating a null
     * as a change would reload the page every time a build was mid-write.
     *
     * @param {string|null} value an ISO string, or null
     * @returns {boolean} true when this call armed a reload
     */
    function noteTargetMtime(value) {
      if (typeof value !== "string" || !value) return false;
      if (targetMtime === null) {
        targetMtime = value;
        return false;
      }
      if (value === targetMtime) {
        // Nothing changed. If a reload is still waiting on the reviewer to stop
        // typing, this is the tick that gets to ask again.
        if (reloadPending && !reloadTimer) armReload(0);
        return false;
      }
      targetMtime = value;
      reloadPending = true;
      // Restart the window rather than reload now: a rebuild that touches the
      // file three times in a second is one change to the reviewer.
      armReload(reloadDebounceMs);
      return true;
    }

    function armReload(delayMs) {
      if (reloadTimer) clearTimeout(reloadTimer);
      // harness-allow-timer: R36's rebuild debounce, pinned at RELOAD_DEBOUNCE_MS
      // above. One rebuild is one reload.
      reloadTimer = setTimeout(function () {
        reloadTimer = null;
        fireReload();
      }, delayMs);
    }

    /**
     * Reload, unless the reviewer is mid-work. A deferral is not a cancellation:
     * reloadPending stays true and the next poll that finds them idle arms it
     * again, so the page catches up the moment they finish.
     */
    function fireReload() {
      if (!reloadPending) return false;
      reloadChecks += 1;
      var busy = false;
      try {
        busy = !!isBusy();
      } catch (error) {
        // A busy check that throws must not cost the reviewer their page. Treat
        // it as busy: a late reload is recoverable, one over a live edit is not.
        busy = true;
      }
      if (busy) return false;
      reloadPending = false;
      reloadsFired += 1;
      onPageChanged();
      // harness-allow-timer: the pause that lets "Page updated. Reloading..."
      // paint before the document goes away.
      setTimeout(function () {
        if (win && win.location && typeof win.location.reload === "function") win.location.reload();
      }, reloadNoticeMs);
      return true;
    }

    function startPolling() {
      if (pollTimer) return pollTimer;
      // harness-allow-timer: the reply poll interval, pinned above.
      pollTimer = setInterval(function () {
        poll();
        if (pendingCount() > 0 && !retryTimer && !flushing) flush();
      }, POLL_INTERVAL_MS);
      return pollTimer;
    }

    // -------------------------------------------------------------------------
    // Telling a CSP refusal from a helper that is down
    // -------------------------------------------------------------------------

    function classify(error, hints) {
      var h = hints || {};
      // A diagnosis already made still holds. classify has no memory of the
      // health probe, so without this every later failing poll re-raised
      // HELPER_UNREACHABLE on a page whose real problem was its origin, and the
      // reviewer wore both chips with the wrong one last (review, 2026-08-17).
      var answered = h.healthAnswered;
      if (answered === undefined && originDiagnosed) answered = true;
      var code = decideFailureCode({ cspRefused: cspRefused, status: h.status, healthAnswered: answered });
      if (code === "SYNC_ORIGIN_NOT_ALLOWED") return failures.failure(code, originRemedy());
      return failures.failure(code, h.detail || (error && error.message) || null);
    }

    // -------------------------------------------------------------------------
    // Telling an unregistered origin from a helper that is down
    // -------------------------------------------------------------------------
    //
    // THE ORIGIN TRAP. A page added as a static file registers the origin "null"
    // and nothing else. Serve that same page over http and the browser sends the
    // server's origin, which no review registered, so the helper refuses every
    // request. The reviewer's page then said "the local helper is not reachable",
    // which blames the one thing that is working, and the fix it suggests
    // (start the helper) does nothing.
    //
    // The refusal is invisible to fetch: every route carries the custom header
    // D11 requires, so the browser preflights, and a refused preflight surfaces
    // as a plain network error rather than a 403 with a code in it. So the page
    // ASKS A SECOND QUESTION when a request fails at the network level: health
    // is unauthenticated, needs no custom header, and therefore no preflight. If
    // health answers, the helper is up and the origin is the problem.
    var originDiagnosed = false;
    // The access refusal currently STANDING, as a canonical code, or null.
    // It is what tells a re-raise from a first raise and a real recovery from a
    // healthy page's every-second poll.
    var accessRefused = null;

    function pageOrigin() {
      if (win && win.location && win.location.origin) return String(win.location.origin);
      if (doc && doc.location && doc.location.origin) return String(doc.location.origin);
      return "this page's origin";
    }

    function originRemedy() {
      // A sentence the reviewer can hand to any agent verbatim, so it carries
      // everything the agent needs: the page URL, the origin to register, and
      // the review id. The chip renders it with a "Copy for your agent" button.
      var href =
        win && win.location && win.location.href
          ? String(win.location.href)
          : doc && doc.location && doc.location.href
            ? String(doc.location.href)
            : "this page";
      return (
        "My lahe review page " +
        href +
        " says its address is not registered. Register the origin " +
        pageOrigin() +
        " for review " +
        (review || "(unknown)") +
        ", then tell me to reload."
      );
    }

    /**
     * Is the helper actually up, asked in the one way an unregistered origin can
     * still ask? Answers null when the question could not be put at all.
     */
    function probeHealth() {
      if (!fetchImpl) return Promise.resolve(null);
      // No custom headers, deliberately: a simple request is not preflighted, so
      // it reaches the handler even from an origin no review registered.
      return fetchImpl(helperOrigin + protocol.route("health").path, { method: "GET" })
        .then(function (response) {
          return !!(response && response.ok);
        })
        .catch(function () {
          return false;
        });
    }

    /**
     * After a network-level failure, work out whether this is really the helper
     * being down or this page's origin being unregistered, and say so once.
     *
     * The probe RE-RUNS on every failing poll rather than stopping at the first
     * diagnosis. A diagnosis is a claim about right now, and a helper that dies
     * an hour after the origin was refused has to surface as unreachable rather
     * than leave the page insisting on an origin problem forever. Re-running
     * costs one unauthenticated local request per failing poll, and a page whose
     * polls are all succeeding never gets here at all.
     */
    function diagnoseUnreachable() {
      if (cspRefused) return Promise.resolve(null);
      return probeHealth().then(function (healthAnswered) {
        if (healthAnswered !== true) {
          if (!originDiagnosed) return null;
          // Health stopped answering. The origin diagnosis is over, and this is
          // now a helper that is genuinely down.
          originDiagnosed = false;
          accessRefused = null;
          onRecovered("SYNC_ORIGIN_NOT_ALLOWED");
          return raise(failures.failure("HELPER_UNREACHABLE", "health stopped answering after an origin refusal"));
        }
        originDiagnosed = true;
        // The helper answers, so it is not unreachable. raise clears that chip
        // before this one lands, and it drops the repeat while it stands.
        return raise(failures.failure("SYNC_ORIGIN_NOT_ALLOWED", originRemedy()));
      });
    }

    function onPolicyViolation(event) {
      var directive = String(event.effectiveDirective || event.violatedDirective || "");
      if (directive.indexOf("connect-src") !== 0) return;
      var blocked = String(event.blockedURI || "");
      if (blocked && helperOrigin && blocked.indexOf(helperOrigin) !== 0) return;
      cspRefused = true;
      state = STATE.REFUSED;
      raise(failures.failure("CSP_REFUSED", "connect-src blocked " + (blocked || helperOrigin)));
      recomputeStatus();
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    // The secret this window kept from a previous page of the same review, if
    // any. Presenting it on the first claim is what turns a same-tab navigation
    // into a recognized heartbeat instead of a refused second window (D5).
    function loadPersistedSecret() {
      if (store && typeof store.sessionSecretFor === "function") {
        sessionSecret = store.sessionSecretFor(requireReview()) || null;
      }
      return sessionSecret;
    }

    // The claims are SEQUENCED. Two claims can be in flight at once (a
    // double-clicked "Review here", a takeover racing the heartbeat), and the
    // answers can come back in either order. Storing the older answer's secret
    // means the next heartbeat presents a secret the helper has already
    // replaced, and the reviewer's own window is refused as a second window.
    // A secret from a claim older than the one already applied is dropped.
    var claimSeq = 0;
    var appliedClaimSeq = 0;

    function rememberSecret(secret, seq) {
      if (typeof seq === "number") {
        if (seq < appliedClaimSeq) return sessionSecret;
        appliedClaimSeq = seq;
      }
      sessionSecret = secret || null;
      if (store && typeof store.rememberSessionSecret === "function") {
        store.rememberSessionSecret(requireReview(), sessionSecret);
      }
      return sessionSecret;
    }

    function start() {
      if (started) return Promise.resolve(lock);
      started = true;
      requireReview();
      loadPersistedSecret();

      if (doc && typeof doc.addEventListener === "function") {
        doc.addEventListener("securitypolicyviolation", onPolicyViolation);
      }
      if (win && typeof win.addEventListener === "function") {
        // Navigation and unload both commit immediately, with keepalive. R1
        // names navigation, so a link click cannot be a losing move.
        win.addEventListener("pagehide", commitOnUnload);
        win.addEventListener("beforeunload", commitOnUnload);
        win.addEventListener("pageshow", onPageShow);
      }

      startPolling();
      // Anything a previous session left unacknowledged goes out now. This is
      // the whole of "re-posts on the next load".
      flush();

      return store
        .claimWindow(requireReview())
        .then(function (got) {
          lock = {
            checked: true,
            acquired: got.acquired,
            holder: got.holder,
            reason: got.reason,
            refusedBy: got.acquired ? null : "lock",
            unchecked: got.unchecked === true
          };
          if (!got.acquired) {
            raise(got.failure);
            return lock;
          }
          // The client lock is held, so any second-window chip left in storage
          // from an earlier session is stale. Cleared here as well as in
          // parseClaim, because this half works with the helper down and it is
          // the only half a helperless page ever runs.
          onRecovered("SECOND_WINDOW_REFUSED");
          // The two shapes fail differently (D5): the lock above catches two
          // tabs sharing one storage bucket, and only the helper can see two
          // windows that cannot see each other's storage.
          return claimWithHelper();
        })
        .then(function (result) {
          // The uncovered case is said out loud only while it is ACTUAL: with
          // no helper granting claims, separate-storage windows are invisible
          // and the note earns its line. A helper that answered covers that
          // case, and a standing disclaimer under a working session is noise
          // the reviewer learns to ignore (Ken, 2026-08-18). The heartbeat
          // path keeps this current: it re-runs the claim, so the note comes
          // and goes with the helper.
          onLimit(lock.helperGranted ? null : overlay.LIMIT_SEPARATE_STORAGE_NO_HELPER);
          finalizeClaim();
          return result;
        });
    }

    // The window.claim request, in one place, so the initial claim, the
    // heartbeat, the liveness poll and the manual takeover all speak the same
    // wire. `body` decides which: a heartbeat carries the session_secret, a
    // takeover carries takeover:true, a first claim or liveness poll carries
    // neither.
    function claimRequest(body) {
      claimSeq += 1;
      var seq = claimSeq;
      return request("window.claim", { method: "POST", body: JSON.stringify(body) })
        .then(parseClaim)
        .then(function (parsed) {
          // Which claim this answer belongs to, so a late answer cannot overwrite
          // a newer one's secret (see rememberSecret).
          parsed.seq = seq;
          return parsed;
        });
    }

    function parseClaim(result) {
      if (result.ok) {
        // A granted claim or heartbeat is an acknowledged exchange, so it is
        // proof of reachability just like a reply poll is.
        markReachable();
        // AND this window holds the review, so a second-window refusal is over.
        // A chip is restored from browser storage on every load and was trusted
        // as it stood, so a refusal from an earlier session (or from the moment
        // a reload raced its own outgoing page) stayed on the rail while the
        // reviewer was typing happily into the review it claimed was locked
        // (Ken, live, 2026-08-18). Every successful claim re-validates it. The
        // clear is a no-op when no such chip stands, so the heartbeat every ten
        // seconds costs nothing.
        onRecovered("SECOND_WINDOW_REFUSED");
        var b = result.body || {};
        return {
          granted: true,
          refused: false,
          tookOver: b.took_over === true,
          sessionSecret: b.session_secret || null,
          heartbeatSeconds: typeof b.heartbeat_seconds === "number" ? b.heartbeat_seconds : null,
          body: b
        };
      }
      var body = result.body || {};
      var code = body.error && body.error.code;
      // A refusal has a body that SAYS refused. A helper that is simply down is a
      // rejected fetch with no body, and that is NOT a refusal: locking a window
      // out on a check that never ran is the work-losing outcome D5 forbids.
      var refused = body.granted === false || code === "PROTO_SECOND_WINDOW";
      return { granted: false, refused: refused, body: body, error: result.error };
    }

    // The refusal, with no holder id to read anymore (finding 3): the server
    // stopped disclosing it, so the reason is the server's own sentence.
    function reasonFromBody(body) {
      body = body || {};
      return (
        "The helper says " +
        (body.reason || (body.error && body.error.detail) || "this review is already open in another window.")
      );
    }

    function claimWithHelper() {
      // The first claim carries any secret this window kept from an earlier page
      // of this review (a same-tab navigation), so the helper recognizes it as
      // the holder's heartbeat rather than refusing it as a second window.
      return claimRequest({
        review: requireReview(),
        window_id: store.windowId,
        session_secret: sessionSecret || undefined,
        takeover: false
      }).then(function (parsed) {
        if (parsed.granted) {
          lock.helperGranted = true;
          rememberSecret(parsed.sessionSecret, parsed.seq);
          if (parsed.heartbeatSeconds) heartbeatMs = parsed.heartbeatSeconds * 1000;
          return lock;
        }
        if (parsed.refused) {
          lock.acquired = false;
          lock.refusedBy = "helper";
          lock.reason = reasonFromBody(parsed.body);
          raise(failures.failure("SECOND_WINDOW_REFUSED", lock.reason));
          return lock;
        }
        // The helper being unreachable is not a refusal. Held optimistically; the
        // heartbeat will claim properly once the helper answers.
        lock.helperGranted = false;
        return lock;
      });
    }

    // -------------------------------------------------------------------------
    // The window-session state machine (D5)
    // -------------------------------------------------------------------------

    function finalizeClaim() {
      if (!lock.acquired) {
        // Refused, by the client lock or the helper. READ-ONLY, and a light
        // liveness poll so the holder going quiet is still noticed here.
        enterReadOnly();
      } else {
        // Held. Start the heartbeat so the helper keeps seeing this window; a
        // holder that never re-posts loses its own review after STALE_AFTER_MS.
        startHeartbeat();
      }
    }

    function enterReadOnly() {
      if (readOnly) return;
      readOnly = true;
      stopHeartbeat();
      onRefused({ reason: lock.reason, refusedBy: lock.refusedBy });
      startLiveness();
    }

    // The read-only window becomes the holder: on auto-takeover (holder went
    // stale, granted by the liveness poll) or on the reviewer's Review-here.
    function becomeHolder(parsed) {
      readOnly = false;
      rememberSecret(parsed.sessionSecret, parsed.seq);
      if (parsed.heartbeatSeconds) heartbeatMs = parsed.heartbeatSeconds * 1000;
      lock.acquired = true;
      lock.helperGranted = true;
      lock.refusedBy = null;
      lock.reason = null;
      lastFailure = null;
      stopLiveness();
      // Re-grab the client lock too, for the shared-storage case: the old holder
      // released it when it died or was deposed. Best-effort and unawaited.
      if (store && typeof store.claimWindow === "function") store.claimWindow(requireReview());
      startHeartbeat();
      recomputeStatus();
      onHeld();
    }

    /**
     * The reviewer's "Review here instead" (finding 12). It re-posts the claim
     * with takeover:true, which the helper honors for any token-bearing window
     * (NEW-2's decision: takeover is same-token-trusted, not secret-proven),
     * deposing even a live holder. On success this window becomes the holder.
     *
     * @returns {Promise<{ok: boolean, reason?: string}>}
     */
    function takeover() {
      return claimRequest({ review: requireReview(), window_id: store.windowId, takeover: true }).then(function (parsed) {
        if (parsed.granted) {
          becomeHolder(parsed);
          return { ok: true };
        }
        return { ok: false, reason: parsed.refused ? reasonFromBody(parsed.body) : "the helper could not be reached" };
      });
    }

    function startHeartbeat() {
      if (heartbeatTimer) return heartbeatTimer;
      // harness-allow-timer: the holder's heartbeat. The helper calls a holder
      // lost after STALE_AFTER_MS of silence, so re-posting the claim on this
      // cadence is what keeps this window the holder (finding 2).
      heartbeatTimer = setInterval(postHeartbeat, heartbeatMs);
      return heartbeatTimer;
    }

    function stopHeartbeat() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    function postHeartbeat() {
      claimRequest({
        review: requireReview(),
        window_id: store.windowId,
        session_secret: sessionSecret,
        takeover: false
      }).then(function (parsed) {
        if (parsed.granted) {
          lock.helperGranted = true;
          if (parsed.sessionSecret) rememberSecret(parsed.sessionSecret, parsed.seq);
          // The helper is covering separate-storage windows again, so the
          // named limit stops being actual and its note comes down.
          onLimit(null);
          return;
        }
        if (parsed.refused) {
          // Deposed: another window ran Review-here-instead. Drop to read-only
          // rather than keep editing a review this window no longer owns.
          lock.acquired = false;
          lock.refusedBy = "helper";
          lock.reason = reasonFromBody(parsed.body);
          raise(failures.failure("SECOND_WINDOW_REFUSED", lock.reason));
          recomputeStatus();
          enterReadOnly();
          return;
        }
        // Unreachable: keep the heartbeat running and try again next tick. The
        // uncovered case is actual for as long as this lasts, so the note is up.
        lock.helperGranted = false;
        onLimit(overlay.LIMIT_SEPARATE_STORAGE_NO_HELPER);
      });
    }

    function startLiveness() {
      if (livenessTimer) return livenessTimer;
      // harness-allow-timer: the refused window's liveness poll. It re-attempts
      // the claim with takeover:false; while the holder is alive it is refused
      // and nothing happens, but once the holder goes stale the helper grants it
      // and this becomes D5's 30s auto-takeover (NEW-2).
      livenessTimer = setInterval(pollLiveness, heartbeatMs);
      return livenessTimer;
    }

    function stopLiveness() {
      if (livenessTimer) clearInterval(livenessTimer);
      livenessTimer = null;
    }

    function pollLiveness() {
      claimRequest({ review: requireReview(), window_id: store.windowId, takeover: false }).then(function (parsed) {
        if (parsed.granted) becomeHolder(parsed);
      });
    }

    function commitOnUnload() {
      unloading = true;
      return flush({ unload: true });
    }

    // A page restored from the bfcache, or a beforeunload the reviewer cancelled,
    // is a live document again: real failures have to be audible from here on.
    function onPageShow() {
      unloading = false;
    }

    function stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = null;
      stopHeartbeat();
      stopLiveness();
      debounceTimer = null;
      retryTimer = null;
      pollTimer = null;
      if (doc && typeof doc.removeEventListener === "function") {
        doc.removeEventListener("securitypolicyviolation", onPolicyViolation);
      }
      if (win && typeof win.removeEventListener === "function") {
        win.removeEventListener("pagehide", commitOnUnload);
        win.removeEventListener("beforeunload", commitOnUnload);
        win.removeEventListener("pageshow", onPageShow);
      }
      if (store) store.releaseWindow(review);
      started = false;
      return true;
    }

    function statusOf() {
      return {
        state: state,
        status: status,
        queued: pendingCount(),
        cursor: cursor,
        targetMtime: targetMtime,
        reloadPending: reloadPending,
        reloadsFired: reloadsFired,
        reloadChecks: reloadChecks,
        readOnly: readOnly,
        cspRefused: cspRefused,
        lastFailure: lastFailure ? lastFailure.code : null,
        counters: Object.assign({}, counters)
      };
    }

    return {
      STATE: STATE,
      BACKOFF_MS: BACKOFF_MS,
      REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
      POLL_INTERVAL_MS: POLL_INTERVAL_MS,
      start: start,
      stop: stop,
      recordItem: recordItem,
      eventFor: eventFor,
      flush: flush,
      commitOnUnload: commitOnUnload,
      takeover: takeover,
      isReadOnly: function () {
        return readOnly;
      },
      poll: poll,
      noteTargetMtime: noteTargetMtime,
      classify: classify,
      repliesSeen: function () {
        return repliesSeen.slice();
      },
      lockState: function () {
        return lock;
      },
      status: statusOf
    };
  }

  return {
    STATE: STATE,
    BACKOFF_MS: BACKOFF_MS,
    REQUEST_TIMEOUT_MS: REQUEST_TIMEOUT_MS,
    POLL_INTERVAL_MS: POLL_INTERVAL_MS,
    RELOAD_DEBOUNCE_MS: RELOAD_DEBOUNCE_MS,
    RELOAD_NOTICE_MS: RELOAD_NOTICE_MS,
    decideFailureCode: decideFailureCode,
    createSync: createSync
  };
});
