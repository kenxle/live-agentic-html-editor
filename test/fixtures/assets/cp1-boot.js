// The CP1 walk's page-side surface, on top of the REAL boot.
//
// This file used to wire the four Phase 1 pieces together by hand, because 2D
// (living in the page) did not exist and CP1 was the checkpoint that proved the
// four branches work as one thing. That wiring is now src/layer/index.js's
// boot(), which is where it belongs: the library boots itself from its script
// tag on a real page, and this fixture calls the same function.
//
// So what is left here is ONLY the walk's reading surface: the handful of
// questions test/browser/cp1_walk.spec.js asks about a page it cannot see into,
// because the rail lives in a CLOSED shadow root that no selector reaches. If
// an assertion in that spec could pass because of a line in this file, the line
// is in the wrong file.
//
// The review id and the token come off the query string, and both were minted
// by the helper (1A's reviews.create), never by this page. They arrive as boot
// OPTIONS rather than as script-tag attributes for one reason: the helper's
// port is ephemeral under test, and a static fixture cannot carry it. The
// script-tag path is the one a host application uses, and it is exercised in
// test/browser/living_in_the_page.spec.js against 0C's app fixture.
//
// Everything the spec reads is under window.__laheCp1.

(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var reviewId = params.get("review") || "review-1";
  var token = params.get("token") || "";
  var helper = params.get("helper") || "";

  // THE WHOLE WIRING, in one call: the store, the rail, the comment surface,
  // the Active tab inside the rail, sync, the remount contract, and the first
  // replay pass. Sync is left for the walk to start, because the walk is about
  // what happens either side of that.
  var app = LAHE.layer.boot({
    review: reviewId,
    token: token,
    helper: helper || undefined,
    startSync: false
  });

  var store = app.store;
  var rail = app.rail;
  var comments = app.comments;

  function itemsNow() {
    return store.read(reviewId);
  }

  // The card node an item was first drawn with, so "never re-created" is
  // compared against the original rather than against a re-read.
  var remembered = Object.create(null);

  function rectOf(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") return null;
    var r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }

  window.__laheCp1 = {
    reviewId: reviewId,

    items: itemsNow,
    itemById: function (id) {
      return store.readItem(reviewId, id);
    },
    pending: function () {
      return store.pendingEvents(reviewId).length;
    },
    status: function () {
      return rail.getStatusLine();
    },
    statusLog: app.statusLog,
    startSync: function () {
      return app.sync.start();
    },

    // Where the reviewer clicks. The rail is in a CLOSED shadow root, so a test
    // cannot reach a selector into it; it asks the library where the box is and
    // clicks the real pixels.
    noteBoxRect: function () {
      var box = app.tab().noteBox();
      if (!box || !box.input) return null;
      // The pane scrolls once there are a few cards in it, and a reviewer
      // scrolls to the box before clicking it.
      box.input.scrollIntoView({ block: "nearest" });
      return rectOf(box.input);
    },
    // The reviewer's own words on the card, which ARE the rewording surface:
    // there is no Reword button, you click the sentence and type.
    noteRect: function (id) {
      var body = rail.cardBody(id);
      if (!body) return null;
      var note = body.querySelector(".lahe-rail-note");
      if (!note) return null;
      note.scrollIntoView({ block: "nearest" });
      return rectOf(note);
    },

    // The seam-3 reading: a card really holds what the reviewer is typing in.
    holdsFocus: function (id) {
      return rail.holdsFocus(id);
    },
    focusedCardId: function () {
      return rail.focusedCardId();
    },
    cardIds: function () {
      return rail.cardIds();
    },
    rememberCardNode: function (id) {
      remembered[id] = rail.cardNode(id);
      return !!remembered[id];
    },
    cardNodeIsRemembered: function (id) {
      return !!remembered[id] && remembered[id] === rail.cardNode(id);
    },

    // What the comment surface has open, for the gesture waits.
    focusedBoxQuote: function () {
      var box = comments.focusedBox();
      return box ? box.item.context.quote || box.id : null;
    },
    pickMode: function () {
      return comments.pickMode().active;
    },
    outlining: function () {
      return comments.pickMode().outlining;
    },

    // One host on the page, and it is the marker module's id.
    hostCount: function () {
      return document.querySelectorAll("#" + LAHE.markers.OVERLAY_ROOT_ID).length;
    },
    hostId: function () {
      return LAHE.markers.OVERLAY_ROOT_ID;
    },

    // The anchor engine, against this live document.
    resolveRegion: function (id) {
      var item = store.readItem(reviewId, id);
      var ref = item && item.region ? item.region.ref : null;
      if (!ref) return { bound: false, reason: "no reference on the record", failureCode: null, matchesElementId: null };
      var verdict = LAHE.anchor.resolve(ref, document);
      return {
        bound: verdict.bound,
        reason: verdict.reason,
        failureCode: verdict.failureCode,
        considered: verdict.considered,
        survivors: verdict.survivors,
        matchesElementId: verdict.element ? verdict.element.id || null : null,
        matchesText: verdict.element ? String(verdict.element.textContent || "").slice(0, 40) : null
      };
    }
  };
})();
