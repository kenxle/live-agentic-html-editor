// The router: the route table wired to src/shared/protocol.js, plus the two
// call sites Phase 0 has to pin so two builders do not each invent them.
//
// Owner: Task 1A. STUB: every handler throws notImplemented with the task that
// owns it, except the two that exist to fix a call site:
//
//   - the send handler calls reviewWriter.writeReviewFiles. ONE writer.
//   - the ack handler calls verification.verify. 3A writes the ack path around
//     that call; 3B fills the function in. The collision is one line.
//
// Fail loud: a stubbed handler throws rather than returning an empty 200. A
// handler that quietly succeeds while doing nothing is how the burn-down
// silently empties.
//
// Node-only.

"use strict";

var protocol = require("../shared/protocol.js");
var lifecycle = require("../shared/lifecycle.js");
var record = require("../shared/record.js");
var reviewWriter = require("./review_writer.js");
var verification = require("./verification.js");

function notImplemented(routeName, owner) {
  var err = new Error("route " + routeName + " is not implemented yet: Task " + owner + " owns it");
  err.code = "NOT_IMPLEMENTED";
  return err;
}

// The pre-handler checks, run in this order for every request. Order matters:
// the origin check comes before anything reads a body, so a refused origin
// never reaches parsing.
var REQUEST_CHECKS = [
  { check: "host_header", why: "defeats DNS rebinding" },
  { check: "origin_allowlist", why: "D9 control 2. No wildcard, no reflection, applied to preflight too" },
  { check: "content_type_json", why: "D9 control 3, on mutating routes only" },
  { check: "custom_client_header", why: "D9 control 3. A simple request cannot carry it, so a preflight is forced" },
  { check: "credential", why: "D9 control 1. Session token, served-mode cookie, or run token per the route's auth mode" },
  { check: "target_scope", why: "a credential minted for one target touches only that target's items" }
];

var HANDLERS = {
  health: function () {
    throw notImplemented("health", "1A");
  },

  "session.mint": function () {
    // The origin comes from the request's Origin header and NEVER from the
    // body. A page cannot forge its Origin, which is what makes the allowlist
    // the real control in attached mode (D9).
    throw notImplemented("session.mint", "1A");
  },

  "review.read": function () {
    throw notImplemented("review.read", "1A");
  },

  "items.upsert": function () {
    throw notImplemented("items.upsert", "1A");
  },

  // The send handler. The review-file write happens HERE, through the one
  // writer, with a review root that came from server-side configuration.
  "review.send": function (request, deps) {
    var d = deps || {};
    if (typeof d.projectReview !== "function") throw notImplemented("review.send", "1A");
    var review = d.projectReview(request);
    // ONE OWNER. The CLI never writes these files; nothing else calls this.
    return reviewWriter.writeReviewFiles(review, { reviewRoot: d.reviewRoot });
  },

  // The ack handler. Its call site for verify() is written now so 3A and 3B do
  // not collide on it later.
  "review.ack": function (request, deps) {
    var d = deps || {};
    if (typeof d.loadItem !== "function") throw notImplemented("review.ack", "3A");

    var results = [];
    var acks = (request && request.body && request.body.items) || [];
    for (var i = 0; i < acks.length; i += 1) {
      var ack = acks[i];
      var item = d.loadItem(ack.id);
      if (!item) {
        results.push({ id: ack.id, refused: "PROTO_UNKNOWN_ITEM" });
        continue;
      }
      if (item[record.FIELD.STATE] !== record.STATE.DELIVERED) {
        results.push({ id: ack.id, refused: "PROTO_NOT_DELIVERED" });
        continue;
      }
      // D4: lifecycle wins for the revision it names. A newer revision survives
      // as outstanding and ships next.
      if (!lifecycle.ackApplies(item, ack.rev)) {
        results.push({ id: ack.id, refused: "PROTO_STALE_REV" });
        continue;
      }
      var outcome = ack.outcome === "applied" ? record.STATE.APPLIED : record.STATE.DECLINED;
      lifecycle.assertTransition(item[record.FIELD.STATE], outcome, record.ACTOR.AGENT);

      // THE VERIFY CALL SITE. No-op today, real in 3B, one line either way.
      var verified =
        outcome === record.STATE.APPLIED
          ? verification.verify(item, ack.files || [], { projectRoot: d.projectRoot })
          : null;

      results.push({ id: ack.id, rev: ack.rev, state: outcome, verification: verified });
    }
    return { results: results };
  },

  "review.next": function () {
    throw notImplemented("review.next", "1D");
  },

  "review.end": function () {
    throw notImplemented("review.end", "1A");
  },

  "review.stream": function () {
    throw notImplemented("review.stream", "3A");
  },

  "served.document": function () {
    throw notImplemented("served.document", "1A");
  }
};

// Every route in the protocol has a handler entry, checked at load rather than
// at request time.
protocol.ROUTES.forEach(function (r) {
  if (typeof HANDLERS[r.name] !== "function") {
    throw new Error("src/service/routes.js has no handler for protocol route " + r.name);
  }
});

function handlerFor(name) {
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, name)) {
    throw new Error("unknown route: " + String(name));
  }
  return HANDLERS[name];
}

module.exports = {
  REQUEST_CHECKS: REQUEST_CHECKS,
  HANDLERS: HANDLERS,
  handlerFor: handlerFor,
  notImplemented: notImplemented
};
