// The driver 1B's browser specs speak to.
//
// It is deliberately thin: it wires the REAL modules from the built bundle
// (LAHE.store, LAHE.sync, LAHE.overlay, LAHE.comments) together the way the
// library will wire them when 2D boots it, and exposes the handful of readings
// a test needs. Nothing here implements behavior under test; if an assertion
// could pass because of a line in this file, the line is in the wrong file.
//
// Everything lives under window.__laheRail. The harness's own namespace is
// window.__laheTest and the repaint fixture's is window.__lahe, so all three
// stay tellable apart.

(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var reviewId = params.get("review") || "review-1";
  var token = params.get("token") || "";
  var helper = params.get("helper") || "";

  var store = LAHE.store.createStore();
  var rail = LAHE.overlay.createRail({ store: store, reviewId: reviewId });
  var comments = LAHE.comments.createComments({ store: store, reviewId: reviewId });

  // Every status the sync client has reported, in order. Ranked test 21 is
  // about the TRANSITIONS, not about a string being present at one moment.
  var statusLog = [];
  var limitNote = null;

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
    // Mirrors the real boot (src/layer/index.js): a standing chip whose
    // condition ended is cleared by whatever ended it.
    onRecovered: function (code) {
      rail.failures.clear(code);
    },
    onLimit: function (text) {
      limitNote = text;
      rail.setLimitNote(text);
    },
    // Mirrors the real boot (src/layer/index.js): a refused window shows the
    // refusal panel; becoming the holder hides it. Without this wiring the
    // harness silently diverged from the product on the exact surface the
    // second-window specs judge.
    onRefused: function (info) {
      rail.showRefusal(info);
    },
    onHeld: function () {
      rail.hideRefusal();
    }
  });

  // The node a card was FIRST created with. Identity is compared against this,
  // not against a snapshot taken mid-test, so a re-created card cannot hide
  // behind a re-read.
  var firstNodes = Object.create(null);
  var boxes = Object.create(null);

  function page() {
    return LAHE.record.pageFrom(
      { origin: location.origin, pathname: location.pathname, href: location.href, title: document.title },
      { seq: 1 }
    );
  }

  rail.mount();

  // What the library does on load: everything browser storage holds for this
  // review comes back as a card, drafts included.
  store.read(reviewId).forEach(function (item) {
    rail.upsertCard(item);
  });

  // Every change to an item goes through the same path the real library uses:
  // storage is already written by comments.js, the rail is updated in place,
  // and the event is handed to sync.
  comments.onChange(function (item) {
    rail.upsertCard(item);
    sync.recordItem(item);
  });

  var api = {
    reviewId: reviewId,

    openCard: function () {
      var item = null;
      var unsubscribe = comments.onChange(function (got) {
        item = got;
      });
      var box = comments.openBox({ page: page(), kind: LAHE.record.KIND.COMMENT, host: null });
      unsubscribe();
      item = box.item;
      var id = box.id;
      rail.upsertCard(item);
      // The card is the host: the reviewer's text box lives inside the card in
      // the rail, which is what makes "a card holding focus is never
      // re-created" a statement about something real.
      var body = rail.cardBody(id);
      if (!body) throw new Error("rail.cardBody(" + id + ") returned nothing");
      body.appendChild(box.node);
      boxes[id] = box;
      firstNodes[id] = rail.cardNode(id);
      box.focus();
      return { id: id };
    },

    focusCard: function (id) {
      boxes[id].focus();
      return rail.holdsFocus(id);
    },

    /** True only while the card node created at open() is still the live one. */
    sameCardNode: function (id) {
      return firstNodes[id] !== null && firstNodes[id] === rail.cardNode(id);
    },

    /**
     * What holds focus INSIDE the closed shadow root, which no test can read
     * from outside. The rail answers it because removeCard needs the same
     * answer; this is not a test-only backdoor.
     */
    activeInfo: function () {
      return rail.activeElementInfo();
    },

    cardText: function (id) {
      return boxes[id].input.value;
    },

    storedText: function (id) {
      var item = store.readItem(reviewId, id);
      return item ? item.note : null;
    },

    storedItem: function (id) {
      return store.readItem(reviewId, id);
    },

    storedCount: function () {
      return store.read(reviewId).length;
    },

    storedItems: function () {
      return store.read(reviewId);
    },

    markReady: function (id) {
      var item = boxes[id].markReady();
      rail.upsertCard(item);
      sync.recordItem(item, { immediate: "ready" });
      return item;
    },

    // --- the rail ------------------------------------------------------------

    status: function () {
      return rail.getStatusLine();
    },
    statusText: function () {
      return rail.statusText();
    },
    chips: function () {
      return rail.failures.list().map(function (chip) {
        return { code: chip.code, count: chip.count };
      });
    },
    addChip: function (code) {
      // Null is the answer for a code the reviewer already dismissed. It is a
      // real answer, not a miss, so it is passed through rather than smoothed.
      var got = rail.failures.add(LAHE.failures.failure(code, null));
      return got ? got.code : null;
    },
    dismissChip: function (code) {
      return rail.failures.dismiss(code);
    },
    remount: function () {
      rail.unmount();
      rail.mount();
      return rail.isMounted();
    },
    collapse: function (next) {
      return rail.collapse(next);
    },
    isCollapsed: function () {
      return rail.isCollapsed();
    },
    refusalShown: function () {
      return rail.refusalShown();
    },
    geometry: function () {
      return rail.geometry();
    },
    selectTab: function (tab) {
      return rail.selectTab(tab);
    },
    currentTab: function () {
      return rail.currentTab();
    },
    cardIds: function () {
      return rail.cardIds();
    },
    removeCard: function (id) {
      return rail.removeCard(id);
    },

    /**
     * One keystroke and the durability check IN THE SAME TASK: the input event
     * is dispatched and raw browser storage is read before this function
     * returns, with no await and no timer in between. That ordering is the
     * whole of ranked test 6, and a debounced store cannot pass it.
     */
    typeFinalKeystrokeAndRead: function (args) {
      var box = boxes[args.id];
      box.input.value = box.input.value + args.character;
      box.input.dispatchEvent(new Event("input", { bubbles: true }));
      var raw = localStorage.getItem(LAHE.store.KEY_PREFIX + reviewId);
      var outbox = localStorage.getItem(LAHE.store.OUTBOX_PREFIX + reviewId);
      return {
        raw: raw,
        durable: raw !== null && raw.indexOf(box.input.value) !== -1,
        queued: outbox !== null && JSON.parse(outbox).length > 0,
        typed: box.input.value
      };
    },

    statusLog: function () {
      return statusLog.slice();
    },

    limit: function () {
      return limitNote;
    },

    // --- sync ----------------------------------------------------------------

    sync: function () {
      return sync.status();
    },
    pending: function () {
      return store.pendingEvents(reviewId).length;
    },
    startSync: function () {
      return sync.start();
    },
    stopSync: function () {
      return sync.stop();
    },
    flushNow: function () {
      return sync.flush();
    },
    replies: function () {
      return sync.repliesSeen();
    },
    windowLock: function () {
      return sync.lockState();
    }
  };

  window.__laheRail = api;
})();
