// The boot 2A's browser specs use: the store, the sync client, and the edit
// surface, wired the way 2D's index.js will wire them on a real page.
//
// It wires nothing of its own. The store, the sync client and the editing
// surface are the REAL modules from the built bundle. If an assertion in one of
// the editing specs could pass because of a line in this file, the line is in
// the wrong file.
//
// Everything the specs read is under window.__laheEdit.

(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var reviewId = params.get("review") || "review-1";
  var token = params.get("token") || "";
  var helper = params.get("helper") || "";

  var store = LAHE.store.createStore();

  var page = LAHE.record.pageFrom(
    { origin: location.origin, pathname: location.pathname, href: location.href, title: document.title },
    { seq: Number(params.get("p") || 1) }
  );

  var sync = null;
  if (token) {
    sync = LAHE.sync.createSync({
      review: reviewId,
      token: token,
      helperOrigin: helper || undefined,
      store: store
    });
  }

  var editing = LAHE.editing.createEditing({
    store: store,
    reviewId: reviewId,
    page: page,
    sync: sync
  });
  editing.bind({ page: page });

  // What the library does on load: the sync client re-posts anything the last
  // page never got acknowledged. That is how an edit committed at unload
  // reaches the helper on the NEXT page load (ranked test 7).
  if (sync) sync.start();

  function rectOf(node) {
    if (!node || typeof node.getBoundingClientRect !== "function") return null;
    var r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }

  window.__laheEdit = {
    reviewId: reviewId,

    items: function () {
      return store.read(reviewId);
    },
    itemById: function (id) {
      return store.readItem(reviewId, id);
    },
    pending: function () {
      return store.pendingEvents(reviewId).length;
    },
    flush: function () {
      return sync ? sync.flush() : null;
    },

    // Edit state, as the surface reports it.
    state: function () {
      return editing.state();
    },
    isEditing: function () {
      return editing.isEditing();
    },

    // The frame the reviewer sees. It lives in the library's own closed shadow
    // root, so a spec cannot reach a selector at it and asks here instead.
    frameRect: function () {
      return editing.frameRect();
    },
    frameLabel: function () {
      return editing.frameLabel();
    },
    buttonRect: function (name) {
      return rectOf(editing.buttonNode(name));
    },

    // The page's own text, read raw. Nothing here goes through the library's
    // capture, so a capture bug cannot hide behind it.
    blockText: function (id) {
      var el = document.getElementById(id);
      return el ? el.textContent : null;
    },
    blockHtml: function (id) {
      var el = document.getElementById(id);
      return el ? el.innerHTML : null;
    },
    blockExists: function (id) {
      return !!document.getElementById(id);
    },
    blockAttrs: function (id) {
      var el = document.getElementById(id);
      if (!el) return null;
      var out = {};
      for (var i = 0; i < el.attributes.length; i += 1) out[el.attributes[i].name] = el.attributes[i].value;
      return out;
    },

    // Gestures a spec drives directly, where a keystroke is not the point.
    editBlock: function (id) {
      var got = editing.editBlock(document.getElementById(id));
      return got ? { itemId: got.itemId, before: got.before } : null;
    },
    deleteBlock: function (id) {
      var item = editing.deleteBlock(document.getElementById(id));
      return item ? item.id : null;
    },
    format: function (command) {
      return editing.format(command);
    },
    undo: function (id) {
      return editing.undo(id);
    },
    commit: function () {
      var item = editing.commit({ reason: "manual" });
      return item ? item.id : null;
    },

    // Replay's counters, read straight off 2C's module. Test 16 asserts a
    // replay pass ran and wrote nothing.
    replay: function (passes) {
      for (var i = 0; i < (passes || 1); i += 1) LAHE.replay.runPass("undo");
      return Object.assign({}, LAHE.replay.counters);
    },
    replayCounters: function () {
      return Object.assign({}, LAHE.replay.counters);
    },

    // Where the caret is, for the undo assertion.
    caretIn: function (id) {
      var el = document.getElementById(id);
      return !!el && LAHE.selection.containsCaret(el);
    },

    // The anchor, so a spec can prove two records really point at two blocks.
    resolveRegion: function (id) {
      var item = store.readItem(reviewId, id);
      var ref = item && item.region ? item.region.ref : null;
      if (!ref) return null;
      var verdict = LAHE.anchor.resolve(ref, document);
      return { bound: verdict.bound, elementId: verdict.element ? verdict.element.id || null : null };
    }
  };
})();
