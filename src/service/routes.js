// The router: one handler per route in src/shared/protocol.js.
//
// Owner: 1A. The route table is protocol.js's and is never restated here; the
// check at the foot of this file fails at LOAD time if a route has no handler,
// so a route added to the wire cannot quietly go unserved.
//
// FAIL LOUD. A handler that is not built yet throws, naming the task that owns
// it. It never returns an empty 200: a handler that quietly succeeds while doing
// nothing is how a burn-down empties itself while every test stays green.
//
// The checks do not happen here. Every request has already been through
// auth.check (D11, no exceptions) before a handler is reached, and the handler
// receives the review id the check block VERIFIED rather than one it re-reads
// from the request.
//
// Node-only.

"use strict";

var crypto = require("node:crypto");

var protocol = require("../shared/protocol.js");

function notImplemented(routeName, owner) {
  var err = new Error("route " + routeName + " is not implemented yet: Task " + owner + " owns it");
  err.code = "NOT_IMPLEMENTED";
  return err;
}

/**
 * @typedef {object} HandlerRequest
 * @property {string} routeName
 * @property {string} review      the id the check block verified
 * @property {string|null} origin the origin the check block read from the header
 * @property {object} query
 * @property {object|null} body
 * @property {string} requestId
 */

var HANDLERS = {
  // Liveness and version only, so `add` can tell a helper that is up from one
  // that is not. No credential, and no review data in the answer.
  health: function (request, deps) {
    return {
      status: 200,
      body: {
        ok: true,
        version: deps.version,
        api: protocol.API_VERSION,
        started_at: deps.startedAt
      }
    };
  },

  // The library posts each event as it happens, and re-posts anything it has not
  // seen acknowledged on every reconnect. Both paths land here, and the second
  // one is why the response names exactly which event_ids are on disk.
  "events.append": function (request, deps) {
    var body = request.body || {};
    var events = body.events;
    if (!Array.isArray(events)) {
      return {
        status: 400,
        error: { code: "PROTO_BAD_REQUEST", detail: "the body must be {review, events: [event, ...]}" }
      };
    }
    var result = deps.log.append(request.review, events);
    if (result.rejected.length > 0) {
      deps.log.helperLog(
        "review " +
          request.review +
          ": refused " +
          result.rejected.length +
          " event(s): " +
          result.rejected
            .map(function (entry) {
              return entry.reason;
            })
            .join("; ")
      );
    }
    return {
      status: 200,
      body: {
        // Duplicates are accepted, not errors: the client asked twice and the
        // answer to both is "it is on disk". Idempotence is by event_id.
        accepted: result.accepted.concat(result.duplicates),
        stored: result.accepted,
        duplicates: result.duplicates,
        rejected: result.rejected,
        seq: result.seq
      }
    };
  },

  // The built library, served by the helper so the script line can be one
  // absolute URL that resolves from any folder the page happens to be served
  // out of. UNAUTHENTICATED, and that is deliberate: the bytes are the tool's
  // own public code, identical to the file in the repo, carrying no review
  // data and no token. The exemption is protocol.js's (AUTH.NONE), the same
  // visible way health is exempt, not a branch around the check block.
  //
  // The bytes are read once at serve start (deps.library), so a request is a
  // buffer write and a missing build is a loud failure at startup rather than a
  // 404 a reviewer meets as a page that does nothing.
  "library.get": function (request, deps) {
    if (!deps.library || typeof deps.library.source !== "string") {
      throw notImplemented("library.get", "1A");
    }
    return {
      status: 200,
      raw: { contentType: "application/javascript; charset=utf-8", text: deps.library.source }
    };
  },

  // What `add` calls for a review this helper ALREADY HOLDS.
  //
  // Without it, `add` had to stop the helper to write to such a review (two
  // writers on one events.jsonl is the thing being avoided), and stopping the
  // helper drops every blocked `lahe wait` long-poll: an agent waiting on the
  // review Ken was reviewing died every time he re-ran add. So the writes come
  // here instead and the helper, the single writer, applies them itself. `add`
  // now only writes to disk when NO helper is answering.
  //
  // Everything here is idempotent: registering an origin twice is a no-op, and
  // a repeated source hint is one more page.visited event, which the projector
  // folds onto the same page group.
  "review.write": function (request, deps) {
    var body = request.body || {};
    var origins = Array.isArray(body.origins) ? body.origins : [];
    var applied = [];
    origins.forEach(function (origin) {
      if (typeof origin !== "string" || !origin) return;
      deps.reviews.registerOrigin(request.review, origin);
      applied.push(origin);
    });

    // The target path, so a rebuilt page that lost its script line can be
    // matched back to this review instead of minting a fourth one.
    var recordedPaths = false;
    if (typeof body.target_path === "string" || typeof body.source_path === "string") {
      deps.reviews.recordPaths(request.review, {
        target_path: typeof body.target_path === "string" ? body.target_path : null,
        source_path: typeof body.source_path === "string" ? body.source_path : null
      });
      recordedPaths = true;
    }

    // The source hint rides a page.visited event, the one event in the closed
    // vocabulary that carries page facts, so the projector puts it on that
    // page's group header. The event is minted HERE: the helper owns the log.
    var recordedSource = false;
    if (typeof body.source_hint === "string" && body.source_hint) {
      deps.log.append(request.review, [
        protocol.newEvent({
          event: protocol.EVENT.PAGE_VISITED,
          event_id: "ev_" + crypto.randomBytes(8).toString("hex"),
          review: request.review,
          page_path: typeof body.page_path === "string" && body.page_path ? body.page_path : null,
          page_seq: 1,
          source_hint: body.source_hint
        })
      ]);
      recordedSource = true;
    }

    return {
      status: 200,
      body: {
        origins: applied,
        recorded_source: recordedSource,
        recorded_paths: recordedPaths,
        seq: deps.log.currentSeq(request.review)
      }
    };
  },

  // The projection the library reconciles against on load and on every
  // reconnect. 3A owns the projector; this is its one call site.
  //
  // It is the SAME projection the agent reads off disk, with `seq` added, so a
  // reconnecting page and an agent opening review.json are looking at one
  // thing. Answering a read also puts the review under the projector's watch,
  // which is what starts the reply loop in an ordinary session: the page asks
  // on load and on every reconnect.
  "review.read": function (request, deps) {
    if (!deps.projection || typeof deps.projection.project !== "function") {
      throw notImplemented("review.read", "3A");
    }
    if (typeof deps.projection.startWatching === "function") {
      deps.projection.startWatching(deps, [request.review]);
    }
    var events = deps.log.read(request.review);
    var projected = deps.projection.project(request.review, events);
    // How many items the reviewer is still writing. Drafts are NOT in the
    // projection (R7: they never reach an agent) and that stays true; this is a
    // count and nothing else, so `lahe status` can say "3 drafts, the reviewer
    // is still writing" instead of leaving a stuck draft invisible to everyone.
    var draftCount = deps.projection.itemsFrom(events).filter(function (item) {
      return item.state === "draft";
    }).length;
    return {
      status: 200,
      // `page_last_seen_at` is the liveness fact `lahe status` reports: when the
      // reviewer's PAGE last spoke to this helper (reviews.touch counts only
      // requests from the library). It rides this response because status
      // already reads the projection here, and because a number that only means
      // anything while the helper is up should come from the helper.
      body: Object.assign({}, projected, {
        seq: deps.log.currentSeq(request.review),
        page_last_seen_at: deps.reviews.lastSeenAt(request.review),
        draft_count: draftCount
      })
    };
  },

  // The library's reply poll loop. The cursor is a seq, never a timestamp and
  // never a byte offset: two events in one millisecond are ordinary, and a clock
  // that steps backwards would silently skip work.
  "replies.poll": function (request, deps) {
    var since = numberOr(request.query.since, 0);
    var events = deps.log.since(request.review, since).filter(function (event) {
      var type = event[protocol.EVENT_FIELD.EVENT];
      return type === protocol.EVENT.REPLY_FOLDED || type === protocol.EVENT.REPLY_REJECTED;
    });
    return {
      status: 200,
      // `target_mtime` is R36's refresh trigger for a static page: when the
      // agent rebuilds the reviewed file, this number changes and the library
      // reloads the page itself. Null when the review has no recorded path or
      // the file is not there, which the library reads as "nothing to say".
      body: { events: events, seq: deps.log.currentSeq(request.review), target_mtime: deps.reviews.targetMtime(request.review) }
    };
  },

  // D5's second window, for the shape the browser cannot refuse on its own: two
  // windows in storage-separate contexts cannot see each other, so the helper is
  // the only thing that can tell them apart.
  "window.claim": function (request, deps) {
    var body = request.body || {};
    if (typeof body.window_id !== "string" || !body.window_id) {
      return {
        status: 400,
        error: { code: "PROTO_BAD_REQUEST", detail: "the body must be {review, window_id, takeover}" }
      };
    }
    var outcome = deps.reviews.claimWindow(request.review, {
      window_id: body.window_id,
      // Possession proof of the CURRENT holder. The route passes it through; the
      // registry decides. A refusal returns no secret and no holder id.
      session_secret: typeof body.session_secret === "string" ? body.session_secret : undefined,
      takeover: body.takeover === true
    });
    return {
      status: outcome.granted ? 200 : protocol.statusFor("PROTO_SECOND_WINDOW"),
      body: outcome
    };
  },

  // The reviewer chose End review on the rail. The review is archived, never
  // truncated: outstanding work stays in the log where it can still be read.
  "review.end": function (request, deps) {
    var ended = deps.reviews.endReview(request.review);
    var outstanding = deps.log.read(request.review).length;
    return { status: 200, body: { ended_at: ended.ended_at, outstanding_kept: outstanding } };
  },

  // What `lahe wait` calls. It BLOCKS until something new passes the watermark,
  // or times out. It stores nothing and consumes nothing: a killed wait, a
  // repeated wait, and two agents waiting at once are all harmless, and two
  // waiters on one review both wake.
  wait: async function (request, deps) {
    var since = numberOr(request.query.since, 0);
    var timeoutSeconds = numberOr(request.query.timeout, protocol.WAIT.DEFAULT_TIMEOUT_SECONDS);
    var deadline = Date.now() + timeoutSeconds * 1000;

    for (;;) {
      var fresh = deps.log.since(request.review, since).filter(protocol.countsAsNew);
      if (fresh.length > 0) {
        return {
          status: 200,
          body: { events: fresh, seq: deps.log.currentSeq(request.review) }
        };
      }
      if (Date.now() >= deadline) {
        return { status: 200, body: { events: [], seq: deps.log.currentSeq(request.review) } };
      }
      await sleep(Math.min(protocol.REPLY_POLL.INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }
  }
};

function numberOr(value, fallback) {
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// Every route on the wire has a handler, checked at LOAD rather than at request
// time. A route with no handler is a 500 in front of a reviewer otherwise.
protocol.ROUTES.forEach(function (r) {
  if (typeof HANDLERS[r.name] !== "function") {
    throw new Error("src/service/routes.js has no handler for protocol route " + r.name);
  }
});

/** Match a method and a pathname to a route on the wire, or null. */
function matchRoute(method, pathname) {
  for (var i = 0; i < protocol.ROUTES.length; i += 1) {
    var r = protocol.ROUTES[i];
    if (r.path === pathname && r.method === String(method).toUpperCase()) return r;
  }
  return null;
}

function handlerFor(name) {
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, name)) {
    throw new Error("unknown route: " + String(name));
  }
  return HANDLERS[name];
}

module.exports = {
  HANDLERS: HANDLERS,
  handlerFor: handlerFor,
  matchRoute: matchRoute,
  notImplemented: notImplemented
};
