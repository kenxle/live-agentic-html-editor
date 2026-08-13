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
    var onReplies = opts.onReplies || function () {};
    var onLimit = opts.onLimit || function () {};
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
    var cursor = 0;
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
      if (pending === 0 && deliveredOnce) {
        if (repliesSeen.length > 0) return setStatus(overlay.STATUS.AGENT_CONNECTED);
        return setStatus(overlay.STATUS.STORED);
      }
      // Queued and in flight with nothing wrong: HOLD the current reading
      // rather than flickering to kept-locally between every keystroke and its
      // acknowledgement. Before the first successful post there is no reading
      // to hold, and kept-locally is the true one.
      if (status === null) return setStatus(overlay.STATUS.KEPT_LOCALLY);
      return status;
    }

    function raise(failure) {
      lastFailure = failure;
      onFailure(failure);
      return failure;
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
          lastFailure = null;
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

        counters.postsFailed += 1;
        state = STATE.RETRYING;
        raise(classify(result.error, { status: result.status, detail: describe(result) }));
        recomputeStatus();
        if (!fo.unload) scheduleRetry();
        return { sent: 0, remaining: pendingCount(), failed: true };
      });
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
            raise(classify(result.error, { status: result.status, detail: describe(result) }));
            recomputeStatus();
            return { events: [] };
          }
          lastFailure = null;
          var events = (result.body && result.body.events) || [];
          if (typeof (result.body && result.body.seq) === "number") cursor = result.body.seq;
          if (events.length) {
            repliesSeen = repliesSeen.concat(events);
            onReplies(events);
          }
          recomputeStatus();
          return { events: events, seq: cursor };
        }
      );
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
      if (cspRefused) return failures.failure("CSP_REFUSED", h.detail || null);
      if (h.status === 401) return failures.failure("SYNC_UNAUTHORIZED", h.detail || null);
      if (h.status === 403) return failures.failure("SYNC_ORIGIN_NOT_ALLOWED", h.detail || null);
      return failures.failure("HELPER_UNREACHABLE", h.detail || (error && error.message) || null);
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

    function rememberSecret(secret) {
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
          // The two shapes fail differently (D5): the lock above catches two
          // tabs sharing one storage bucket, and only the helper can see two
          // windows that cannot see each other's storage.
          return claimWithHelper();
        })
        .then(function (result) {
          // Whichever way it went, the case nothing can refuse is said out
          // loud rather than quietly claimed as covered.
          onLimit(overlay.LIMIT_SEPARATE_STORAGE_NO_HELPER);
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
      return request("window.claim", { method: "POST", body: JSON.stringify(body) }).then(parseClaim);
    }

    function parseClaim(result) {
      if (result.ok) {
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
          rememberSecret(parsed.sessionSecret);
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
      rememberSecret(parsed.sessionSecret);
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
          if (parsed.sessionSecret) rememberSecret(parsed.sessionSecret);
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
        }
        // Unreachable: keep the heartbeat running and try again next tick.
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
      flush({ unload: true });
    }

    function stop() {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearInterval(pollTimer);
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
    createSync: createSync
  };
});
