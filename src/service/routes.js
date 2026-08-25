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
var record = require("../shared/record.js");

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
        service_contract: protocol.SERVICE_CONTRACT,
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
    if (deps.projection && typeof deps.projection.tickReview === "function") {
      deps.projection.tickReview(deps, request.review);
    }
    appendWakeLines(request, deps, events, result);
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
  // writers on one events.jsonl is the thing being avoided), disconnecting the
  // page every time add ran. So the writes come here instead and the helper,
  // the single writer, applies them itself. `add` now only writes to disk when
  // NO helper is answering.
  //
  // Everything here is idempotent: registering an origin twice is a no-op, and
  // a repeated source hint is one more page.visited event, which the projector
  // folds onto the same page group.
  //
  // THE ORIGINS ARE VALIDATED, and this route is deliberately narrower than
  // `add` writing meta.json on disk. Origins arrive in the BODY here, so a
  // script running on a page the review already allows could read the token off
  // the script tag and post any origin it liked, collapsing the token-plus-
  // origin pair into the token alone. Only what `add` legitimately sends passes:
  // the literal "null", and http/https on a loopback host
  // (protocol.isRegisterableOrigin). `add` on disk stays wider because that path
  // is a person typing --origin at a terminal, not a page.
  "review.write": function (request, deps) {
    var body = request.body || {};
    var origins = Array.isArray(body.origins) ? body.origins : [];
    var refused = origins.filter(function (origin) {
      return !protocol.isRegisterableOrigin(origin);
    });
    if (refused.length > 0) {
      return {
        status: 400,
        error: {
          code: "PROTO_BAD_REQUEST",
          detail:
            "refused origin " +
            JSON.stringify(String(refused[0])) +
            ": this route registers only \"null\" and http/https origins on " +
            protocol.LOOPBACK_ORIGIN_HOSTS.join(", ")
        }
      };
    }

    // The cap is the second half: without it a caller may add one legal origin
    // at a time forever, and an allowlist nobody can read at a glance is not an
    // allowlist. Counted against what the review already holds, so a repeat of
    // an origin already registered never trips it.
    var held = deps.reviews.get(request.review);
    var heldOrigins = held && Array.isArray(held.origins) ? held.origins : [];
    var wouldHold = heldOrigins.slice();
    origins.forEach(function (origin) {
      if (wouldHold.indexOf(origin) === -1) wouldHold.push(origin);
    });
    if (wouldHold.length > protocol.ORIGIN_LIMIT) {
      return {
        status: 400,
        error: {
          code: "PROTO_BAD_REQUEST",
          detail:
            "refused origin " +
            JSON.stringify(String(origins[origins.length - 1])) +
            ": review " +
            request.review +
            " already holds " +
            heldOrigins.length +
            " origins and the limit is " +
            protocol.ORIGIN_LIMIT
        }
      };
    }

    var applied = [];
    origins.forEach(function (origin) {
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
    if (typeof deps.projection.tickReview === "function") {
      deps.projection.tickReview(deps, request.review);
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
        // When the helper last put a stripped script line back into this
        // review's page. `lahe status` says it out loud, because a heal means a
        // rebuild landed without the line and somebody may want to know their
        // build strips it.
        last_heal_at:
          typeof deps.reviews.lastHealAt === "function" ? deps.reviews.lastHealAt(request.review) : null,
        draft_count: draftCount
      })
    };
  },

  // The library's reply poll loop. The cursor is a seq, never a timestamp and
  // never a byte offset: two events in one millisecond are ordinary, and a clock
  // that steps backwards would silently skip work.
  "replies.poll": function (request, deps) {
    // Once per request, for both the activity stamp and the liveness answer.
    var owner = ownerSessionOf(request, deps);
    if (deps.projection && typeof deps.projection.tickReview === "function") {
      // A fold that accepted a line means the owning agent just appended a
      // reply. That is session activity, the same way running the drain command
      // is, and it is what keeps the rail from calling a mid-batch agent absent.
      noteReplyActivity(deps, deps.projection.tickReview(deps, request.review), owner);
    }
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
      body: {
        events: events,
        seq: deps.log.currentSeq(request.review),
        target_mtime: deps.reviews.targetMtime(request.review, request.query.page_path || null),
        // GROUND TRUTH ABOUT THE AGENT, not the agent's claim about itself. The
        // rail used to show what a chat said it was doing, which is how "the
        // monitor is running" sat over seven unanswered items. Every field here
        // comes from a file the monitor or a lahe command wrote.
        agent_liveness: agentLiveness(request, deps, owner)
      }
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

  // The holder's goodbye. It is deliberately forgiving: a release for a review
  // nobody holds, or one carrying the wrong secret, is a no-op that answers 200
  // rather than an error. This arrives from a page that is going away, often on
  // a keepalive request nobody will ever read the answer to, so there is nothing
  // useful to tell and nobody to tell it to. The `released` flag is the truth
  // for whoever is listening.
  "window.release": function (request, deps) {
    var body = request.body || {};
    var outcome = deps.reviews.releaseWindow(request.review, {
      session_secret: typeof body.session_secret === "string" ? body.session_secret : undefined
    });
    return { status: 200, body: outcome };
  },

  // The reviewer chose End review on the rail. The review is archived, never
  // truncated: outstanding work stays in the log where it can still be read.
  "review.end": function (request, deps) {
    if (!deps.projection || typeof deps.projection.itemsFrom !== "function") {
      throw notImplemented("review.end", "3A");
    }
    // BEFORE the archive, not after. endReview drops the review's holder record,
    // and that record is where the owning agent session is named, so asking
    // afterwards returns null and the wake line goes nowhere.
    var owner = ownerSessionOf(request, deps);
    var ended = deps.reviews.endReview(request.review);
    var woke = wakeOnReviewEnd(deps, request.review, owner);
    // WHAT IS STILL OPEN, not how big the log is. This counted every line in
    // events.jsonl, so a ten-comment review reported hundreds and the number
    // meant nothing to whoever read it. Ready items are the outstanding work by
    // the projection's own vocabulary, the same one `lahe status` lists with.
    // Drafts are deliberately not counted here: they reach no agent, so they
    // are not work anybody kept.
    var outstanding = deps.projection.itemsFrom(deps.log.read(request.review)).filter(function (item) {
      return item.state === record.STATE.READY;
    }).length;
    return { status: 200, body: { ended_at: ended.ended_at, outstanding_kept: outstanding, woke: woke } };
  }
};

function numberOr(value, fallback) {
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// The wake feed and the liveness answer
// ---------------------------------------------------------------------------

/** Which agent session owns this review, or null when nothing can say. */
function ownerSessionOf(request, deps) {
  if (!deps.reviews || typeof deps.reviews.get !== "function") return null;
  var held = deps.reviews.get(request.review);
  var owner = held && typeof held.agent_session_id === "string" ? held.agent_session_id : null;
  // "legacy" is the synthetic id for reviews made before sessions existed. It
  // has no directory and therefore no feed and no heartbeat.
  if (!owner || owner === "legacy" || !protocol.isSafeId(owner)) return null;
  return owner;
}

/**
 * One wake line per READY TRANSITION, appended where the events land.
 *
 * TRANSITION-BASED IS THE WHOLE POINT. A reviewer typing sends a stream of
 * item.content events and none of them is a wake: only item.ready is. So a
 * burst of typing appends nothing and costs no agent a turn.
 *
 * TWO EVENTS ARE READY TRANSITIONS, NOT ONE. item.ready is the first time an
 * item becomes work. item.reopened is the reviewer saying "this is not done"
 * about an item an agent already answered, and the projector treats it as ready
 * exactly like the first one. It used to append no wake line, so reopening an
 * item was silent: the item showed up in the next drain and nowhere else, and a
 * host waiting on the feed waited forever.
 *
 * IDEMPOTENT ON REPLAY. The library re-posts anything it has not seen
 * acknowledged, so the same item.ready arrives again after a reconnect. Only
 * events in `result.accepted` are ones the log had not already stored, so a
 * replay walks straight past this. The feed's own (review, item, rev) dedupe is
 * the second belt, and a reopen carries a new rev, so it is a line of its own
 * rather than a duplicate of the first ready.
 */
var WAKE_EVENTS = [protocol.EVENT.ITEM_READY, protocol.EVENT.ITEM_REOPENED];

function appendWakeLines(request, deps, events, result) {
  if (!deps.agentSessions || typeof deps.agentSessions.wake !== "object" || !deps.agentSessions.wake) return 0;
  var stored = {};
  (result.accepted || []).forEach(function (id) { stored[id] = true; });
  var owner = ownerSessionOf(request, deps);
  if (!owner) return 0;
  var appended = 0;
  events.forEach(function (event) {
    if (!event || typeof event !== "object") return;
    if (WAKE_EVENTS.indexOf(event[protocol.EVENT_FIELD.EVENT]) === -1) return;
    if (!stored[event[protocol.EVENT_FIELD.EVENT_ID]]) return;
    var item = event[protocol.EVENT_FIELD.ITEM];
    if (!item) return;
    try {
      var line = deps.agentSessions.wake.appendWork({
        session: owner,
        review: request.review,
        item: item,
        rev: event[protocol.EVENT_FIELD.REV]
      });
      if (line) appended += 1;
    } catch (err) {
      // A feed that cannot be written must not fail the reviewer's post. The
      // work is already durable in events.jsonl; the wake is the convenience.
      if (deps.log && typeof deps.log.helperLog === "function") {
        deps.log.helperLog("review " + request.review + ": could not append to the wake feed: " + err.message);
      }
    }
  });
  return appended;
}

/**
 * One wake line when the reviewer ends a review.
 *
 * The contract tells every agent that ending a review wakes it. Nothing wrote
 * this line, so that sentence was false and the review ended in silence. The
 * agent's own account of the failure is the clearest statement of it: the
 * session still read as open and listening, the review drained to zero ready
 * items, and zero ready is indistinguishable from an agent that is simply
 * caught up.
 *
 * Same failure posture as appendWakeLines: a feed that cannot be written must
 * not fail the reviewer's press. The archive is already durable in events.jsonl
 * and ended_at is already in review.json; the wake is what makes them timely.
 *
 * @returns {boolean} whether a line was appended (false when the review has no
 *   owning session, already had one, or the feed refused the write)
 */
function wakeOnReviewEnd(deps, reviewId, owner) {
  if (!owner) return false;
  if (!deps.agentSessions || typeof deps.agentSessions.wake !== "object" || !deps.agentSessions.wake) return false;
  if (typeof deps.agentSessions.wake.appendReviewEnded !== "function") return false;
  try {
    return !!deps.agentSessions.wake.appendReviewEnded(owner, reviewId);
  } catch (err) {
    if (deps.log && typeof deps.log.helperLog === "function") {
      deps.log.helperLog("review " + reviewId + ": could not append the end line to the wake feed: " + err.message);
    }
    return false;
  }
}

/** A reply the agent appended is session activity; record it as such. */
function noteReplyActivity(deps, tick, owner) {
  if (!tick || !tick.summary || !Array.isArray(tick.summary.accepted) || tick.summary.accepted.length === 0) return false;
  if (!deps.agentSessions || typeof deps.agentSessions.touchActivity !== "function") return false;
  if (!owner) return false;
  deps.agentSessions.touchActivity(owner);
  return true;
}

// One entry per review, per helper. The reply poll runs about once a second per
// open page, and it used to re-read the whole event log and re-project it every
// time to count three items. A projection is a pure function of the log, so the
// log's current seq is a complete cache key: same seq, same answer, and seq is
// already in memory (the log's own load()).
//
// Keyed on the deps object rather than module-level, so two helpers (or two
// tests) on one review id never read each other's counts, and a helper that
// goes away takes its cache with it.
var workCaches = new WeakMap();

function workCacheFor(deps) {
  var cache = workCaches.get(deps);
  if (!cache) {
    cache = Object.create(null);
    workCaches.set(deps, cache);
  }
  return cache;
}

/**
 * How many ready items nobody has answered, the oldest one's timestamp, and
 * when the newest reply on this review landed.
 *
 * READY AND UNANSWERED IS RECORD.JS'S DEFINITION, not a second one spelled in
 * raw strings here. The rail's count and `lahe status`'s item list have to be
 * counting the same items.
 *
 * THE AGE IS THE LAST TRANSITION, not the first. An item the reviewer reopened
 * this minute carries a created_at from hours ago, and reporting that made the
 * rail say "oldest item 4h" about work that became work four seconds ago.
 * updated_at is when it last became something an agent has to answer.
 */
function unansweredWork(request, deps) {
  var out = { unanswered: 0, oldest: null, lastReplyAt: null };
  if (!deps.projection || typeof deps.projection.project !== "function") return out;

  var cache = workCacheFor(deps);
  var seq = null;
  try {
    seq = deps.log.currentSeq(request.review);
  } catch (err) {
    seq = null;
  }
  var cached = cache[request.review];
  if (cached && seq !== null && cached.seq === seq) return cached.work;

  var projected;
  try {
    projected = deps.projection.project(request.review, deps.log.read(request.review));
  } catch (err) {
    return out;
  }
  ((projected && projected.pages) || []).forEach(function (page) {
    (page.items || []).forEach(function (item) {
      // WHEN THE AGENT LAST SAID ANYTHING ON THIS REVIEW, over every item rather
      // than only the waiting ones: this is the number the rail turns into
      // "agent replied 40s ago", and an answered item is exactly where a reply
      // lives. The thread carries the older rounds, so a long exchange does not
      // lose its most recent reply to an archive.
      noteReplyTime(out, item[record.FIELD.REPLY]);
      (item[record.FIELD.THREAD] || []).forEach(function (round) {
        noteReplyTime(out, round && round.agent);
      });
      if (!record.isUnansweredReady(item)) return;
      out.unanswered += 1;
      var at = item[record.FIELD.UPDATED_AT] || item[record.FIELD.CREATED_AT] || null;
      if (typeof at === "string" && at && (!out.oldest || at < out.oldest)) out.oldest = at;
    });
  });
  if (seq !== null) cache[request.review] = { seq: seq, work: out };
  return out;
}

/**
 * @param {string|null} owner the session id, already resolved by the caller.
 *   Resolving it once per request is deliberate: it was being read twice on
 *   every poll, once to stamp activity and once for this.
 */
function noteReplyTime(out, reply) {
  var at = reply && typeof reply.at === "string" ? reply.at : null;
  if (!at) return;
  if (!out.lastReplyAt || at > out.lastReplyAt) out.lastReplyAt = at;
}

function agentLiveness(request, deps, owner) {
  if (!deps.agentSessions || typeof deps.agentSessions.liveness !== "function") return null;
  var work = unansweredWork(request, deps);
  // A review with no agent session (the "legacy" id, from before sessions
  // existed) is reached some other way, so there is no monitor to be missing.
  // Saying "no agent watching" there would be a false alarm about nobody.
  if (!owner) return livenessNone(work);
  return deps.agentSessions.liveness(owner, {
    unanswered: work.unanswered,
    oldestUnansweredAt: work.oldest,
    lastReplyAt: work.lastReplyAt
  });
}

/**
 * The answer for a review with no agent session: the same shape, and no claim.
 *
 * It still carries the counts and the times, because the reviewer's own work is
 * their own work whoever owns it. It just never says "no agent listening": a
 * review reached some other way has no session to be missing from.
 */
function livenessNone(work) {
  var out = {};
  out[protocol.AGENT_LIVENESS.FIELD.STATE] = work.unanswered > 0
    ? protocol.AGENT_LIVENESS.STATE.WAITING
    : protocol.AGENT_LIVENESS.STATE.NONE;
  out[protocol.AGENT_LIVENESS.FIELD.UNANSWERED] = work.unanswered;
  out[protocol.AGENT_LIVENESS.FIELD.OLDEST_UNANSWERED_AT] = work.oldest;
  out[protocol.AGENT_LIVENESS.FIELD.LAST_REPLY_AT] = work.lastReplyAt;
  out[protocol.AGENT_LIVENESS.FIELD.LISTENING] = null;
  out[protocol.AGENT_LIVENESS.FIELD.MONITOR_AT] = null;
  out[protocol.AGENT_LIVENESS.FIELD.ACTIVITY_AT] = null;
  return out;
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
