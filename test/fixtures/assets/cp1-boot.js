// The boot the CP1 walk uses: the four Phase 1 pieces wired together.
//
// This is the whole of what 2D's index.js will do on a real page, written out
// here because 2D does not exist yet and CP1 is the checkpoint that proves the
// four branches work as one thing. It wires nothing of its own: store, rail,
// comments, the Active tab and sync are all the REAL modules from the built
// bundle. If an assertion in test/browser/cp1_walk.spec.js could pass because
// of a line in this file, the line is in the wrong file.
//
// The review id and the token come off the query string, and both were minted
// by the helper (1A's reviews.create), never by this page.
//
// Everything the spec reads is under window.__laheCp1.

(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var reviewId = params.get("review") || "review-1";
  var token = params.get("token") || "";
  var helper = params.get("helper") || "";

  var store = LAHE.store.createStore();
  var rail = LAHE.overlay.createRail({ store: store, reviewId: reviewId });
  rail.mount();

  var page = LAHE.record.pageFrom(
    { origin: location.origin, pathname: location.pathname, href: location.href, title: document.title },
    { seq: 1 }
  );

  var comments = LAHE.comments.createComments({ store: store, reviewId: reviewId, page: page });
  comments.bind({ page: page });

  // The seam CP1 closes: the Active tab's contents live INSIDE the rail's own
  // Active pane, so there is one rail on the page and one host under it.
  var tab = LAHE.tabActive.createActiveTab({
    comments: comments,
    overlay: rail,
    host: rail.tabBody(LAHE.overlay.TAB.ACTIVE)
  });
  tab.mount();

  var statusLog = [];

  var sync = LAHE.sync.createSync({
    review: reviewId,
    token: token,
    helperOrigin: helper || undefined,
    store: store,
    onStatus: function (state) {
      statusLog.push(state);
      rail.setStatusLine(state);
    },
    onFailure: function (failure) {
      rail.failures.add(failure);
    },
    onLimit: function (text) {
      rail.setLimitNote(text);
    }
  });

  // What the library does on load: everything browser storage holds for this
  // review comes back as a card, drafts included.
  store.read(reviewId).forEach(function (item) {
    rail.upsertCard(item);
  });

  comments.onChange(function (item, event) {
    // "removed" carries an id and nothing else, and "closed" is not a change to
    // the record: the state it would post was already posted by the keystroke
    // or by ready.
    if (event === "removed" || event === "closed") return;
    rail.upsertCard(item);
    sync.recordItem(item, event === "ready" ? { immediate: "ready" } : undefined);
  });

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
    statusLog: function () {
      return statusLog.slice();
    },
    startSync: function () {
      return sync.start();
    },

    // Where the reviewer clicks. The rail is in a CLOSED shadow root, so a test
    // cannot reach a selector into it; it asks the library where the box is and
    // clicks the real pixels.
    noteBoxRect: function () {
      var box = tab.noteBox();
      if (!box || !box.input) return null;
      // The pane scrolls once there are a few cards in it, and a reviewer
      // scrolls to the box before clicking it.
      box.input.scrollIntoView({ block: "nearest" });
      return rectOf(box.input);
    },
    rewordButtonRect: function (id) {
      var body = rail.cardBody(id);
      if (!body) return null;
      var parent = body.parentNode;
      var buttons = parent ? parent.querySelectorAll("button") : [];
      for (var i = 0; i < buttons.length; i += 1) {
        if (buttons[i].textContent === "Reword") return rectOf(buttons[i]);
      }
      return null;
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
